# Tutorial — Decompose an image into 3D models or image cutouts

Take one Cozyverse image and break it into its separate objects (furniture,
decor, props). Then choose a path:

- **Image path** — download every object as a clean PNG cutout (plus
  front/back/left/right views, if the full pipeline made them), packaged as a
  `.zip` for whatever image‑to‑3D tool you already use. **Free, local, no API key.**
- **3D path** — generate textured **`.glb`** models with **Tripo** and **Meshy**,
  driven from inside Cozyverse Studio. **Paid** (their cloud APIs).

The screenshots below are from a real run on the sample project **Town Cozy**.
The panel layout has been refined since some were taken; the steps are current.

---

## Before you start

| For | You need | Notes |
|---|---|---|
| **Any decomposition** | The one‑time pipeline setup (in the panel) **or** Stub mode | See Step 3. |
| **Image path** | Nothing else | No key, no spend. |
| **3D path** | A **Tripo** or **Meshy** API key | Add it in **Settings** (Step 1). One is enough; with both, each object goes to both. |

**Segmentation is local and free.** Nothing reaches a provider, and nothing is
billed, until you press **Send to 3D**.

> **Getting help:** the **Documentation** button on the splash screen and
> **Help & Docs** at the bottom of the left navigation both open the in‑app help.

---

## Step 1 — (3D path only) Add a Tripo or Meshy key

Open **Settings** from the left nav. Scroll to the provider list — **Tripo** and
**Meshy** are near the bottom. Paste a key, **Save**, then **Test Connection**.

![Settings — the Tripo and Meshy API-key rows](img/01-settings-keys.png)

Keys live in the Windows Credential Manager, never in a project file. Skip this
step entirely if you only want the image path.

---

## Step 2 — Open a project that has an image

From the **Projects** dashboard, open any Cozyverse with at least one image in
it. (No image yet? Generate or import one in Image Studio first.)

![Projects dashboard](img/02-projects.png)

---

## Step 3 — Set up the pipeline (once)

Go to **Image Studio**. Below the gallery is the **Decompose to 3D or images**
panel. Its card offers a one‑time install into an isolated environment Cozyverse
manages:

| Choice | Size | What you get |
|---|---|---|
| **Quick setup** | ~400 MB, CPU | YOLO‑World detection + `rembg` cutouts. Multi‑object, clean mattes, no side views. The sensible default. |
| **Full setup** | ~3 GB, GPU | Adds Grounded‑SAM masks and **Zero123++** synthesized front/back/left/right views (needed for the 3D Quality path and a richer image pack). |
| **Stub mode** (header toggle) | 0 | One placeholder crop from the whole image. For shaking out the chain without the pipeline. |

Setup progress streams in the panel. If Python 3.10+ isn't on your PATH the card
says so (point `COZY_PYTHON` at one, or use Stub mode).

The **4 side views** header toggle (Full pipeline only, default on) controls
whether each decompose spends the extra ~90 s synthesizing views. Turn it off for
faster, perspective‑only runs.

![The panel header — setup card and toggles](img/04-panel.png)

---

## Step 4 — Click Decompose

Click **Decompose (3D or images)** on the image card you want. The view scrolls
to the panel and the job runs through **Segmenting image…**:

- **Quick / Full:** ~10–40 s (Full + 4 views is longer, ~90 s more).
- **Stub:** near‑instant.

When it finishes, the job card shows **N object(s) found — pick a path**.

---

## Step 5 — Pick a path

### Image path

A `.zip` of every object, for any external image‑to‑3D service. Two buttons:

**Download image pack (.zip)** — free, instant. The pipeline's own output,
each image normalised to a 1024×1024 white canvas:

```
scene/original.<ext>                 the source image
objects/00_sofa/perspective.png      the object cut out on white
objects/00_sofa/front.png back.png left.png right.png   (Full pipeline + 4 views only)
objects/01_lamp/…
manifest.json                        object list + bounding boxes
```

**AI turnaround · ~N imgs (paid)** — re‑renders **all five** views per object
(perspective + front/back/left/right) through an image model (**Gemini**
nano‑banana, or **OpenAI** gpt‑image‑2 — whichever key you have) as large, clean
images on a plain white background. `perspective`/`front` track the object
closely; `back`/`left`/`right` are *inferred* from the front and won't match
perfectly. The button shows the image count up front; a progress bar runs while
it works. Set `COZY_DECOMPOSE_BG` to a hex (e.g. `ECEAE6`) for a neutral‑grey
background instead of white.

Either way, nothing is sent to Tripo/Meshy and no 3D credits are used.

### 3D path (paid)

![The confirmation block with its cost estimate](img/06b-confirm-detail.png)

- **Objects to generate** — a thumbnail of every detected object with a
  checkbox. Untick the junk (a wall slab, a duplicate, background) so you don't
  pay to model it. The estimate and the Send button count only what's ticked.
- **Balance** — your live Tripo / Meshy credit, shown under the estimate; it
  turns amber if it looks short for this run.
- **Generate with: ☐ Tripo ☐ Meshy** — tick the service(s) to build with. Both
  on by default (if both have a key). The estimate updates as you change it.
- **Also run the 4‑view Quality path** — experimental; only selectable if this
  decomposition has side views. Feeds the four views to each provider's
  multi‑view endpoint alongside the Fast path. **Doubles the spend.**
- The amber line spells out how many paid generations **Send to 3D** starts:

  ```
  objects  ×  chosen providers  ×  (1 Fast  +  1 Quality, if enabled)
  ```

- **Send to 3D** — the paid step. **Discard this decomposition** — costs nothing.

![The confirmation block in context](img/06-confirm.png)

---

## Step 6 — Watch the models generate

Each object shows a small grid — one cell per provider × path — moving
`pending → running → succeeded`. A green **GLB** tag appears once that model has
downloaded. A **Stop** button on the job cancels the rest of the run; models
already finished are kept.

When it settles, if any cells are red, **Retry failed (N)** re-submits just
those — the ones that already succeeded aren't touched or re-billed.

**Preview** — click any cell with a **GLB** tag to open a rotatable 3D preview
inside the panel. Drag to orbit; it auto-rotates otherwise. No need to open
Blender just to see whether a model came out clean.

![One provider done, the other still running](img/07b-modeling-detail.png)

- **Fast** (perspective crop → single‑image model): ~1–2 min.
- **Quality** (4 views → multi‑view model): ~2–5 min.

Submissions are rate‑limited (6 at a time); polling then runs in parallel, so a
large diorama doesn't crawl.

![Modeling in progress, in context](img/07-modeling.png)

---

## Step 7 — Collect the results

When the card reads **Done — X/Y models generated**:

![Job complete](img/08-done.png)

```
Documents/Cozyverses/<project>/assets/models/
  18cff8_asset_0_meshy_perspective-18cff8eb.glb
  18cff8_asset_0_tripo_perspective-18cff8e6.glb
Documents/Cozyverses/<project>/assets/decompose/<jobId>/
  scene.json          layout manifest (bboxes, per-object model paths)
```

The job's buttons: **Open the models folder**, **Scene file (Blender / Unity /
Unreal)** (reveals `scene.json`), **Image pack (.zip)**, and **How to use these
files** (the summary below, in‑app).

---

## Step 8 — Use the models in a DCC / engine

Every model is a plain textured **`.glb`**. `scene.json` (schema in
`integrations/blender/README.md`) gives each object's bounding box in the source
image so an importer can rebuild the layout.

### Blender

1. **Edit ▸ Preferences ▸ Add‑ons ▸ Install…** →
   `integrations/blender/cozyverse_bridge.py` → enable **Cozyverse Bridge**.
2. **Sidebar (N) ▸ Cozyverse** → set the **scene.json** path →
   **Import Decomposed Scene**. Every object is imported (its preferred Fast‑path
   GLB), scaled to roughly track its footprint, and dropped on the floor under a
   `Cozyverse <job>` empty. Adjust **Room size**, then nudge by hand.
3. Single model instead: **File ▸ Import ▸ glTF 2.0**.

### Unity

Install a glTF importer (**glTFast** or **UnityGLTF**) via Package Manager, drop
the `.glb` files into `Assets/`, drag each into the scene. `scene.json` can drive
an Editor script for automatic placement (not shipped).

### Unreal Engine 5

Drag a `.glb` into the **Content Browser**, or **File ▸ Import Into Level…**
(Interchange glTF is on by default). For layout, read `scene.json` from an Editor
Utility / Python script (not shipped).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Can't find the image option | It's in the panel below the gallery, after you press Decompose — the confirm block's **Download image pack (.zip)** (also on finished jobs). |
| "Python 3.10+ must be on PATH…" / "Found Python 3.x" | Install a current Python from python.org, or set `COZY_PYTHON` to one. Or use Stub mode. |
| "decompose_pipeline.py was not found" | It ships beside the app; set `COZY_DECOMPOSE_SCRIPT` to its path if you moved things. |
| The setup step failed | The panel now shows the last lines of pip's output. Common: no network, or a wheel with no CUDA build for your Python. |
| Quality checkbox is disabled | This decomposition has no side views. Turn on **4 side views**, run **Decompose** again. |
| A provider job turns red | Hover for the reason (out of credits, rejected image, rate‑limit). The others continue. |
| Re‑clicking Decompose does nothing new | Identical input is de‑duplicated so you aren't charged twice — it surfaces the existing job. Change a setting to force a fresh run. |
| An old confirm / failed job won't go away | **Discard** it, or **Clear finished** in the panel header — both now delete it from disk. |

## Advanced options

`DecomposeOptions` (via the `decompose_image` / `submit_decomposition` commands)
also accepts: `tripoModelVersion`, `meshyModel` (default `meshy-7`),
`textureResolution` (Meshy up to 8192), `quadTopology`, `targetPolycount`,
`pbr`, `providers` (subset of `["tripo","meshy"]`), and raw `meshyExtra` /
`tripoExtra` param maps merged verbatim into every request.
