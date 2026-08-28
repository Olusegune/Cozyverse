// Bridge to the Rust `decompose` module (src-tauri/src/decompose.rs): turn a
// generated image into semantic asset groups and fan them out to Tripo + Meshy
// along a Fast Path (perspective crop → single-image) and a Quality Path
// (4 ortho views → multi-view), in parallel.
//
// Job progress arrives as whole-job `decompose://progress` events. This module
// keeps the latest snapshot of every job in a tiny external store so any
// component can read it with `useDecompositions()` without touching the main
// Zustand store.

import { invoke } from "@tauri-apps/api/core";
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
  /** When false, stop after segmentation and wait for `submitDecomposition` (default true). */
  submit?: boolean;
  /** Bypass the identical-input dedup check. */
  force?: boolean;
  /** Restrict fan-out to a subset of ["tripo","meshy"] (default: all keyed). */
  providers?: string[];
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
): number {
  return job.assets.reduce((sum, a) => {
    const perProvider = 1 + (qualityPath && assetHasQualityViews(a) ? 1 : 0);
    return sum + providerCount * perProvider;
  }, 0);
}

// Client-only: jobs the user dismissed from the panel (no backend delete yet).
const hidden = new Set<string>();
export function hideJob(id: string) {
  hidden.add(id);
  rebuild();
}
export function isHidden(id: string): boolean {
  return hidden.has(id);
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
