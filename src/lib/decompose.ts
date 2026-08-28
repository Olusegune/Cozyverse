// Bridge to the Rust `decompose` module (src-tauri/src/decompose.rs): turn a
// generated image into semantic asset groups and fan them out to Tripo + Meshy
// along a Fast Path (perspective crop → single-image) and a Quality Path
// (4 ortho views → multi-view), in parallel.
//
// Job progress arrives as whole-job `decompose://progress` events. This module
// keeps the latest snapshot of every job in a tiny external store so any
// component can read it with `useDecompositions()` without touching the main
// Zustand store.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

export type JobStatus = "pending" | "decomposing" | "awaiting" | "modeling" | "done" | "error";
export type ModelStatus = "pending" | "running" | "succeeded" | "failed";

export type OrthoViews = {
  front?: string | null;
  back?: string | null;
  left?: string | null;
  right?: string | null;
};

export type ModelJob = {
  key: string;
  provider: "tripo" | "meshy" | string;
  mode: "single-image" | "multi-view" | string;
  pathKind: "fast" | "quality" | string;
  status: ModelStatus;
  progress: number;
  taskId?: string | null;
  glbPath?: string | null;
  error?: string | null;
  finishedAt?: string | null;
};

export type DecomposedAsset = {
  id: string;
  class: string;
  bbox: [number, number, number, number];
  perspectiveImage: string;
  orthoViews: OrthoViews;
  models: ModelJob[];
};

export type DecomposeJob = {
  id: string;
  imagePath: string;
  status: JobStatus;
  message: string;
  error?: string | null;
  qualityPath: boolean;
  assets: DecomposedAsset[];
  inputHash: string;
  submitted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DecomposeOptions = {
  /** Also run the 4-view Quality Path (default true). */
  qualityPath?: boolean;
  /** Pillow-only wiring test — no models (default false). */
  stub?: boolean;
  /** CPU pipeline (YOLO-World + rembg, no ortho views). Set when the full runtime isn't installed. */
  lite?: boolean;
  /** When false, stop after segmentation and wait for `submitDecomposition` (default true). */
  submit?: boolean;
  /** Bypass the identical-input dedup check. */
  force?: boolean;
  /** Restrict fan-out to a subset of ["tripo","meshy"] (default: all keyed). */
  providers?: string[];
  /** Only fan out these decomposed-asset ids (the confirm-block object picker). */
  assetIds?: string[];
  tripoModelVersion?: string;
  /** Default "meshy-7"; pass "latest" to always float to the newest tier. */
  meshyModel?: string;
  /** Texture px (Meshy 7 up to 8192; Tripo ≥4096 → "detailed"). */
  textureResolution?: number;
  quadTopology?: boolean;
  targetPolycount?: number;
  pbr?: boolean;
  /** Raw params merged verbatim into every Meshy request. */
  meshyExtra?: Record<string, unknown>;
  /** Raw params merged verbatim into every Tripo request. */
  tripoExtra?: Record<string, unknown>;
};

// ---- commands -------------------------------------------------------------

export async function startDecompose(
  dirName: string,
  imageRelativePath: string,
  options?: DecomposeOptions,
): Promise<string> {
  const jobId = await invoke<string>("decompose_image", {
    dirName,
    imageRelativePath,
    options: options ?? null,
  });
  return jobId;
}

/** Confirm the (paid) provider fan-out for a job decomposed with `submit: false`. */
export async function submitDecomposition(
  dirName: string,
  jobId: string,
  options?: DecomposeOptions,
): Promise<void> {
  await invoke("submit_decomposition", { dirName, jobId, options: options ?? null });
}

export async function listDecompositions(dirName: string): Promise<DecomposeJob[]> {
  return invoke<DecomposeJob[]>("list_decompositions", { dirName });
}

export async function getDecomposition(dirName: string, jobId: string): Promise<DecomposeJob> {
  return invoke<DecomposeJob>("get_decomposition", { dirName, jobId });
}

export async function decomposeProviderKeys(): Promise<Record<string, boolean>> {
  return invoke<Record<string, boolean>>("decompose_provider_keys");
}

/** Open the project's assets/models/ folder (finished GLBs) in Explorer. */
export async function revealDecomposeOutput(dirName: string): Promise<void> {
  await invoke("reveal_decompose_output", { dirName });
}

/** Reveal a finished job's scene.json (for the Blender / DCC importer) and
 * return its absolute path. */
export async function decomposeScenePath(dirName: string, jobId: string): Promise<string> {
  return invoke<string>("decompose_scene_path", { dirName, jobId });
}

/** The "image path": save a .zip of a job's decomposition images via a Save
 * dialog. Returns the saved path, or null if cancelled.
 * - default: the pipeline's own outputs (cutout + any Zero123++ views). Free.
 * - `aiViews`: regenerate all five views per object (perspective + front/back/
 *   left/right) through an image model on a white background. **Paid**; streams
 *   `decompose://export` progress (see `useExportProgress`). */
export async function exportDecomposePack(
  dirName: string,
  jobId: string,
  aiViews = false,
): Promise<string | null> {
  return invoke<string | null>("decompose_export_pack", {
    dirName,
    jobId,
    options: aiViews ? { aiViews: true } : null,
  });
}

export type ExportPackEstimate = {
  objects: number;
  imagesPerObject: number;
  totalImages: number;
  provider: string | null;
};

/** How many paid image generations the AI turnaround pack would make, + which
 * provider (null = no Gemini/OpenAI key). */
export async function exportPackEstimate(
  dirName: string,
  jobId: string,
): Promise<ExportPackEstimate> {
  return invoke<ExportPackEstimate>("decompose_export_pack_estimate", { dirName, jobId });
}

export type ExportProgress = {
  jobId: string;
  done: number;
  total: number;
  message: string;
};

const exportListeners = new Set<() => void>();
let exportSnapshot: ExportProgress | null = null;
let exportListening = false;

function ensureExportListening() {
  if (exportListening) return;
  exportListening = true;
  void listen<ExportProgress>("decompose://export", (e) => {
    exportSnapshot = e.payload;
    exportListeners.forEach((l) => l());
  });
}

/** Latest AI-turnaround export progress (any job), or null. */
export function useExportProgress(): ExportProgress | null {
  ensureExportListening();
  return useSyncExternalStore(
    (cb) => {
      exportListeners.add(cb);
      return () => exportListeners.delete(cb);
    },
    () => exportSnapshot,
    () => exportSnapshot,
  );
}

// ---- full-pipeline runtime (torch/transformers) --------------------------

export type RuntimeStatus = {
  python: string;
  managed: boolean;
  /** torch + transformers + diffusers — multi-object + ortho views. */
  fullReady: boolean;
  /** ultralytics (+ rembg) — CPU boxes + mattes, no ortho views. */
  liteReady: boolean;
  /** fullReady || liteReady. */
  ready: boolean;
  gpu?: string | null;
  detail: string;
  installing: boolean;
};

export async function decomposeRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("decompose_runtime_status");
}

/** Kick off a one-time pipeline install into an isolated venv.
 * `"lite"` ≈ 400 MB CPU stack; `"full"` ≈ 3 GB CUDA + diffusion stack.
 * Progress arrives as `decompose://setup` events. */
export async function setupDecomposeRuntime(mode: "lite" | "full" = "full"): Promise<void> {
  await invoke("setup_decompose_runtime", { mode });
}

export type SetupProgress = {
  phase: string;
  message: string;
  percent: number;
  done: boolean;
  error?: string | null;
};

const setupListeners = new Set<() => void>();
let setupSnapshot: SetupProgress | null = null;
let setupListening = false;

function ensureSetupListening() {
  if (setupListening) return;
  setupListening = true;
  void listen<SetupProgress>("decompose://setup", (e) => {
    setupSnapshot = e.payload;
    setupListeners.forEach((l) => l());
  });
}

export function useSetupProgress(): SetupProgress | null {
  ensureSetupListening();
  return useSyncExternalStore(
    (cb) => {
      setupListeners.add(cb);
      return () => setupListeners.delete(cb);
    },
    () => setupSnapshot,
    () => setupSnapshot,
  );
}

// ---- live snapshot store ------------------------------------------------

const jobs = new Map<string, DecomposeJob>();
const listeners = new Set<() => void>();
let snapshot: DecomposeJob[] = [];
let started = false;

function rebuild() {
  snapshot = [...jobs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  listeners.forEach((l) => l());
}

function ingest(job: DecomposeJob) {
  jobs.set(job.id, job);
  rebuild();
}

function ensureListening() {
  if (started) return;
  started = true;
  void listen<DecomposeJob>("decompose://progress", (event) => ingest(event.payload));
}

/** Merge whatever is already on disk for this project into the live store. */
export async function hydrateDecompositions(dirName: string): Promise<void> {
  ensureListening();
  try {
    const existing = await listDecompositions(dirName);
    existing.forEach((j) => jobs.set(j.id, j));
    rebuild();
  } catch {
    /* project may have no decompositions.json yet */
  }
}

export function useDecompositions(): DecomposeJob[] {
  ensureListening();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}

// ---- derived helpers --------------------------------------------------

export function jobProgress(job: DecomposeJob): { done: number; total: number; failed: number } {
  const models = job.assets.flatMap((a) => a.models);
  return {
    total: models.length,
    done: models.filter((m) => m.status === "succeeded").length,
    failed: models.filter((m) => m.status === "failed").length,
  };
}

export function isJobActive(job: DecomposeJob): boolean {
  return (
    job.status === "pending" ||
    job.status === "decomposing" ||
    job.status === "modeling"
  );
}

function assetHasQualityViews(a: DecomposedAsset): boolean {
  const v = a.orthoViews;
  const populated = [v.front, v.back, v.left, v.right].filter((x) => x).length;
  return Boolean(v.front) && populated >= 2;
}

/** Up-front cost estimate for the confirm dialog. `providerCount` = how many of
 * {tripo, meshy} will actually run (keyed ∩ chosen). */
export function estimateGenerations(
  job: DecomposeJob,
  providerCount: number,
  qualityPath: boolean,
  isSelected?: (assetId: string) => boolean,
): number {
  return job.assets.reduce((sum, a) => {
    if (isSelected && !isSelected(a.id)) return sum;
    const perProvider = 1 + (qualityPath && assetHasQualityViews(a) ? 1 : 0);
    return sum + providerCount * perProvider;
  }, 0);
}

/** Permanently forget a job: drop it from decompositions.json and delete its
 * scratch folder. Downloaded GLBs are kept. No-op server-side if already gone. */
export async function forgetJob(dirName: string, jobId: string): Promise<void> {
  await invoke("decompose_forget_job", { dirName, jobId });
}

/** Ask a running fan-out to stop. Already-finished models are kept; the rest are
 * marked failed ("Cancelled"). Throws if the job isn't running. */
export async function cancelJob(dirName: string, jobId: string): Promise<void> {
  await invoke("decompose_cancel_job", { dirName, jobId });
}

/** Re-run only the model steps that failed on a finished job. Paid, but scoped
 * to the failures. Throws if nothing failed or the job is still running. */
export async function retryFailed(dirName: string, jobId: string): Promise<void> {
  await invoke("decompose_retry_failed", { dirName, jobId });
}

/** Current provider credit balances (null = no key / unreadable). Tripo and
 * Meshy use different units — display, don't compare across them. */
export async function providerBalance(): Promise<Record<string, number | null>> {
  return invoke<Record<string, number | null>>("decompose_provider_balance");
}

/** A loadable URL for a file the pipeline wrote under the project's assets/ dir
 * (relative path, e.g. "models/foo.glb" or "decompose/<job>/asset_0_perspective.png").
 * Returns null if the file is gone. */
export async function decomposeAssetUrl(
  dirName: string,
  relUnderAssets: string,
): Promise<string | null> {
  try {
    const abs = await invoke<string>("decompose_file_path", { dirName, relUnderAssets });
    return convertFileSrc(abs);
  } catch {
    return null;
  }
}

const hidden = new Set<string>();
/** Remove a job from the panel. With `dirName`, also deletes it on disk so it
 * doesn't come back on the next hydrate; without, it's hidden for this session. */
export function hideJob(id: string, dirName?: string) {
  hidden.add(id);
  if (dirName) {
    jobs.delete(id);
    void forgetJob(dirName, id).catch(() => {
      /* running job, or already gone — the client-side hide still stands */
    });
  }
  rebuild();
}
export function isHidden(id: string): boolean {
  return hidden.has(id);
}
/** Dismiss every job that isn't currently running (done / error / awaiting). */
export function clearFinishedJobs(dirName?: string) {
  for (const j of snapshot) {
    if (j.status === "done" || j.status === "error" || j.status === "awaiting") {
      hidden.add(j.id);
      if (dirName) {
        jobs.delete(j.id);
        void forgetJob(dirName, j.id).catch(() => {});
      }
    }
  }
  rebuild();
}

// ---- stub-mode toggle (module-level so the panel sets it and Image Studio reads it) ----

let stubMode = false;
const stubListeners = new Set<() => void>();

export function getStubMode(): boolean {
  return stubMode;
}

export function setStubMode(value: boolean) {
  stubMode = value;
  stubListeners.forEach((l) => l());
}

export function useStubMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      stubListeners.add(cb);
      return () => stubListeners.delete(cb);
    },
    () => stubMode,
    () => stubMode,
  );
}

// ---- 4-view synthesis toggle -------------------------------------------
// When on (default), the full pipeline also runs Zero123++ to synthesize
// left/back/right views per object — needed for the Quality path and for a
// richer image-pack export, but ~90 s of extra GPU time. Off = perspective
// crops only, much faster. No effect on the lite (CPU) or stub pipelines.

let viewsMode = true;
const viewsListeners = new Set<() => void>();

export function getViewsMode(): boolean {
  return viewsMode;
}

export function setViewsMode(value: boolean) {
  viewsMode = value;
  viewsListeners.forEach((l) => l());
}

export function useViewsMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      viewsListeners.add(cb);
      return () => viewsListeners.delete(cb);
    },
    () => viewsMode,
    () => viewsMode,
  );
}
