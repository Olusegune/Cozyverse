//! One-time, in-app provisioning of the Python runtime the full decomposition
//! pipeline needs (PyTorch + transformers + diffusers). Everything lives in an
//! isolated venv under `%LOCALAPPDATA%\Cozyverse Studio\pyenv` that Cozyverse
//! owns — the user's system Python is only borrowed to bootstrap the venv and is
//! never modified. Progress streams as `decompose://setup` events.

use serde::Serialize;
use std::{
    path::PathBuf,
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const SETUP_EVENT: &str = "decompose://setup";
static SETUP_RUNNING: AtomicBool = AtomicBool::new(false);

pub(crate) fn pyenv_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("Cozyverse Studio").join("pyenv")
}

fn managed_python() -> Option<PathBuf> {
    let p = pyenv_dir().join("Scripts").join("python.exe");
    p.is_file().then_some(p)
}

/// Interpreter `run_pipeline` should use: the managed venv if present, then
/// `COZY_PYTHON`, then bare `python`.
pub(crate) fn resolve_python() -> String {
    if let Some(p) = managed_python() {
        return p.to_string_lossy().into_owned();
    }
    std::env::var("COZY_PYTHON").unwrap_or_else(|_| "python".into())
}

// --------------------------------------------------------------------- status

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    python: String,
    managed: bool,
    /// torch + transformers + diffusers — the multi-object + ortho-view pipeline.
    full_ready: bool,
    /// ultralytics (+ rembg) — the CPU-friendly boxes + mattes pipeline.
    lite_ready: bool,
    /// `full_ready || lite_ready` — at least one real pipeline works.
    ready: bool,
    gpu: Option<String>,
    detail: String,
    installing: bool,
}

#[tauri::command]
pub async fn decompose_runtime_status() -> RuntimeStatus {
    let python = resolve_python();
    let managed = managed_python().is_some();
    let installing = SETUP_RUNNING.load(Ordering::SeqCst);

    const PROBE: &str = "import json\nr = {'full': False, 'lite': False, 'gpu': None}\ntry:\n import torch, transformers, diffusers\n r['full'] = True\n r['gpu'] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None\nexcept Exception:\n pass\ntry:\n import ultralytics\n r['lite'] = True\n if r['gpu'] is None:\n  import torch as _t\n  r['gpu'] = _t.cuda.get_device_name(0) if _t.cuda.is_available() else None\nexcept Exception:\n pass\nprint(json.dumps(r))";

    let probe = Command::new(&python).arg("-c").arg(PROBE).output().await;
    let (full_ready, lite_ready, gpu) = match probe {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout);
            let last = out.trim().lines().last().unwrap_or("");
            let v: serde_json::Value = serde_json::from_str(last).unwrap_or_default();
            (
                v.get("full").and_then(|b| b.as_bool()).unwrap_or(false),
                v.get("lite").and_then(|b| b.as_bool()).unwrap_or(false),
                v.get("gpu").and_then(|g| g.as_str()).map(str::to_string),
            )
        }
        Err(_) => (false, false, None),
    };

    let ready = full_ready || lite_ready;
    let detail = if full_ready {
        match &gpu {
            Some(g) => format!("full pipeline · {g}"),
            None => "full pipeline · no CUDA GPU (slow)".into(),
        }
    } else if lite_ready {
        "CPU".into()
    } else {
        "not set up".into()
    };

    RuntimeStatus {
        python,
        managed,
        full_ready,
        lite_ready,
        ready,
        gpu,
        detail,
        installing,
    }
}

// ---------------------------------------------------------------------- setup

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SetupProgress {
    phase: String,
    message: String,
    percent: u8,
    done: bool,
    error: Option<String>,
}

fn emit(app: &AppHandle, phase: &str, message: &str, percent: u8) {
    let _ = app.emit(
        SETUP_EVENT,
        SetupProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            percent: percent.min(100),
            done: false,
            error: None,
        },
    );
}

#[tauri::command]
pub async fn setup_decompose_runtime(app: AppHandle, mode: Option<String>) -> Result<(), String> {
    if SETUP_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Setup is already running.".into());
    }
    let result = match mode.as_deref() {
        Some("lite") => do_setup_lite(&app).await,
        _ => do_setup(&app).await,
    };
    SETUP_RUNNING.store(false, Ordering::SeqCst);
    let _ = app.emit(
        SETUP_EVENT,
        match &result {
            Ok(()) => SetupProgress {
                phase: "done".into(),
                message: "Runtime ready.".into(),
                percent: 100,
                done: true,
                error: None,
            },
            Err(e) => SetupProgress {
                phase: "error".into(),
                message: e.clone(),
                percent: 0,
                done: true,
                error: Some(e.clone()),
            },
        },
    );
    result
}

/// Run a child process, streaming its output lines as progress within
/// `[base, base+span]`. Percent inches forward per line (capped) rather than
/// parsing pip's format, which is not stable.
async fn run_streamed(
    app: &AppHandle,
    phase: &str,
    base: u8,
    span: u8,
    program: &str,
    args: &[&str],
) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start {program}: {e}"))?;

    // Drain stderr so the pipe can't fill and deadlock the child.
    if let Some(err) = child.stderr.take() {
        tokio::spawn(async move {
            let mut l = BufReader::new(err).lines();
            while let Ok(Some(_)) = l.next_line().await {}
        });
    }

    let stdout = child.stdout.take().expect("piped stdout");
    let mut lines = BufReader::new(stdout).lines();
    let mut seen: u32 = 0;
    while let Ok(Some(line)) = lines.next_line().await {
        seen += 1;
        let frac = (seen.min(40) as u32 * span as u32) / 40;
        let pct = (base as u32 + frac).min(99) as u8;
        let short: String = line.trim().chars().take(90).collect();
        if !short.is_empty() {
            emit(app, phase, &short, pct);
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("The {phase} step failed (exit {:?}).", status.code()));
    }
    Ok(())
}

/// Version-check the system Python, create the managed venv if absent, upgrade
/// pip, and return the venv interpreter path.
async fn ensure_venv(app: &AppHandle) -> Result<String, String> {
    let pyenv = pyenv_dir();

    emit(app, "env", "Locating Python…", 2);
    let base = std::env::var("COZY_PYTHON").unwrap_or_else(|_| "python".into());
    let ver = Command::new(&base).arg("--version").output().await.map_err(|_| {
        "Python 3.10+ must be on PATH to run setup. Install it from python.org, then retry — or use Stub mode, which needs nothing.".to_string()
    })?;
    if !ver.status.success() {
        return Err("The Python on PATH did not respond to `--version`.".into());
    }

    if managed_python().is_none() {
        emit(app, "env", "Creating an isolated environment…", 5);
        if let Some(parent) = pyenv.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let s = Command::new(&base)
            .arg("-m")
            .arg("venv")
            .arg(&pyenv)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !s.status.success() {
            return Err(format!(
                "Could not create the environment: {}",
                String::from_utf8_lossy(&s.stderr).trim()
            ));
        }
    }

    let py = pyenv
        .join("Scripts")
        .join("python.exe")
        .to_string_lossy()
        .into_owned();

    emit(app, "pip", "Updating the installer…", 8);
    run_streamed(
        app,
        "pip",
        8,
        3,
        &py,
        &["-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "pip"],
    )
    .await?;
    Ok(py)
}

/// Quick, CPU-only pipeline: YOLO-World boxes + rembg mattes. ~400 MB, no CUDA.
async fn do_setup_lite(app: &AppHandle) -> Result<(), String> {
    let py = ensure_venv(app).await?;

    emit(app, "lite", "Installing the quick pipeline (~400 MB)…", 12);
    run_streamed(
        app,
        "lite",
        12,
        75,
        &py,
        &[
            "-m", "pip", "install", "--disable-pip-version-check",
            "ultralytics", "rembg", "onnxruntime", "numpy<2", "pillow",
        ],
    )
    .await?;

    emit(app, "models", "Fetching the detection model…", 90);
    // set_classes() is what triggers ultralytics' one-time CLIP fetch + the
    // text-encoder weight download, so warm that here (not just YOLO(...)) —
    // otherwise the first real run stalls mid-decompose.
    let _ = Command::new(&py)
        .arg("-c")
        .arg("from ultralytics import YOLO\nm = YOLO('yolov8s-worldv2.pt')\nm.set_classes(['sofa', 'lamp', 'table'])\ntry:\n from rembg import new_session\n new_session('u2net')\nexcept Exception:\n pass\nprint('lite ready')")
        .output()
        .await;
    Ok(())
}

async fn do_setup(app: &AppHandle) -> Result<(), String> {
    let py = ensure_venv(app).await?;

    emit(app, "torch", "Downloading PyTorch with CUDA — the big one (~2.5 GB)…", 12);
    run_streamed(
        app,
        "torch",
        12,
        55,
        &py,
        &[
            "-m", "pip", "install", "--disable-pip-version-check",
            "torch", "torchvision",
            "--index-url", "https://download.pytorch.org/whl/cu124",
        ],
    )
    .await?;

    emit(app, "ml", "Installing transformers and diffusers…", 70);
    run_streamed(
        app,
        "ml",
        70,
        18,
        &py,
        &[
            "-m", "pip", "install", "--disable-pip-version-check",
            "numpy<2", "transformers", "accelerate", "diffusers",
            "safetensors", "timm", "einops", "huggingface_hub",
        ],
    )
    .await?;

    emit(app, "models", "Fetching the segmentation models…", 90);
    const FETCH: &str = "from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection, SamModel, SamProcessor\nAutoProcessor.from_pretrained('IDEA-Research/grounding-dino-base')\nAutoModelForZeroShotObjectDetection.from_pretrained('IDEA-Research/grounding-dino-base')\nSamProcessor.from_pretrained('facebook/sam-vit-base')\nSamModel.from_pretrained('facebook/sam-vit-base')\nprint('models ready')";
    let _ = Command::new(&py).arg("-c").arg(FETCH).output().await;

    Ok(())
}
