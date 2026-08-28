//! Image decomposition → dual-path 3D generation.
//!
//! `decompose_image` takes a generated Cozyverse image, hands it to a Python
//! pipeline (`decompose_pipeline.py`) that splits it into semantic asset groups
//! and produces, per asset, a perspective crop plus up to four orthographic
//! views, then submits every asset to Tripo and Meshy along two paths in
//! parallel:
//!
//!   * Fast Path    — the perspective crop → each provider's single-image endpoint
//!   * Quality Path — the 4 ortho views   → each provider's multi-view endpoint
//!
//! The command returns a job id immediately; a background task drives the rest
//! and streams `decompose://progress` events (whole-job payloads) to the UI.
//! Job state is mirrored to `<project>/decompositions.json` via the same atomic
//! writer the rest of the app uses, so a restart mid-run loses nothing but
//! in-flight provider polls.
//!
//! The provider transport itself is `modelforge_core` — the exact Tripo/Meshy
//! client code from ModelForge, so this stays bug-for-bug identical with it on
//! upload handling, endpoint versions, and status normalization.

use base64::Engine;
use modelforge_core::{
    models::{Operation, Provider, TaskStatus},
    Clients,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, Semaphore};

const KEYRING_SERVICE: &str = "Cozyverse Studio";
const PROGRESS_EVENT: &str = "decompose://progress";
const STATE_FILE: &str = "decompositions.json";
const STATE_VERSION: u32 = 1;

/// Cap on provider submissions in flight at once across a whole job. Tripo and
/// Meshy both rate-limit (see `modelforge_core::models::provider_http_error`);
/// polling is where the parallelism actually pays off, not submission.
const MAX_INFLIGHT_SUBMISSIONS: usize = 6;

/// Only one Python decomposition runs at a time. The GPU/CPU pipelines are
/// heavy, and — more subtly — ultralytics/HF/CLIP all download weights into
/// shared caches, so two concurrent first-runs corrupt each other's files
/// (observed: CLIP ViT-B-32 SHA256 mismatch). Jobs queue instead.
static PIPELINE_LOCK: Semaphore = Semaphore::const_new(1);

const FAST_PATH_DEADLINE: Duration = Duration::from_secs(4 * 60);
const QUALITY_PATH_DEADLINE: Duration = Duration::from_secs(8 * 60);
const POLL_EVERY: Duration = Duration::from_secs(3);

/// Ceiling on provider status polls happening at once. Submission is the part
/// providers rate-limit hardest, so it gets the tighter `MAX_INFLIGHT_SUBMISSIONS`
/// gate; polling is cheap GETs, so this can be much wider — the point is only to
/// avoid a thundering herd when a big fan-out (dozens of objects) all lands at
/// once.
const MAX_INFLIGHT_POLLS: usize = 64;

/// Per-job "please stop" flags, set by `decompose_cancel_job` and checked by the
/// fan-out worker between polls. An entry exists only while a job is modeling.
fn cancel_registry() -> &'static StdMutex<HashMap<String, Arc<AtomicBool>>> {
    static R: OnceLock<StdMutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    R.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// Fresh (or reset) cancel flag for a job about to start its fan-out.
fn cancel_token_for(job_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancel_registry()
        .lock()
        .unwrap()
        .insert(job_id.to_string(), flag.clone());
    flag
}

/// Ask a running job to stop. Returns false if nothing is registered (job isn't
/// modeling, or already finished).
fn signal_cancel(job_id: &str) -> bool {
    match cancel_registry().lock().unwrap().get(job_id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

fn clear_cancel(job_id: &str) {
    cancel_registry().lock().unwrap().remove(job_id);
}

/// Poll errors worth giving up on immediately (vs. transient 429/5xx/network
/// blips, which we swallow and retry until the path deadline). Mirrors
/// `modelforge_core`'s own internal `is_transient`, which isn't exported.
fn poll_error_is_fatal(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    !["429", "500", "502", "503", "504", "timed out", "timeout", "network error"]
        .iter()
        .any(|needle| lower.contains(needle))
}

/// Newest model each provider exposes. Tripo pins a dated version string;
/// `v3.1-20260211` is its latest (V3.1 / Studio). Meshy 7 is the current
/// generation — Geometry Alignment, multi-view texturing, up to 8K PBR, and
/// Smart Mesh low-poly. Both are overridable per run via `DecomposeOptions`;
/// pass `"latest"` for Meshy to always float to the newest tier.
const TRIPO_MODEL_VERSION: &str = "v3.1-20260211";
const MESHY_MODEL: &str = "meshy-7";

// ------------------------------------------------------------------ data model

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Decomposing,
    /// Decomposed; waiting for the user to confirm the (paid) provider fan-out.
    Awaiting,
    Modeling,
    Done,
    Error,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OrthoViews {
    pub front: Option<String>,
    pub back: Option<String>,
    pub left: Option<String>,
    pub right: Option<String>,
}

impl OrthoViews {
    /// Tripo's multi-view array is positional: `[front, left, back, right]`.
    /// Empty slots are allowed (ModelForge 1.3.0 contract: front + ≥1 other),
    /// so this returns exactly four entries, using "" for a missing view.
    fn ordered_for_provider(&self) -> [String; 4] {
        let g = |v: &Option<String>| v.clone().unwrap_or_default();
        [g(&self.front), g(&self.left), g(&self.back), g(&self.right)]
    }

    fn populated_count(&self) -> usize {
        [&self.front, &self.back, &self.left, &self.right]
            .iter()
            .filter(|v| v.as_deref().map(|s| !s.is_empty()).unwrap_or(false))
            .count()
    }

    fn has_front(&self) -> bool {
        self.front.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelJob {
    /// e.g. `asset_0_tripo_perspective`
    pub key: String,
    pub provider: String,
    /// `single-image` | `multi-view`
    pub mode: String,
    /// `fast` | `quality`
    pub path_kind: String,
    /// `pending` | `running` | `succeeded` | `failed`
    pub status: String,
    pub progress: f32,
    pub task_id: Option<String>,
    /// Relative to the project's `assets/` dir once the GLB is downloaded.
    pub glb_path: Option<String>,
    pub error: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DecomposedAsset {
    pub id: String,
    pub class: String,
    pub bbox: [f64; 4],
    /// Relative to the project's `assets/` dir.
    pub perspective_image: String,
    pub ortho_views: OrthoViews,
    pub models: Vec<ModelJob>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeJob {
    pub id: String,
    /// Relative to the project's `assets/` dir.
    pub image_path: String,
    pub status: JobStatus,
    pub message: String,
    pub error: Option<String>,
    pub quality_path: bool,
    pub assets: Vec<DecomposedAsset>,
    /// Hash of (image bytes + output-affecting options). Used to short-circuit
    /// an identical re-run instead of re-spending on the providers.
    #[serde(default)]
    pub input_hash: String,
    /// True once the provider fan-out has actually started for this job.
    #[serde(default)]
    pub submitted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeOptions {
    /// Also run the 4-view Quality Path. Default true.
    #[serde(default = "default_true")]
    pub quality_path: bool,
    /// Skip the GPU pipeline; Python does a plain center/gravity crop only.
    #[serde(default)]
    pub stub: bool,
    /// Use the CPU-friendly pipeline (YOLO-World boxes + rembg mattes, no ortho
    /// views). The frontend sets this when the full runtime isn't installed but
    /// the lite one is.
    #[serde(default)]
    pub lite: bool,
    /// When false, `decompose_image` stops after segmentation with status
    /// `awaiting` and does NOT touch the providers — the UI then shows the
    /// object count and cost estimate and calls `submit_decomposition` to
    /// proceed. Default true (one-shot).
    #[serde(default = "default_true")]
    pub submit: bool,
    /// Bypass the identical-input dedup check.
    #[serde(default)]
    pub force: bool,
    /// Restrict the fan-out to a subset of `["tripo", "meshy"]`. Default: every
    /// provider that has a key.
    #[serde(default)]
    pub providers: Option<Vec<String>>,
    /// Override the Tripo model version (default: `TRIPO_MODEL_VERSION`).
    #[serde(default)]
    pub tripo_model_version: Option<String>,
    /// Override the Meshy model (default: `MESHY_MODEL` = `"meshy-7"`).
    #[serde(default)]
    pub meshy_model: Option<String>,
    /// Texture map resolution in px (Meshy 7 supports up to 8192; Tripo maps
    /// ≥4096 to its "detailed" texture quality).
    #[serde(default)]
    pub texture_resolution: Option<u32>,
    /// Ask for quad topology instead of triangles (game / animation ready).
    #[serde(default)]
    pub quad_topology: Option<bool>,
    /// Target triangle/face budget for the output mesh (Smart Mesh / low-poly).
    #[serde(default)]
    pub target_polycount: Option<u32>,
    /// Override PBR material generation (default on).
    #[serde(default)]
    pub pbr: Option<bool>,
    /// Raw params merged verbatim into every Meshy request (last, so they win).
    /// The escape hatch for any Meshy 7 field not surfaced above.
    #[serde(default)]
    pub meshy_extra: Option<Map<String, Value>>,
    /// Raw params merged verbatim into every Tripo request.
    #[serde(default)]
    pub tripo_extra: Option<Map<String, Value>>,
}

impl Default for DecomposeOptions {
    fn default() -> Self {
        Self {
            quality_path: true,
            stub: false,
            lite: false,
            submit: true,
            force: false,
            providers: None,
            tripo_model_version: None,
            meshy_model: None,
            texture_resolution: None,
            quad_topology: None,
            target_polycount: None,
            pbr: None,
            meshy_extra: None,
            tripo_extra: None,
        }
    }
}

impl DecomposeOptions {
    fn resolved_tripo_version(&self) -> String {
        self.tripo_model_version
            .clone()
            .unwrap_or_else(|| TRIPO_MODEL_VERSION.to_string())
    }
    fn resolved_meshy_model(&self) -> String {
        self.meshy_model
            .clone()
            .unwrap_or_else(|| MESHY_MODEL.to_string())
    }
    /// Which providers this run may touch, given the key situation and any
    /// explicit `providers` subset.
    fn active_providers(&self) -> Vec<&'static str> {
        let wanted = |p: &str| {
            self.providers
                .as_ref()
                .map(|list| list.iter().any(|x| x.eq_ignore_ascii_case(p)))
                .unwrap_or(true)
        };
        let mut out = Vec::new();
        if wanted("tripo") && keyring_value("tripo").is_some() {
            out.push("tripo");
        }
        if wanted("meshy") && keyring_value("meshy").is_some() {
            out.push("meshy");
        }
        out
    }
}

fn default_true() -> bool {
    true
}

/// Cheap, non-cryptographic fingerprint of everything that changes the output —
/// so an accidental double-click reuses the existing job instead of paying the
/// providers again. Not security-sensitive; `DefaultHasher` is fine.
fn input_hash(image: &Path, opts: &DecomposeOptions) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    if let Ok(bytes) = fs::read(image) {
        bytes.hash(&mut h);
    }
    opts.quality_path.hash(&mut h);
    opts.stub.hash(&mut h);
    opts.resolved_tripo_version().hash(&mut h);
    opts.resolved_meshy_model().hash(&mut h);
    format!("{:?}", opts.active_providers()).hash(&mut h);
    opts.texture_resolution.hash(&mut h);
    opts.quad_topology.hash(&mut h);
    opts.target_polycount.hash(&mut h);
    opts.pbr.hash(&mut h);
    serde_json::to_string(&opts.meshy_extra).unwrap_or_default().hash(&mut h);
    serde_json::to_string(&opts.tripo_extra).unwrap_or_default().hash(&mut h);
    format!("{:016x}", h.finish())
}

#[derive(Serialize, Deserialize)]
struct StateFile {
    version: u32,
    jobs: Vec<DecomposeJob>,
}

// --------------------------------------------------------------- shared helpers

fn now() -> String {
    // Matches the rest of the app: RFC3339-ish, no chrono dependency here.
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let millis = d.subsec_millis();
    let days = secs / 86400;
    let (y, m, day) = civil_from_days(days as i64);
    let tod = secs % 86400;
    format!(
        "{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn stamp() -> String {
    format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

fn keyring_value(name: &str) -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("provider:{name}"))
        .ok()?
        .get_password()
        .ok()
        .filter(|v| !v.trim().is_empty())
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn file_to_data_uri(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok(format!(
        "data:{};base64,{}",
        mime_for(path),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn data_uri_for(project_dir: &Path, rel: &str) -> Result<String, String> {
    file_to_data_uri(&project_dir.join("assets").join(rel))
}

// ---------------------------------------------------------------- state on disk

fn state_path(project_dir: &Path) -> PathBuf {
    project_dir.join(STATE_FILE)
}

fn load_state(project_dir: &Path) -> StateFile {
    fs::read_to_string(state_path(project_dir))
        .ok()
        .and_then(|s| serde_json::from_str::<StateFile>(&s).ok())
        .unwrap_or(StateFile {
            version: STATE_VERSION,
            jobs: Vec::new(),
        })
}

fn save_job(project_dir: &Path, job: &DecomposeJob) -> Result<(), String> {
    let mut state = load_state(project_dir);
    state.version = STATE_VERSION;
    match state.jobs.iter_mut().find(|j| j.id == job.id) {
        Some(existing) => *existing = job.clone(),
        None => state.jobs.push(job.clone()),
    }
    if state.jobs.len() > 100 {
        let overflow = state.jobs.len() - 100;
        state.jobs.drain(0..overflow);
    }
    let serialized = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Could not encode job state: {e}"))?;
    crate::write_json_atomic(state_path(project_dir), &serialized)
}

/// Persist + emit in one call so the UI and disk never diverge.
fn publish(app: &AppHandle, project_dir: &Path, job: &mut DecomposeJob) {
    job.updated_at = now();
    if let Err(e) = save_job(project_dir, job) {
        eprintln!("decompose: could not persist job {}: {e}", job.id);
    }
    let _ = app.emit(PROGRESS_EVENT, job.clone());
}

// -------------------------------------------------------------------- commands

#[tauri::command]
pub async fn decompose_provider_keys() -> HashMap<String, bool> {
    HashMap::from([
        ("tripo".to_string(), keyring_value("tripo").is_some()),
        ("meshy".to_string(), keyring_value("meshy").is_some()),
    ])
}

/// Open the project's `assets/models/` folder (where finished GLBs land) in
/// Explorer. There is no in-app 3D viewer yet, so this is how you get to them.
#[tauri::command]
pub fn reveal_decompose_output(app: AppHandle, dir_name: String) -> Result<(), String> {
    let dir = crate::project_path(&app, &dir_name)?
        .join("assets")
        .join("models");
    let _ = fs::create_dir_all(&dir);
    let mut cmd = std::process::Command::new("explorer");
    cmd.arg(&dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open Explorer: {e}"))
}

#[tauri::command]
pub fn list_decompositions(app: AppHandle, dir_name: String) -> Result<Vec<DecomposeJob>, String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    Ok(load_state(&project_dir).jobs)
}

#[tauri::command]
pub fn get_decomposition(
    app: AppHandle,
    dir_name: String,
    job_id: String,
) -> Result<DecomposeJob, String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    load_state(&project_dir)
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| "No such decomposition job".into())
}

/// Permanently drop a finished/awaiting job from `decompositions.json` and delete
/// its scratch folder (`assets/decompose/<id>/`). Downloaded GLBs in
/// `assets/models/` are left alone. Refuses while the job is still running.
#[tauri::command]
pub fn decompose_forget_job(
    app: AppHandle,
    dir_name: String,
    job_id: String,
) -> Result<(), String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    let mut state = load_state(&project_dir);
    let Some(pos) = state.jobs.iter().position(|j| j.id == job_id) else {
        return Ok(()); // already gone — treat as success
    };
    if matches!(
        state.jobs[pos].status,
        JobStatus::Pending | JobStatus::Decomposing | JobStatus::Modeling
    ) {
        return Err("This job is still running — wait for it to finish first.".into());
    }
    state.jobs.remove(pos);
    state.version = STATE_VERSION;
    let serialized = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Could not encode job state: {e}"))?;
    crate::write_json_atomic(state_path(&project_dir), &serialized)?;
    let _ = fs::remove_dir_all(
        project_dir
            .join("assets")
            .join("decompose")
            .join(&job_id),
    );
    Ok(())
}

/// Ask a running fan-out to stop. Steps that haven't been submitted yet are
/// skipped; steps already in a provider queue stop being polled and are marked
/// failed ("Cancelled") — the provider may still finish them server-side, but we
/// won't download or bill attention to them. No effect once a job is done.
#[tauri::command]
pub fn decompose_cancel_job(
    app: AppHandle,
    dir_name: String,
    job_id: String,
) -> Result<(), String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    if !signal_cancel(&job_id) {
        return Err("This job isn't running.".into());
    }
    if let Some(mut job) = load_state(&project_dir)
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
    {
        job.message = "Stopping…".into();
        let _ = save_job(&project_dir, &job);
        let _ = app.emit(PROGRESS_EVENT, job);
    }
    Ok(())
}

#[tauri::command]
pub async fn decompose_image(
    app: AppHandle,
    dir_name: String,
    image_relative_path: String,
    options: Option<DecomposeOptions>,
) -> Result<String, String> {
    let options = options.unwrap_or_default();
    let project_dir = crate::project_path(&app, &dir_name)?;

    let source = project_dir.join("assets").join(&image_relative_path);
    if !source.is_file() {
        return Err("That image file was not found in the project".into());
    }
    // Segmentation is local and free — it only needs a provider key once you
    // actually press "Send to 3D". The one exception is a one-shot call
    // (`submit: true`), which would chain straight into the paid fan-out.
    if options.submit && options.active_providers().is_empty() {
        return Err(
            "Connect a Tripo or Meshy API key in Settings before decomposing to 3D.".into(),
        );
    }

    let hash = input_hash(&source, &options);

    // Dedup: an identical input that already ran (or is running) is reused
    // rather than re-decomposed and re-billed. `force` opts out.
    if !options.force {
        if let Some(existing) = load_state(&project_dir)
            .jobs
            .into_iter()
            .find(|j| !j.input_hash.is_empty() && j.input_hash == hash && j.status != JobStatus::Error)
        {
            // If the caller wants submission and the match is still only
            // decomposed, kick off its fan-out now; otherwise just hand it back.
            if options.submit && existing.status == JobStatus::Awaiting && !existing.submitted {
                let id = existing.id.clone();
                spawn_fan_out(app, project_dir, existing, options);
                return Ok(id);
            }
            return Ok(existing.id);
        }
    }

    let job = DecomposeJob {
        id: stamp(),
        image_path: image_relative_path.clone(),
        status: JobStatus::Pending,
        message: "Queued".into(),
        error: None,
        quality_path: options.quality_path,
        assets: Vec::new(),
        input_hash: hash,
        submitted: false,
        created_at: now(),
        updated_at: now(),
    };
    save_job(&project_dir, &job)?;
    let _ = app.emit(PROGRESS_EVENT, job.clone());

    let job_id = job.id.clone();
    tauri::async_runtime::spawn(async move {
        let mut job = job;
        if let Err(message) =
            decompose_only(&app, &project_dir, &mut job, &source, options.stub, options.lite).await
        {
            job.status = JobStatus::Error;
            job.error = Some(message.clone());
            job.message = format!("Failed: {message}");
            publish(&app, &project_dir, &mut job);
            return;
        }
        if options.submit {
            if let Err(message) = fan_out(&app, &project_dir, &mut job, &options).await {
                job.status = JobStatus::Error;
                job.error = Some(message.clone());
                job.message = format!("Failed: {message}");
                publish(&app, &project_dir, &mut job);
            }
        }
    });

    Ok(job_id)
}

/// Confirm and run the provider fan-out for a job that was decomposed with
/// `submit: false`. This is the "yes, spend the credits" half of the two-step
/// flow — the UI calls it after showing the object count and cost estimate.
#[tauri::command]
pub async fn submit_decomposition(
    app: AppHandle,
    dir_name: String,
    job_id: String,
    options: Option<DecomposeOptions>,
) -> Result<(), String> {
    let options = options.unwrap_or_default();
    let project_dir = crate::project_path(&app, &dir_name)?;
    let job = load_state(&project_dir)
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or("No such decomposition job")?;
    if job.submitted && job.status != JobStatus::Error {
        return Err("This decomposition has already been sent to 3D.".into());
    }
    if job.assets.is_empty() {
        return Err("This job has no decomposed assets to send.".into());
    }
    if options.active_providers().is_empty() {
        return Err("Connect a Tripo or Meshy API key in Settings first.".into());
    }
    spawn_fan_out(app, project_dir, job, options);
    Ok(())
}

fn spawn_fan_out(app: AppHandle, project_dir: PathBuf, job: DecomposeJob, options: DecomposeOptions) {
    tauri::async_runtime::spawn(async move {
        let mut job = job;
        if let Err(message) = fan_out(&app, &project_dir, &mut job, &options).await {
            job.status = JobStatus::Error;
            job.error = Some(message.clone());
            job.message = format!("Failed: {message}");
            publish(&app, &project_dir, &mut job);
        }
    });
}

// ---------------------------------------------------------------- worker

/// Stage 1: run the Python pipeline, fill `job.assets`, leave the job at
/// `Awaiting` (decomposed, not yet sent to any provider).
async fn decompose_only(
    app: &AppHandle,
    project_dir: &Path,
    job: &mut DecomposeJob,
    source: &Path,
    stub: bool,
    lite: bool,
) -> Result<(), String> {
    job.status = JobStatus::Decomposing;
    job.message = "Segmenting image…".into();
    publish(app, project_dir, job);

    let work_dir = project_dir.join("assets").join("decompose").join(&job.id);
    fs::create_dir_all(&work_dir).map_err(|e| format!("Could not create work folder: {e}"))?;

    let parsed = run_pipeline(app, source, &work_dir, job.quality_path, stub, lite).await?;
    if parsed.is_empty() {
        return Err("The pipeline found no distinct assets in this image".into());
    }

    job.assets = parsed
        .into_iter()
        .map(|raw| into_asset(project_dir, &job.id, raw))
        .collect::<Result<Vec<_>, _>>()?;
    job.status = JobStatus::Awaiting;
    job.message = format!("Found {} asset(s) — awaiting confirmation", job.assets.len());
    publish(app, project_dir, job);
    Ok(())
}

/// Stage 2: build the provider plan and drive it to completion. Safe to call on
/// a job already at `Awaiting`.
async fn fan_out(
    app: &AppHandle,
    project_dir: &Path,
    job: &mut DecomposeJob,
    opts: &DecomposeOptions,
) -> Result<(), String> {
    if job.assets.is_empty() {
        return Err("Nothing to send — this job has no decomposed assets".into());
    }
    let tripo_version = opts.resolved_tripo_version();
    let meshy_model = opts.resolved_meshy_model();

    // Reset any prior model list (e.g. a retry after a failed fan-out).
    for asset in &mut job.assets {
        asset.models.clear();
    }
    job.submitted = true;
    job.status = JobStatus::Modeling;
    job.error = None;

    let clients = Arc::new(Clients::new(
        keyring_value("meshy").as_deref(),
        keyring_value("tripo").as_deref(),
    ));
    let plan = build_plan(job, &clients, project_dir, &tripo_version, &meshy_model, opts);
    job.message = format!(
        "Sending {} generation(s) to {}…",
        plan.len(),
        opts.active_providers().join(" + ")
    );
    publish(app, project_dir, job);
    if plan.is_empty() {
        return Err("No provider is configured for any requested path".into());
    }

    // Submission is rate-limited hard by both providers; polling is not. Hold the
    // `submit_gate` permit only across `clients.submit()`, then drop it so every
    // in-flight task can poll concurrently (under the looser `poll_gate`). This
    // is what keeps a 40+ object fan-out from serializing 6-at-a-time through
    // multi-minute provider queues.
    let submit_gate = Arc::new(Semaphore::new(MAX_INFLIGHT_SUBMISSIONS));
    let poll_gate = Arc::new(Semaphore::new(MAX_INFLIGHT_POLLS));
    let cancel = cancel_token_for(&job.id);
    let shared = Arc::new(Mutex::new(job.clone()));
    let mut handles = Vec::new();

    for step in plan {
        let app = app.clone();
        let project_dir = project_dir.to_path_buf();
        let clients = clients.clone();
        let submit_gate = submit_gate.clone();
        let poll_gate = poll_gate.clone();
        let shared = shared.clone();
        let cancel = cancel.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            let deadline = if step.path_kind == "quality" {
                QUALITY_PATH_DEADLINE
            } else {
                FAST_PATH_DEADLINE
            };

            let emit_snapshot = |guard: &DecomposeJob| {
                let _ = app.emit(PROGRESS_EVENT, guard.clone());
            };

            // --- submit (rate-limited) ---------------------------------------
            if cancel.load(Ordering::SeqCst) {
                let mut guard = shared.lock().await;
                set_model_failed(&mut guard, &step.key, "Cancelled before it started".into());
                emit_snapshot(&guard);
                return;
            }
            let submitted = {
                let _permit = submit_gate.acquire_owned().await.ok();
                if cancel.load(Ordering::SeqCst) {
                    let mut guard = shared.lock().await;
                    set_model_failed(&mut guard, &step.key, "Cancelled before it started".into());
                    emit_snapshot(&guard);
                    return;
                }
                clients.submit(step.operation.clone(), step.params.clone()).await
            };
            let mut task = match submitted {
                Ok(t) => t,
                Err(e) => {
                    let mut guard = shared.lock().await;
                    set_model_failed(&mut guard, &step.key, e);
                    let snap = guard.clone();
                    let _ = save_job(&project_dir, &snap);
                    drop(guard);
                    let _ = app.emit(PROGRESS_EVENT, snap);
                    return;
                }
            };
            {
                let mut guard = shared.lock().await;
                if let Some(m) = find_model_mut(&mut guard, &step.key) {
                    m.status = task_status_str(&task.status).into();
                    m.progress = task.progress;
                    m.task_id = Some(task.task_id.clone());
                }
                emit_snapshot(&guard);
            }

            // --- poll until terminal / deadline / cancel --------------------
            let _poll_permit = poll_gate.acquire_owned().await.ok();
            let started = Instant::now();
            let mut ended: Result<(), String> = Ok(());
            while task.status.is_active() {
                tokio::time::sleep(POLL_EVERY).await;
                if cancel.load(Ordering::SeqCst) {
                    ended = Err("Cancelled".into());
                    break;
                }
                if started.elapsed() > deadline {
                    ended = Err(format!(
                        "Timed out after {}s waiting for the provider",
                        deadline.as_secs()
                    ));
                    break;
                }
                match clients.poll(&step.operation, &task.task_id).await {
                    Ok(updated) => {
                        task = updated;
                        let mut guard = shared.lock().await;
                        if let Some(m) = find_model_mut(&mut guard, &step.key) {
                            m.status = task_status_str(&task.status).into();
                            m.progress = task.progress;
                        }
                        emit_snapshot(&guard);
                    }
                    Err(message) => {
                        if poll_error_is_fatal(&message) {
                            ended = Err(message);
                            break;
                        }
                        // transient — keep waiting, deadline branch is the backstop
                    }
                }
            }

            // --- resolve outcome -------------------------------------------
            let mut guard = shared.lock().await;
            match ended {
                Err(reason) => set_model_failed(&mut guard, &step.key, reason),
                Ok(()) if task.status == TaskStatus::Succeeded => {
                    let glb = task
                        .model_urls
                        .get("glb")
                        .or_else(|| task.model_urls.get("pbr_glb"))
                        .cloned();
                    match glb {
                        Some(url) => {
                            drop(guard);
                            let dl = download_glb(&project_dir, &step.key, &url).await;
                            guard = shared.lock().await;
                            match dl {
                                Ok(rel) => {
                                    if let Some(m) = find_model_mut(&mut guard, &step.key) {
                                        m.status = "succeeded".into();
                                        m.progress = 1.0;
                                        m.glb_path = Some(rel);
                                        m.finished_at = Some(now());
                                    }
                                }
                                Err(e) => set_model_failed(&mut guard, &step.key, e),
                            }
                        }
                        None => set_model_failed(
                            &mut guard,
                            &step.key,
                            "Provider reported success but returned no GLB URL".into(),
                        ),
                    }
                }
                Ok(()) => set_model_failed(
                    &mut guard,
                    &step.key,
                    task.error
                        .clone()
                        .unwrap_or_else(|| format!("Ended as {:?}", task.status)),
                ),
            }
            let snapshot = guard.clone();
            if let Err(e) = save_job(&project_dir, &snapshot) {
                eprintln!("decompose: persist after model step failed: {e}");
            }
            drop(guard);
            let _ = app.emit(PROGRESS_EVENT, snapshot);
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    // 3. Settle.
    let was_cancelled = cancel.load(Ordering::SeqCst);
    clear_cancel(&job.id);
    let mut final_job = shared.lock().await.clone();
    let total: usize = final_job.assets.iter().map(|a| a.models.len()).sum();
    let ok = final_job
        .assets
        .iter()
        .flat_map(|a| &a.models)
        .filter(|m| m.status == "succeeded")
        .count();
    final_job.status = if ok == 0 {
        JobStatus::Error
    } else {
        JobStatus::Done
    };
    final_job.error = if ok == 0 {
        Some(if was_cancelled {
            "Cancelled before any model finished".to_string()
        } else {
            "Every provider job failed".to_string()
        })
    } else {
        None
    };
    final_job.message = if was_cancelled {
        format!("Cancelled — {ok}/{total} models finished first")
    } else {
        format!("Done — {ok}/{total} models generated")
    };
    *job = final_job;
    if ok > 0 {
        if let Err(e) = write_scene_manifest(project_dir, job) {
            eprintln!("decompose: could not write scene.json: {e}");
        }
    }
    publish(app, project_dir, job);
    Ok(())
}

/// A DCC-agnostic description of the finished batch — one GLB per object plus
/// the 2D bbox and source-image size so a Blender / Unreal / Unity importer can
/// lay the pieces back out as a scene. Written to the job's work folder.
fn write_scene_manifest(project_dir: &Path, job: &DecomposeJob) -> Result<(), String> {
    let assets_root = project_dir.join("assets");
    let abs = |rel: &str| assets_root.join(rel).to_string_lossy().replace('\\', "/");

    let objects: Vec<Value> = job
        .assets
        .iter()
        .filter_map(|a| {
            let mut models = Map::new();
            for m in &a.models {
                if let Some(p) = &m.glb_path {
                    models.insert(format!("{}_{}", m.provider, m.path_kind), json!(abs(p)));
                }
            }
            if models.is_empty() {
                return None;
            }
            // Prefer a Fast-path model as the one to place by default.
            let preferred = a
                .models
                .iter()
                .find(|m| m.glb_path.is_some() && m.path_kind == "fast")
                .or_else(|| a.models.iter().find(|m| m.glb_path.is_some()))
                .map(|m| format!("{}_{}", m.provider, m.path_kind));
            Some(json!({
                "id": a.id,
                "class": a.class,
                "bbox": a.bbox,
                "models": Value::Object(models),
                "preferred": preferred,
            }))
        })
        .collect();

    let manifest = json!({
        "version": 1,
        "app": "Cozyverse Studio",
        "job": job.id,
        "sourceImage": abs(&job.image_path),
        "objects": objects,
    });
    let path = project_dir
        .join("assets")
        .join("decompose")
        .join(&job.id)
        .join("scene.json");
    let _ = fs::create_dir_all(path.parent().unwrap());
    crate::write_json_atomic(path, &serde_json::to_string_pretty(&manifest).unwrap())
}

/// Absolute path of a finished job's `scene.json` (see `write_scene_manifest`),
/// so the UI can reveal it / hand it to a DCC importer.
#[tauri::command]
pub fn decompose_scene_path(
    app: AppHandle,
    dir_name: String,
    job_id: String,
) -> Result<String, String> {
    let path = crate::project_path(&app, &dir_name)?
        .join("assets")
        .join("decompose")
        .join(&job_id)
        .join("scene.json");
    if !path.is_file() {
        return Err("No scene file for this job yet.".into());
    }
    // Reveal it in Explorer for the user.
    let mut cmd = std::process::Command::new("explorer");
    cmd.arg(format!("/select,{}", path.display()));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd.spawn();
    Ok(path.to_string_lossy().into_owned())
}

const EXPORT_EVENT: &str = "decompose://export";

/// The five per-object views the pack ships. `slug` is the file/manifest key;
/// `angle` is the phrase dropped into the image-model prompt for the AI pack.
const PACK_VIEWS: [(&str, &str); 5] = [
    ("perspective", "a clean three-quarter hero angle, slightly above eye level"),
    ("front", "a straight-on front view, camera level with the object"),
    ("back", "the view from directly behind the object"),
    ("left", "the left-side profile, camera level with the object"),
    ("right", "the right-side profile, camera level with the object"),
];

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportPackOptions {
    /// Regenerate all five views per object with an image model (Gemini / OpenAI,
    /// **paid**) instead of shipping the local cutout + Zero123++ tiles. Gives
    /// large, clean, consistent renders on a plain background — but the side and
    /// back views are inferred, not observed.
    #[serde(default)]
    pub ai_views: bool,
}

/// How many paid image generations `decompose_export_pack` with `aiViews` would
/// make for a job, and which provider — so the UI can warn before spending.
#[tauri::command]
pub fn decompose_export_pack_estimate(
    app: AppHandle,
    dir_name: String,
    job_id: String,
) -> Result<Value, String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    let job = load_state(&project_dir)
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or("No such decomposition job")?;
    Ok(json!({
        "objects": job.assets.len(),
        "imagesPerObject": PACK_VIEWS.len(),
        "totalImages": job.assets.len() * PACK_VIEWS.len(),
        "provider": crate::providers::image_edit_provider(),
    }))
}

/// The "image path": zip up a job's decomposition images for use in any external
/// image-to-3D tool. Two modes:
///   * default — the pipeline's own outputs: the perspective cutout plus any
///     Zero123++ side views, verbatim. Free, instant.
///   * `aiViews` — regenerate all five views (perspective + front/back/left/right)
///     per object through an image model on a clean background. **Paid**; streams
///     `decompose://export` progress.
/// Returns the saved path, or None if the user cancels the save dialog.
#[tauri::command]
pub async fn decompose_export_pack(
    app: AppHandle,
    dir_name: String,
    job_id: String,
    options: Option<ExportPackOptions>,
) -> Result<Option<String>, String> {
    let ai_views = options.unwrap_or_default().ai_views;
    let project_dir = crate::project_path(&app, &dir_name)?;
    let job = load_state(&project_dir)
        .jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or("No such decomposition job")?;
    if job.assets.is_empty() {
        return Err("This job has no decomposed images.".into());
    }
    if ai_views && crate::providers::image_edit_provider().is_none() {
        return Err("The AI turnaround pack needs a Gemini or OpenAI API key — add one in Settings.".into());
    }

    let assets_root = project_dir.join("assets");
    let default_name = format!(
        "cozyverse-decompose-{}-{}obj{}.zip",
        job_id_short(&job.id),
        job.assets.len(),
        if ai_views { "-ai" } else { "" }
    );
    let dest = match rfd::FileDialog::new()
        .add_filter("Zip archive", &["zip"])
        .set_file_name(&default_name)
        .save_file()
    {
        Some(p) => p,
        None => return Ok(None),
    };

    let file = fs::File::create(&dest).map_err(|e| format!("Could not create the zip: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let add = |zip: &mut zip::ZipWriter<fs::File>, name: &str, path: &Path| -> Result<bool, String> {
        if !path.is_file() {
            return Ok(false);
        }
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        std::io::Write::write_all(zip, &bytes).map_err(|e| e.to_string())?;
        Ok(true)
    };
    let add_bytes = |zip: &mut zip::ZipWriter<fs::File>, name: &str, bytes: &[u8]| -> Result<(), String> {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        std::io::Write::write_all(zip, bytes).map_err(|e| e.to_string())?;
        Ok(())
    };

    let mut added = 0usize;
    let source = assets_root.join(&job.image_path);
    if source.is_file() {
        let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("png");
        if add(&mut zip, &format!("scene/original.{ext}"), &source)? {
            added += 1;
        }
    }

    let total_ai = job.assets.len() * PACK_VIEWS.len();
    let mut done_ai = 0usize;
    let mut manifest_objects = Vec::new();

    for (i, a) in job.assets.iter().enumerate() {
        let slug: String = a
            .class
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
            .collect();
        let folder = format!("objects/{i:02}_{slug}");
        let mut files = Map::new();

        if ai_views {
            // Anchor every view on the pipeline's cutout of this object.
            let subject = match file_to_data_uri(&assets_root.join(&a.perspective_image)) {
                Ok(uri) => uri,
                Err(e) => {
                    eprintln!("decompose export: no cutout for {}: {e}", a.id);
                    done_ai += PACK_VIEWS.len();
                    continue;
                }
            };
            for (slug_name, angle) in PACK_VIEWS {
                let _ = app.emit(
                    EXPORT_EVENT,
                    json!({
                        "jobId": job.id, "done": done_ai, "total": total_ai,
                        "message": format!("{} — {slug_name}", a.class),
                    }),
                );
                let prompt = format!(
                    "Studio product render of the {class} shown in the reference image — {angle}. \
                     The subject is centred and fully in frame on a plain, seamless pure-white \
                     background, soft even lighting, no cast shadow, no other objects, no text or \
                     watermark. Preserve the exact colours, materials, proportions and details of \
                     the reference. Square image.",
                    class = a.class,
                );
                match crate::providers::edit_subject_image(&prompt, &subject).await {
                    Ok(data_uri) => match data_uri
                        .split_once(";base64,")
                        .and_then(|(_, b)| base64::engine::general_purpose::STANDARD.decode(b).ok())
                    {
                        Some(bytes) => {
                            add_bytes(&mut zip, &format!("{folder}/{slug_name}.png"), &bytes)?;
                            files.insert(slug_name.into(), json!(format!("{slug_name}.png")));
                            added += 1;
                        }
                        None => eprintln!("decompose export: {} {slug_name}: unreadable image data", a.id),
                    },
                    Err(e) => eprintln!("decompose export: {} {slug_name} failed: {e}", a.id),
                }
                done_ai += 1;
            }
        } else {
            if add(
                &mut zip,
                &format!("{folder}/perspective.png"),
                &assets_root.join(&a.perspective_image),
            )? {
                files.insert("perspective".into(), json!("perspective.png"));
                added += 1;
            }
            for (name, rel) in [
                ("front", &a.ortho_views.front),
                ("back", &a.ortho_views.back),
                ("left", &a.ortho_views.left),
                ("right", &a.ortho_views.right),
            ] {
                if let Some(rel) = rel {
                    if add(&mut zip, &format!("{folder}/{name}.png"), &assets_root.join(rel))? {
                        files.insert(name.into(), json!(format!("{name}.png")));
                        added += 1;
                    }
                }
            }
        }

        manifest_objects.push(json!({
            "id": a.id,
            "class": a.class,
            "bbox": a.bbox,
            "folder": folder,
            "files": files,
        }));
    }

    if ai_views {
        let _ = app.emit(
            EXPORT_EVENT,
            json!({ "jobId": job.id, "done": total_ai, "total": total_ai, "message": "packing" }),
        );
    }

    if added == 0 {
        drop(zip);
        let _ = fs::remove_file(&dest);
        return Err(if ai_views {
            "Every AI view generation failed — check the API key and provider credit.".into()
        } else {
            "None of this job's decomposition images are on disk any more — nothing to export.".to_string()
        });
    }

    let note = if ai_views {
        "Every view was re-rendered by an image model on a white background. perspective/front = \
         observed; back/left/right are inferred from the front and may not match perfectly. Feed \
         these into any image-to-3D tool."
    } else {
        "perspective.png = the object cut out on white. front/back/left/right = Zero123++ \
         synthesized views (present only when the full pipeline ran with side views on). Feed \
         these into any image-to-3D tool."
    };
    let manifest = serde_json::to_string_pretty(&json!({
        "app": "Cozyverse Studio",
        "job": job.id,
        "mode": if ai_views { "ai-turnaround" } else { "pipeline" },
        "sourceImage": job.image_path,
        "objectCount": job.assets.len(),
        "objects": manifest_objects,
        "note": note,
    }))
    .unwrap();
    zip.start_file("manifest.json", opts).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut zip, manifest.as_bytes()).map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| format!("Could not finish the zip: {e}"))?;
    Ok(Some(dest.to_string_lossy().into_owned()))
}

// ---------------------------------------------------------------- python bridge

#[derive(Deserialize)]
struct RawAsset {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    class: Option<String>,
    #[serde(default)]
    bbox: Option<[f64; 4]>,
    perspective_image: String,
    #[serde(default)]
    ortho_views: RawOrtho,
}

#[derive(Deserialize, Default)]
struct RawOrtho {
    #[serde(default)]
    front: Option<String>,
    #[serde(default)]
    back: Option<String>,
    #[serde(default)]
    left: Option<String>,
    #[serde(default)]
    right: Option<String>,
}

fn resolve_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("COZY_DECOMPOSE_SCRIPT") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
    }
    let mut candidates = Vec::new();
    // Bundled Tauri resource (see tauri.conf.json `bundle.resources`) — the
    // normal case for an installed build.
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("decompose_pipeline.py"));
        candidates.push(dir.join("resources/decompose_pipeline.py"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("decompose_pipeline.py"));
            candidates.push(dir.join("../../../decompose_pipeline.py"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("decompose_pipeline.py"));
        candidates.push(cwd.join("../decompose_pipeline.py"));
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| {
            "decompose_pipeline.py was not found. Set COZY_DECOMPOSE_SCRIPT to its path.".into()
        })
}

async fn run_pipeline(
    app: &AppHandle,
    source: &Path,
    work_dir: &Path,
    quality: bool,
    stub: bool,
    lite: bool,
) -> Result<Vec<RawAsset>, String> {
    let script = resolve_script(app)?;
    let python = crate::decompose_setup::resolve_python();
    // Serialize: one decomposition subprocess at a time (see PIPELINE_LOCK).
    let _permit = PIPELINE_LOCK.acquire().await.map_err(|e| e.to_string())?;

    let mut cmd = tokio::process::Command::new(&python);
    cmd.arg(&script)
        .arg("--image")
        .arg(source)
        .arg("--out")
        .arg(work_dir)
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console pop-up
    if stub {
        cmd.arg("--stub");
    } else if lite {
        cmd.arg("--lite");
    } else if quality {
        cmd.arg("--quality");
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Could not start Python ({python}): {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let tail: String = err
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("Decomposition script failed:\n{tail}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let payload = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("");
    let value: Value = serde_json::from_str(payload)
        .map_err(|e| format!("Could not parse pipeline output as JSON: {e}\n---\n{payload}"))?;
    let arr = value.as_array().ok_or("Pipeline output was not a JSON array")?;
    arr.iter()
        .cloned()
        .map(|v| serde_json::from_value::<RawAsset>(v).map_err(|e| format!("Bad asset entry: {e}")))
        .collect()
}

/// Turn a raw pipeline asset into our model, normalizing every image path to be
/// relative to the project's `assets/` dir. The script writes into
/// `assets/decompose/<job>/…`, so paths already sit under the project — we just
/// make them relative and verify they exist.
fn into_asset(project_dir: &Path, job_id: &str, raw: RawAsset) -> Result<DecomposedAsset, String> {
    let assets_root = project_dir.join("assets");
    let root = assets_root
        .canonicalize()
        .map_err(|e| format!("assets/ missing: {e}"))?;
    let rel = |p: &str| -> Result<String, String> {
        let candidate = PathBuf::from(p);
        let abs = if candidate.is_absolute() {
            candidate
        } else {
            assets_root.join(&candidate)
        };
        let abs = abs
            .canonicalize()
            .map_err(|_| format!("Pipeline referenced a missing file: {p}"))?;
        let stripped = abs
            .strip_prefix(&root)
            .map_err(|_| format!("Pipeline wrote outside assets/: {p}"))?;
        Ok(stripped.to_string_lossy().replace('\\', "/"))
    };
    let opt = |o: Option<String>| -> Result<Option<String>, String> {
        match o {
            Some(p) if !p.is_empty() => rel(&p).map(Some),
            _ => Ok(None),
        }
    };

    let raw_id = raw.id.unwrap_or_else(|| format!("asset_{}", &stamp()[..6]));
    let class = raw.class.unwrap_or_else(|| "object".into());
    let front = opt(raw.ortho_views.front)?;
    let back = opt(raw.ortho_views.back)?;
    let left = opt(raw.ortho_views.left)?;
    let right = opt(raw.ortho_views.right)?;
    Ok(DecomposedAsset {
        id: format!("{}_{}", job_id_short(job_id), raw_id),
        class,
        bbox: raw.bbox.unwrap_or([0.0, 0.0, 0.0, 0.0]),
        perspective_image: rel(&raw.perspective_image)?,
        ortho_views: OrthoViews {
            front,
            back,
            left,
            right,
        },
        models: Vec::new(),
    })
}

fn job_id_short(job_id: &str) -> &str {
    &job_id[..job_id.len().min(6)]
}

// ---------------------------------------------------------------- provider plan

struct Step {
    key: String,
    path_kind: String,
    operation: Operation,
    params: HashMap<String, Value>,
}

fn build_plan(
    job: &mut DecomposeJob,
    clients: &Clients,
    project_dir: &Path,
    tripo_version: &str,
    meshy_model: &str,
    opts: &DecomposeOptions,
) -> Vec<Step> {
    let mut steps = Vec::new();
    let active = opts.active_providers();
    let providers = [
        ("tripo", clients.has(&Provider::Tripo) && active.contains(&"tripo")),
        ("meshy", clients.has(&Provider::Meshy) && active.contains(&"meshy")),
    ];

    for asset in &mut job.assets {
        let persp_uri = data_uri_for(project_dir, &asset.perspective_image);
        let ortho = OrthoViews {
            front: asset
                .ortho_views
                .front
                .as_deref()
                .and_then(|p| data_uri_for(project_dir, p).ok()),
            back: asset
                .ortho_views
                .back
                .as_deref()
                .and_then(|p| data_uri_for(project_dir, p).ok()),
            left: asset
                .ortho_views
                .left
                .as_deref()
                .and_then(|p| data_uri_for(project_dir, p).ok()),
            right: asset
                .ortho_views
                .right
                .as_deref()
                .and_then(|p| data_uri_for(project_dir, p).ok()),
        };
        let quality_ok =
            opts.quality_path && ortho.has_front() && ortho.populated_count() >= 2;

        for (provider, enabled) in providers {
            if !enabled {
                continue;
            }
            if let Ok(uri) = &persp_uri {
                let key = format!("{}_{}_perspective", asset.id, provider);
                let (operation, params) =
                    single_image_params(provider, uri, tripo_version, meshy_model, opts);
                asset.models.push(new_model_job(&key, provider, "single-image", "fast"));
                steps.push(Step {
                    key,
                    path_kind: "fast".into(),
                    operation,
                    params,
                });
            }
            if quality_ok {
                let key = format!("{}_{}_multiview", asset.id, provider);
                let (operation, params) =
                    multi_view_params(provider, &ortho, tripo_version, meshy_model, opts);
                asset.models.push(new_model_job(&key, provider, "multi-view", "quality"));
                steps.push(Step {
                    key,
                    path_kind: "quality".into(),
                    operation,
                    params,
                });
            }
        }
    }
    steps
}

fn new_model_job(key: &str, provider: &str, mode: &str, path_kind: &str) -> ModelJob {
    ModelJob {
        key: key.to_string(),
        provider: provider.to_string(),
        mode: mode.to_string(),
        path_kind: path_kind.to_string(),
        status: "pending".to_string(),
        progress: 0.0,
        task_id: None,
        glb_path: None,
        error: None,
        finished_at: None,
    }
}

fn single_image_params(
    provider: &str,
    image_uri: &str,
    tripo_version: &str,
    meshy_model: &str,
    opts: &DecomposeOptions,
) -> (Operation, HashMap<String, Value>) {
    match provider {
        "tripo" => {
            let mut p = HashMap::from([
                ("image_url".to_string(), json!(image_uri)),
                ("model_version".into(), json!(tripo_version)),
                ("texture".into(), json!(true)),
                // Register the texture against the source image (ModelForge's
                // verified default for image/multiview generation).
                ("texture_alignment".into(), json!("original_image")),
            ]);
            apply_common_knobs(&mut p, "tripo", opts);
            (Operation::TripoImageTo3D, p)
        }
        _ => {
            let mut p = HashMap::from([
                ("image_url".to_string(), json!(image_uri)),
                ("ai_model".into(), json!(meshy_model)),
                ("should_texture".into(), json!(true)),
            ]);
            apply_common_knobs(&mut p, "meshy", opts);
            (Operation::MeshyImageTo3D, p)
        }
    }
}

fn multi_view_params(
    provider: &str,
    ortho: &OrthoViews,
    tripo_version: &str,
    meshy_model: &str,
    opts: &DecomposeOptions,
) -> (Operation, HashMap<String, Value>) {
    let ordered = ortho.ordered_for_provider(); // [front, left, back, right]
    let list: Vec<Value> = ordered.iter().map(|s| json!(s)).collect();
    match provider {
        "tripo" => {
            let mut p = HashMap::from([
                ("image_urls".to_string(), json!(list)),
                ("model_version".into(), json!(tripo_version)),
                ("texture".into(), json!(true)),
                ("texture_alignment".into(), json!("original_image")),
            ]);
            apply_common_knobs(&mut p, "tripo", opts);
            (Operation::TripoMultiviewTo3D, p)
        }
        _ => {
            let mut p = HashMap::from([
                ("image_urls".to_string(), json!(list)),
                ("ai_model".into(), json!(meshy_model)),
                ("should_texture".into(), json!(true)),
            ]);
            apply_common_knobs(&mut p, "meshy", opts);
            (Operation::MeshyMultiImageTo3D, p)
        }
    }
}

/// Fold the shared quality knobs (`DecomposeOptions`) into a provider param map,
/// then merge that provider's raw `*_extra` passthrough LAST so it always wins.
/// Field names follow ModelForge 1.3.0's catalog; Meshy 7 / Tripo V3.1 accept
/// the same keys plus more you can reach through `meshyExtra` / `tripoExtra`.
fn apply_common_knobs(p: &mut HashMap<String, Value>, provider: &str, opts: &DecomposeOptions) {
    let pbr = opts.pbr.unwrap_or(true);
    match provider {
        "tripo" => {
            p.insert("pbr".into(), json!(pbr));
            if let Some(res) = opts.texture_resolution {
                // Tripo takes a quality tier, not a pixel count.
                p.insert(
                    "texture_quality".into(),
                    json!(if res >= 4096 { "detailed" } else { "standard" }),
                );
            }
            if opts.quad_topology == Some(true) {
                p.insert("quad".into(), json!(true));
            }
            if let Some(faces) = opts.target_polycount {
                p.insert("face_limit".into(), json!(faces));
            }
            if let Some(extra) = &opts.tripo_extra {
                for (k, v) in extra {
                    p.insert(k.clone(), v.clone());
                }
            }
        }
        _ => {
            p.insert("enable_pbr".into(), json!(pbr));
            if let Some(res) = opts.texture_resolution {
                p.insert("texture_resolution".into(), json!(res));
            }
            if opts.quad_topology == Some(true) {
                p.insert("topology".into(), json!("quad"));
            }
            if let Some(faces) = opts.target_polycount {
                p.insert("target_polycount".into(), json!(faces));
                p.insert("should_remesh".into(), json!(true));
            }
            if let Some(extra) = &opts.meshy_extra {
                for (k, v) in extra {
                    p.insert(k.clone(), v.clone());
                }
            }
        }
    }
}

// ---------------------------------------------------------------- mutation helpers

fn find_model_mut<'a>(job: &'a mut DecomposeJob, key: &str) -> Option<&'a mut ModelJob> {
    job.assets
        .iter_mut()
        .flat_map(|a| a.models.iter_mut())
        .find(|m| m.key == key)
}

fn set_model_failed(job: &mut DecomposeJob, key: &str, message: String) {
    if let Some(m) = find_model_mut(job, key) {
        m.status = "failed".into();
        m.error = Some(message);
        m.finished_at = Some(now());
    }
}

fn task_status_str(s: &TaskStatus) -> &'static str {
    match s {
        TaskStatus::Pending => "pending",
        TaskStatus::Running => "running",
        TaskStatus::Succeeded => "succeeded",
        TaskStatus::Failed | TaskStatus::Cancelled => "failed",
    }
}

async fn download_glb(project_dir: &Path, key: &str, url: &str) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Refusing to download a model from a non-HTTPS URL".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not download model: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Model download failed ({})", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Could not read model bytes: {e}"))?;
    let dir = project_dir.join("assets").join("models");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{key}-{}.glb", &stamp()[..8]);
    fs::write(dir.join(&name), &bytes).map_err(|e| format!("Could not save model: {e}"))?;
    Ok(format!("models/{name}"))
}
