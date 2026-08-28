# Decompose → 3D / Images / Library — architecture

Developer reference for the "Decompose" feature: turn one generated image into
per‑object 3D models, image reference sheets, or curated library assets.

Last reviewed at commit **667d4bf** (2026‑08‑28).

---

## 1. The 30‑second model

```
Image Studio card
  │  "Decompose → 3D"  or  "Decompose → Images"
  ▼
decompose_image  ──►  Python (decompose_pipeline.py)  ──►  assets/decompose/<job>/*.png
  │                     detect objects, cut each out, (opt.) synth 4 views
  ▼
job at status "awaiting"  ──►  ConfirmBlock (3 tabs)
                                 ├─ 3D:      submit_decomposition ──► fan_out ──► Tripo/Meshy ──► assets/models/*.glb
                                 ├─ Images:  decompose_export_pack ──► .zip (free cutouts, or paid AI turnaround)
                                 └─ Library: library_search/attach ──► Poly Haven ──► assets/library/<slug>/
  ▼
job at status "done"  ──►  JobCard result gallery
                             ├─ ▶ preview        (ModelViewer, three.js)
                             ├─ Turnaround .zip  (render 5 views from the GLB, client‑side)
                             ├─ Image pack .zip / AI turnaround
                             ├─ Scene file       (scene.json, for Blender/Unity/Unreal)
                             └─ Retry failed
```

Everything lives under one project: `Documents/Cozyverses/<project>/`.

---

## 2. Files

| File | Role |
|---|---|
| `src-tauri/src/decompose.rs` | The whole backend: commands, the Python bridge, the provider fan‑out, the exporters, the Poly Haven client. ~2.5k lines. |
| `src-tauri/src/decompose_setup.rs` | One‑time managed Python venv install (`%LOCALAPPDATA%\Cozyverse Studio\pyenv`), runtime probe, streamed setup progress. |
| `decompose_pipeline.py` | The image → objects pipeline. Bundled as a Tauri resource (`tauri.conf.json` → `bundle.resources`). Runs as a subprocess. |
| `crates/modelforge-core/` | Vendored Tripo + Meshy transport (`Clients`, `Operation`, `TaskResult`). Bug‑for‑bug identical with ModelForge 1.3.0. |
| `src-tauri/src/providers.rs` | Image‑edit engines for the AI turnaround (`image_edit_engines`, `edit_subject_image`, `fal_edit_image`) + `decompose_provider_balance` HTTP. |
| `src/lib/decompose.ts` | Frontend command wrappers + the live‑job external store (`useDecompositions`) + module‑level toggles. |
| `src/lib/turnaround.ts` | Client‑side three.js GLB → 5‑view renderer (`createTurnaroundRig`). Dynamically imported. |
| `src/components/DecomposePanel.tsx` | The whole panel UI: `RuntimeCard`, `ConfirmBlock`, `JobCard`, `ObjectThumb`, `ImagePackActions`. ~1.2k lines. |
| `src/components/ModelViewer.tsx` | Lazy‑loaded three.js GLB/GLTF viewer with OrbitControls. |
| `src/pages/ImageStudio.tsx` | The two per‑card entry buttons + `handleDecompose`. |
| `integrations/blender/cozyverse_bridge.py` | Blender add‑on that reads `scene.json`. |

---

## 3. State on disk

Per project:

```
<project>/
  decompositions.json          { version: 1, jobs: DecomposeJob[] }   (atomic write, capped at 100 jobs)
  CREDITS.txt                   third‑party (Poly Haven) asset attribution, rewritten on every attach/detach
  assets/
    images/<hash>.png|jpg       the source images
    decompose/<jobId>/
      asset_N_perspective.png   per‑object cutout on white (1024² by default)
      asset_N_{back,left,right}.png   Zero123++ views, only when the full pipeline ran with 4‑views on
      scene.json                DCC layout manifest, written on job completion / library finalize
    models/<key>-<stamp>.glb    downloaded generated meshes
    library/<slug>/             a Poly Haven pick: <slug>.gltf + .bin + textures/
```

`decompositions.json` is the single source of truth for job state; the frontend
mirrors it into an in‑memory store and stays in sync via `decompose://progress`
events (whole‑`DecomposeJob` payloads).

### `DecomposeJob` (see `decompose.rs`)

```
id            stamp() — hex nanos, also the job folder name
imagePath     relative to assets/
status        pending | decomposing | awaiting | modeling | done | error
message       human line for the UI
qualityPath   whether the pipeline synthesised 4 side views
inputHash     fingerprint of (image bytes + output‑affecting options) — dedup key
submitted     true once a provider fan‑out has started
assets[]      DecomposedAsset { id, class, bbox[4], perspectiveImage, orthoViews, models[] }
                models[] = ModelJob { key, provider, mode, pathKind, status, progress,
                                      taskId, glbPath, error, finishedAt,
                                      source/sourceUrl/author/license/licenseUrl }   ← last 5 only for provider "library"
```

`ModelJob.provider` ∈ `tripo | meshy | library`. `pathKind` ∈ `fast | quality | library`.

---

## 4. Backend commands (all `#[tauri::command]`, registered in `lib.rs`)

### Pipeline / job lifecycle
| Command | What |
|---|---|
| `decompose_image(dir, imageRel, options?)` | Dedup‑check, then spawn: run Python → fill `assets` → `awaiting` (or straight to `fan_out` if `options.submit`). Returns the job id immediately. |
| `submit_decomposition(dir, jobId, options?)` | The paid "yes, spend" half. `spawn_fan_out`. Honors `options.providers` and `options.assetIds`. |
| `decompose_retry_failed(dir, jobId)` | Re‑runs only the `failed` model steps, scoped to the providers/paths that failed. `build_plan` resurrects rows instead of adding. |
| `decompose_cancel_job(dir, jobId)` | Flips a per‑job `AtomicBool` in `cancel_registry()`. The fan‑out checks it before submit and between polls. |
| `decompose_forget_job(dir, jobId)` | Deletes the job from `decompositions.json` + its `decompose/<id>/` folder. Refuses while running. |
| `list_decompositions(dir)` / `get_decomposition(dir, jobId)` | Read state. |
| `decompose_provider_keys()` | `{tripo: bool, meshy: bool}` from keyring. |
| `decompose_provider_balance()` | Live Tripo + Meshy credit numbers (best‑effort, `None` on any failure). |

### Runtime setup (`decompose_setup.rs`)
| Command | What |
|---|---|
| `decompose_runtime_status()` | Probes the interpreter: `full` (torch/transformers/diffusers), `lite` (ultralytics), GPU name. |
| `setup_decompose_runtime(mode)` | `"lite"` ≈ 400 MB CPU stack, `"full"` ≈ 3 GB CUDA + diffusion. Streams `decompose://setup` `SetupProgress`. |

### Exports
| Command | What |
|---|---|
| `decompose_export_pack(dir, jobId, options?)` | The "Images" path. `options.aiViews` = paid re‑render via `options.engine`; else zips the pipeline cutouts as‑is. Streams `decompose://export`. |
| `decompose_export_pack_estimate(dir, jobId)` | `{objects, imagesPerObject, totalImages, provider, engines[]}` — for the cost warning + engine picker. |
| `decompose_turnaround_engines()` | Image‑edit engines the current keys unlock, in preference order. |
| `decompose_export_turnaround(dir, jobId, frames[])` | Zips client‑rendered GLB frames. `frames[i] = {objectId, slug, view, dataUri}`. Path components are sanitised; 400‑frame / 40 MB‑per‑frame caps. |
| `decompose_scene_path(dir, jobId)` | Reveals `scene.json` in Explorer, returns its abs path. |
| `decompose_file_path(dir, relUnderAssets)` | Abs path of a file under `assets/` (contained: no `..`, absolute, `:`). Frontend feeds it to `convertFileSrc` for the asset protocol. |
| `reveal_decompose_output(dir)` | Opens `assets/models/` in Explorer. |

### Asset Library (Poly Haven, CC0)
| Command | What |
|---|---|
| `library_search(objectClass)` | Ranks the cached Poly Haven model catalogue (name ×3, tags/cats ×2, tie‑break download_count) against `class` + a synonym map. |
| `library_attach(dir, jobId, assetId, candidateId)` | Downloads `.gltf` + `.bin` + 1k textures into `assets/library/<slug>/`, pushes a `provider:"library"` `ModelJob`, rewrites `CREDITS.txt`, writes `scene.json`. `candidateId` = `"polyhaven:<slug>"`. |
| `library_detach(dir, jobId, assetId)` | Removes the library `ModelJob` (leaves files on disk). |
| `library_finalize(dir, jobId)` | Ends a job on library picks alone — no provider spend. Sets `done`, writes `scene.json`. |

---

## 5. The Python contract (`decompose_pipeline.py`)

```
python decompose_pipeline.py --image <file> --out <dir> [--quality | --lite | --stub]
```

* **stdout**: exactly one JSON array on the last non‑empty line — the asset list.
* **stderr**: human progress / errors. On non‑zero exit the Rust side surfaces the
  last 8 stderr lines to the user.
* Every referenced PNG is written under `<dir>` (already inside `assets/`).

Asset entry: `{ id, class, bbox:[x0,y0,x1,y1], perspective_image, ortho_views:{front,back,left,right?} }`

| Mode | Stack | Output |
|---|---|---|
| `--stub` | Pillow only | 1 asset (whole image), no models downloaded. Wiring test. |
| `--lite` | YOLO‑World + rembg (CPU, ~400 MB) | multi‑object boxes + clean mattes, no side views. Sensible default without a capable GPU. |
| _(none)_ | GroundingDINO + SAM | multi‑object instance masks + `_clean_mask` compositing. |
| `--quality` | + Zero123++ | adds 4 synthesised side views. Grid layout auto‑derived (handles 3×2 and 2×3); `right≈az90 / back≈az210 / left≈az270`. |

`resolve_python()` order: managed venv → `COZY_PYTHON` → bare `python`.
`resolve_script()` order: `COZY_DECOMPOSE_SCRIPT` → `resource_dir()` → exe‑adjacent → cwd.

Env knobs: `COZY_DECOMPOSE_CANVAS` (px, default 1024), `COZY_DECOMPOSE_BG` (hex, default white).

`PIPELINE_LOCK` (`Semaphore::const_new(1)`) serialises subprocesses — the ML libs
download weights into shared caches and corrupt each other on concurrent
first‑runs (observed: CLIP ViT‑B‑32 SHA256 mismatch; `run_lite` self‑heals it).

---

## 6. The provider fan‑out (`fan_out` in `decompose.rs`)

1. `build_plan` walks `job.assets` (filtered by `opts.asset_ids`), emitting a
   `Step` per (asset × provider × path). Fast path = the perspective crop →
   single‑image endpoint. Quality path = the 4 views → multi‑view endpoint,
   gated on `has_front() && populated_count() >= 2`.
2. Two semaphores:
   * `submit_gate` = `MAX_INFLIGHT_SUBMISSIONS` (6) — held **only** across
     `clients.submit()`. Providers rate‑limit submission hardest.
   * `poll_gate` = `MAX_INFLIGHT_POLLS` (64) — the poll loop. Cheap GETs.
   This split is what stops a 40‑object job serialising through provider queues.
3. Each step: submit → poll every `POLL_EVERY` (3 s) until terminal /
   `FAST_PATH_DEADLINE` (4 min) / `QUALITY_PATH_DEADLINE` (8 min) / cancel.
   Transient poll errors (429/5xx/network) are swallowed; `poll_error_is_fatal`
   bails on the rest.
4. On success: download the `glb` (or `pbr_glb`) URL → `assets/models/`.
5. Settle: `ok/total` counts, status → `done`/`error`, `write_scene_manifest` if
   `ok > 0`, `clear_cancel`.

Model versions: `TRIPO_MODEL_VERSION = "v3.1-20260211"`, `MESHY_MODEL = "meshy-7"`.
Overridable per‑run via `DecomposeOptions` (`tripoModelVersion`, `meshyModel`,
`textureResolution`, `quadTopology`, `targetPolycount`, `pbr`, plus raw
`meshyExtra` / `tripoExtra` maps merged verbatim).

---

## 7. `scene.json` (the DCC handoff)

```jsonc
{
  "version": 1,
  "app": "Cozyverse Studio",
  "job": "<id>",
  "sourceImage": "<abs path>",
  "credits": [ { model, source, author, license, url } ],   // library picks
  "objects": [
    {
      "id": "…", "class": "sofa", "bbox": [x0,y0,x1,y1],     // px in the source image
      "models": { "tripo_fast": "<abs .glb>", "meshy_quality": "…", "library": "<abs .gltf>" },
      "preferred": "library" | "tripo_fast" | …,             // library first, then a fast model, then any
      "attribution": { model, source, author, license, url } // only if a library model is attached
    }
  ]
}
```

The Blender add‑on places `models[preferred]` on a ground plane from `bbox`
against the source image size. `.gltf` and `.glb` both import via
`bpy.ops.import_scene.gltf`.

---

## 8. Frontend notes

* **Live store**: `useDecompositions()` reads a module‑level `Map<id, DecomposeJob>`
  fed by `decompose://progress`. `hydrateDecompositions(dir)` merges disk state
  on mount. `hideJob`/`clearFinishedJobs` with a `dirName` also call
  `forgetJob` (persistent delete); without, session‑only hide.
* **Module toggles** (not React state so `ImageStudio` sets and the panel reads):
  `stubMode`, `viewsMode` ("4 side views"), `decomposeIntent` (`"3d"|"images"` —
  which panel tab leads).
* **Asset protocol**: images/GLBs load via `decompose_file_path` → abs path →
  `convertFileSrc`. Scope is `**/Cozyverses/**` in `tauri.conf.json`. A `.gltf`
  needs `loader.setResourcePath` at the `%2F`‑encoded folder (Tauri encodes the
  whole path into one URL segment) — see `ModelViewer.tsx` / `turnaround.ts`.
* **three.js** is code‑split: `ModelViewer` and `turnaround.ts` are both
  dynamic‑imported and share the `GLTFLoader` chunk. The main bundle carries no
  three.js.
* **Turnaround render**: `createTurnaroundRig(size)` = one reused offscreen
  `WebGLRenderer` (`preserveDrawingBuffer: true`, 26° near‑ortho lens, 5‑light
  rig, white clear). `render(url)` → 5 `{view, dataUri}`. All frames are
  collected in JS then sent to `decompose_export_turnaround` as one payload —
  fine for ≤~15 objects; a very large diorama means a big IPC payload.

---

## 9. Known limits / TODO

* **Quality path (Zero123++)** side/back views are *inferred*, rough on objects
  lifted from a busy scene. Fast path usually wins. See
  `docs/asset-library-path-design.md` and the pipeline stage‑4 comment. Real fix
  = SV3D / Hunyuan3D‑2‑MV, both heavy.
* **AI turnaround** is single‑image img2img — `perspective`/`front` are observed,
  `back`/`left`/`right` are inferred even with the front fed back as a reference.
  The **Turnaround (.zip)** from a finished GLB is the exact/consistent option.
* **fal engines** (`fal:*`) are wired but untested against a live fal key.
* **Poly Haven** has no rug/curtain/etc. models — `library_search` returns empty
  and the UI says so. A bundled Quaternius/Kenney CC0 pack is the planned second
  source (architecture already source‑agnostic).
* No Unity/Unreal importer ships — only the Blender add‑on. `scene.json` is
  engine‑neutral; both import `.glb` natively.
* `decompose_provider_balance` parses a few plausible JSON pointers per provider;
  if a provider changes its balance response shape it silently returns `None`
  (UI just hides the row).
* Retry uses **current** default model versions, not whatever the original run
  used (the job doesn't store its `DecomposeOptions`).

---

## 10. Extending

* **New segmentation backend**: add a mode to `decompose_pipeline.py` + an arg in
  `run_pipeline`. Keep the stdout‑JSON contract.
* **New 3D provider**: add to `modelforge-core` (`Operation`, `Clients`), then a
  branch in `build_plan` / `single_image_params` / `multi_view_params`.
* **New library source**: implement `search` + `download` returning the same
  `LibraryCandidate` shape and a `provider:"library"` `ModelJob`; prefix ids with
  `"<source>:"` and route in `library_attach`.
* **New AI‑turnaround engine**: add to `image_edit_engines()` and a branch in
  `edit_subject_image` (sync) or reuse `fal_edit_image` (queue).
