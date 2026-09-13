# Cozyverse Studio

A local-first Windows creator app for building **Cozyverses** — small, immersive "private heaven"
digital-art worlds made of artwork, motion, audio, and a lightweight interactive scene.

## Golden path

```
Create Project → Define World → Create Master Image → Create Variants →
Organize Assets → Add Motion → Add Audio → Configure Interactivity → Preview → Export
```

Every screen in the app's left nav maps to one step of that path. **World Map** is the landing view
after opening a project — every scene as a floating diorama tile (thumbnail resolved the same way
Scene Composer's Live Preview does, so it's always in sync), with dots showing which of
motion/ambience/music are filled in, and a "Story Order" strip above it showing the Storyboard
timeline's actual sequence when one exists. Click a tile to jump into Scene Composer for that scene.

**Cast & Props** (its own nav item, formerly "Characters") are recurring characters, props, vehicles,
and sets defined once — a name, a free-text style sheet, and reference images — then picked into any
Shot Mode generation in Image or Motion Studio. Picking one auto-attaches its reference image (on
models that support one) and folds its style sheet into the prompt either way. Characters, props,
vehicles, and sets are all the same underlying data shape (`Character` with a `kind` field) rather
than four separate features, so every downstream consumer (the Shot Mode picker, Continuity Guardian,
Prompt Assist) works with all four automatically.

Each Cast & Props entry can design its own reference images directly, without a detour through Image
Studio: a prompt field, a model picker, Mock/Auto rendering, and:
- **Turnaround** — fires front/back/left/right generations in one click, all attached as references.
  Doubles as prep for a future image-to-3D pipeline (same multi-angle shape that family of models wants).
- **Match project style** — the full Style Stack (see below), auto-inherited from the project's most
  recent Image Studio generation so a new entity doesn't look like a different project by default,
  fully editable.
- **Design Sheet** — exports a branded reference-sheet PNG (name, style sheet, reference images) like
  a real production character/prop bible page.
- **Import File…** — bring in an existing image from disk as a reference.

Reference thumbnails open full-size in a lightbox (click, or hover for the Expand icon) — the same
viewer Image Studio's own grid uses.

## Getting started

```bash
npm install
npm run tauri dev      # launches the app with hot reload
```

To build a distributable Windows installer:

```bash
npm run build:win      # produces .msi / .nsis installers under src-tauri/target/release/bundle
```

Requires Node.js and the Rust toolchain (`cargo`) to be installed. First build compiles the full
Rust dependency tree, which takes a few minutes; subsequent builds are fast.

## Where your projects live

Every Cozyverse is a self-contained folder under:

```
Documents/Cozyverses/<project-slug>/
  cozyverse.json       — metadata, asset graph, generation history, scenes
  world.json           — the World Bible (mood, style, weather, characters, etc.)
  assets/
    images/  video/  audio/
  thumbnails/
  exports/
```

Nothing is stored in a database — it's all plain JSON + media files, so a project folder is fully
portable and inspectable. Deleting a Cozyverse or an asset moves it to a `_trash` folder next to it
rather than deleting it outright, so a mistake is always recoverable from disk.

## Generation providers

Image, motion, and audio generation go through a provider abstraction
(`src/lib/providers/`) so the UI never talks to a specific API directly.

**Mock renderer (default, no API key, no cost).** Every generation type — image, motion, ambience,
music, SFX — has a local mock implementation that produces real, usable output with no network
calls: images are drawn on a canvas, motion clips are recorded from an animated canvas via
`MediaRecorder`, and audio is synthesized with the Web Audio API and encoded to WAV by hand. This is
what runs out of the box and is what the whole app was validated against.

**Real providers.** Open **Settings** in the app and paste an API key for one or more of:

| Provider  | Used for                                                                 | Get a key at      |
|-----------|---------------------------------------------------------------------------|--------------------|
| fal.ai    | Image generation + editing (FLUX, Nano Banana Edit, GPT Image 2/2.5), image-to-video (Wan 2.7), ambience/music/SFX (CassetteAI) | fal.ai/dashboard/keys |
| KIE AI    | Image generation (Nano Banana, GPT Image), text-to-video (Kling)         | kie.ai             |
| WaveSpeed | Image generation (FLUX), dialogue speech (MiniMax Speech 2.8 Turbo)      | wavespeed.ai       |
| OpenAI    | Native GPT Image 2/2.5 (text-to-image + edit) — requires Organization Verification, unlike the fal route above | platform.openai.com |

Keys are stored in the **Windows Credential Manager** via the OS keyring — never inside a project
file, never synced anywhere. Once a key is connected, every studio gets an "Auto (connected
provider)" rendering option alongside Mock:

- **Image Studio** — text-to-image master images, and instruction-following edit variants (change
  weather/time/lighting/season while keeping the subject, via fal's Nano Banana Edit — plain
  strength-blended img2img can't do this reliably, so variants specifically route to an edit model).
  A fourth mode, **Sketch**, lets you hand-draw a rough layout on an in-app canvas (undo/clear/brush)
  and describe what it should become — GPT Image 2.5 Flare Edit turns the sketch into a finished
  scene, the same idea as ChatGPT's own @Sketch tool (`src/components/SketchCanvas.tsx`,
  `generateSketchAssembly` in the store). An optional second reference image blends in a style.
- **Motion Studio** — real image-to-video (fal's Wan 2.7): the source frame is read off disk and
  sent as a base64 data URI, no external hosting/upload step needed.
- **Audio Studio → Ambience/Music/SFX** — CassetteAI's music and sound-effects models on fal.
- **Audio Studio → Dialogue** — generates via a connected speech provider (WaveSpeed/MiniMax).
  Multi-speaker scripts in the form `Speaker 1 (Female): "line"` / `Speaker 2 (Male): "line"` are
  parsed and rendered as separate clips, each with a distinct, gender-matched voice
  (`src/lib/dialogueScript.ts`) — a single TTS call only supports one voice per request, so this is
  done as one generation call per line rather than a native multi-speaker API.

Local image conditioning for fal models works by passing a base64 data URI directly as the
`image_url`/`image_urls` input — fal's API accepts this in place of a hosted URL, so no separate
upload step is needed for image-to-image, image-to-video, or edit requests.

## Decompose & Send to 3D

Each image card in **Image Studio** has a **Decompose & Send to 3D** button. It splits the picture
into its separate objects and turns each one into a 3D model, using **Tripo** and **Meshy** (add a
key for either in Settings — rows are labelled "Tripo" / "Meshy").

The flow, two-step so nothing paid runs by accident:

1. **Segment.** A Python subprocess (`decompose_pipeline.py`) detects the objects, cuts each one
   out on a white background, and — for the Quality path — synthesizes four orthographic views.
   Full mode uses Grounded-SAM + Zero123++ on the GPU; `--stub` mode (panel toggle) does a
   Pillow-only crop with no models, for testing the wiring.
2. **Confirm.** The panel shows how many objects were found and how many paid generations that
   implies. Pressing **Send to 3D** starts the fan-out; **Discard** costs nothing.
3. **Model.** Per object, up to four jobs run in parallel — Tripo + Meshy, each on a **Fast** path
   (perspective crop → single-image) and a **Quality** path (4 views → multi-view). Finished GLBs
   download to `assets/models/`. Progress streams live into the panel.

Backend: `src-tauri/src/decompose.rs` (commands `decompose_image`, `submit_decomposition`,
`get_decomposition`, `list_decompositions`, `decompose_provider_keys`). Job state is mirrored to
`<project>/decompositions.json`. An identical re-run is de-duplicated against a content hash rather
than re-billed.

The Tripo/Meshy transport is the **`modelforge-core`** crate (`crates/modelforge-core`,
lifted from ModelForge), so this app and ModelForge stay identical on upload handling, endpoint
versions, and status parsing. Default models: Tripo `v3.1-20260211`, Meshy `meshy-7`; overridable
per run, with `meshyExtra` / `tripoExtra` raw-param pass-throughs for anything not surfaced as an
option.

**Requires** Python on PATH (`python`, override with `COZY_PYTHON`) plus, for the full pipeline,
`pip install torch transformers accelerate diffusers pillow numpy`. Stub mode needs only Pillow.
The script path is resolved next to the executable or via `COZY_DECOMPOSE_SCRIPT`.

**Step-by-step tutorial with screenshots:** [`docs/decompose-to-3d-tutorial/`](docs/decompose-to-3d-tutorial/README.md).

### Free Models (Asset Library) and combined-scene export

Alongside AI generation, a finished decompose job's **Free Models** tab searches Poly Haven's CC0
catalog by class/synonym/tag match for each detected object — no spend, real attribution written to
`CREDITS.txt`. When the CLIP checkpoint is already cached (pre-fetched by both "Quick setup" and
"Full setup" alongside the models they already warm) and a cutout is available, results are further
re-ranked by visual similarity to that object's own cutout via a short-lived Python subprocess
(`clip_rerank.py`) — text-only ranking otherwise, silently, with no visible difference either way.

A finished job also gets a **Combined scene (.glb)** export: every object's preferred model is
loaded, placed on a virtual floor from its 2D bounding box, and merged into one positioned binary
glTF (`src/lib/sceneMerge.ts`) — the exact same bbox → position/scale math the Blender bridge uses,
so an in-app export and a Blender import lay objects out identically.

The in-app 3D preview (`ModelViewer`) also has **one-click lighting presets** — Studio, Golden Hour,
Cozy Warm, Moonlit Blue, Overcast Soft (`src/lib/lightPresets.ts`) — applied as a live prop change,
no scene reload.

## Local AI features (Ollama)

A few features run entirely on a local Ollama model instead of a paid API — no key, no cost, fully
private. Connect Ollama once in **Settings → Prompt Assistant (Ollama)** (server URL + pick a pulled
model), then:

- **Prompt Assist** (✨ Assist next to any prompt field in Image/Motion/Audio Studio) — describe an
  idea in plain language, get back 2–3 ready-to-use prompt drafts grounded in the project's World
  Bible, active scene conditions, and the target model's own prompting idiom (`src/lib/promptAssist.ts`,
  `src/components/PromptAssist.tsx`).
- **Continuity Guardian** ("Check Continuity" next to the Cast & Props picker in Image/Motion Studio
  Shot Mode) — compares the prompt against selected entities' style sheets and the World Bible's
  "Things to Avoid" list, flagging contradictions or missing established details with a one-click
  "Add" fix. Silent (never blocks generation) when Ollama isn't configured
  (`src/lib/continuityGuardian.ts`, `src/components/ContinuityCheck.tsx`).
- **Story Reel Continuity** (Storyboard) — the whole-reel counterpart: compares every scene's own
  generation prompt against every other scene's, catching cross-scene contradictions a per-shot check
  structurally can't see (each shot looks fine in isolation; the problem only exists across the
  sequence). Report-only — there's no single prompt field spanning multiple scenes to patch
  (`checkReelContinuity` in `src/lib/continuityGuardian.ts`, `src/components/ReelContinuityCheck.tsx`).

Both degrade gracefully — if Ollama isn't running, the button either doesn't render or shows a quiet
"not set up" hint rather than erroring.

## Other one-click features

- **Bring This Scene to Life** (Scene Composer) — fills in whichever of a scene's motion/ambience/
  music layers are still empty, in one click, reusing the same generation calls Motion/Audio Studio
  use on their own (`bringSceneToLife` in `src/store/useAppStore.ts`).
- **Day/Night Scrubber** (Preview) — Time of Day is a draggable slider, not a dropdown; the
  background crossfades between whichever generated variant best matches each stop instead of
  hard-cutting (`CrossfadeBackground` in `src/pages/Preview.tsx`).
- **Style from a Photo** (Image Studio → Style Stack) — drop in any reference image and Gemini
  describes just its visual style (material/color/lighting/camera, not the subject) as a ready-to-use
  Custom Style fragment, instead of hand-picking descriptive words (`src/components/StyleFromPhoto.tsx`;
  requires a connected Gemini key).
- **Postcard Export** (Image Studio lightbox) — one-click shareable card of any generated image in
  the app's own gold-on-dark splash-screen identity (`src/lib/postcard.ts`,
  `src/components/PostcardExport.tsx`).
- **Usage Summary** (Settings) — counts real (non-mock) completed generations this project has made,
  by provider and cost tier. Deliberately *not* a dollar total — the model registry has no real
  per-call pricing data, so a $ figure would be a fabricated number dressed up as a real one; the
  panel says so in its own copy (`src/components/UsageSummary.tsx`).

## Architecture

- **Tauri 2** (Rust backend + native webview) — no Electron, no bundled Chromium.
- **React 19 + TypeScript + Vite** frontend, **Tailwind CSS** for styling, **Zustand** for app state
  (`src/store/useAppStore.ts` is the single source of truth for the open project).
- **Rust backend** (`src-tauri/src/`) is split by concern:
  - `lib.rs` — project filesystem (create/open/save/rename/duplicate/delete), asset storage, export
    packaging.
  - `providers.rs` — API key storage, connection checks, and the submit → poll → result generation
    job lifecycle for real providers.
  - `decompose.rs` — the Decompose & Send to 3D pipeline: Python subprocess bridge, Tripo/Meshy
    fan-out (via the `modelforge-core` crate), job state, progress events.
- **Continuity engine** (`src/lib/continuity.ts`) is the one place prompts get built — it combines
  the World Bible with whatever's being requested (variant controls, motion description, audio
  kind) into a `GenerationIntent`. Providers never see the World Bible directly.
- **Scene state matching** (`src/lib/sceneMatching.ts`) is how the Scene Composer, Preview, and World
  Map swap/resolve backgrounds when you drag an environmental control (Weather, Time, Lighting): it
  scores your *already-generated* image variants against the requested state and picks the best
  match. Nothing regenerates live during playback — this is deliberate, per the "don't build a game
  engine" rule the whole project follows.
- **Style Stack** (`src/lib/styleStack.ts`) is a set of independent art-direction axes (Art Style,
  Edge Style, Construction, Material, Realism, Lighting, Color, Atmosphere, Camera) that combine into
  one prompt fragment. `STYLE_STACK_AXES` is the one shared definition Image Studio and the Cast &
  Props reference generator both render from, so the two pickers can never drift apart. The Art Style
  axis leads the *entire* generated prompt (ahead of even the World Bible's own subject description)
  rather than being appended at the end — diffusion models weight earlier tokens more heavily, and a
  late-appended style fragment gets diluted. Every diorama-family Art Style preset (Cozy 3D Diorama,
  Retro Sci-Fi Cozy, Miniature/Toy, Handcrafted Clay, etc.) folds explicit camera/composition language
  (elevated isometric angle, visible base/pedestal, tilt-shift, toy-scale) directly into its own
  fragment rather than depending on a separate Camera preset nobody would think to pair with it —
  confirmed live across three iterations that a single word like "diorama" in a longer sentence isn't
  enough on its own.

## Splash screen & branding

- App icon source: `src-tauri/icons/` (generated from a single 1024×1024+ PNG via
  `npx tauri icon <path-to-source.png>`, which produces `icon.ico` and the PNG set Windows needs).
  To change it, replace the source image and re-run that command.
- Splash screen images live in `public/splash/exterior.png` and `public/splash/interior.png`. The
  app alternates between them on every launch (tracked in `localStorage`), auto-dismisses after
  8 seconds, and can be skipped immediately via the **Skip** button top-right
  (`src/components/SplashScreen.tsx`). To change the artwork, replace those two files — any
  resolution works, they're rendered `object-cover` full-bleed.
- The splash screen also has a **Help** button next to Skip, opening the same in-app documentation
  dialog the native File/Help menu's "Documentation" item does (`src/components/HelpDialog.tsx`) —
  a new user can get oriented before ever touching the app.

## Distribution

- Repo: [github.com/Olusegune/Cozyverse](https://github.com/Olusegune/Cozyverse).
- `npm run build:win` produces both NSIS and MSI installers (`src-tauri/target/release/bundle/`). A
  portable, no-install build is just the raw `src-tauri/target/release/cozyverse-studio.exe` — it's a
  single self-contained binary (frontend assets are embedded at build time), so copying it out under
  any name works; no separate DLLs or resource folders are needed alongside it.

## Live-verification status

All six overnight features have had a real click-through, plus a full Golden Path regression pass
(World Bible → Motion Studio → Export): World Map (landing view, scene tiles, navigation into Scene
Composer), Bring This Scene to Life (fired a real ambience generation, auto-linked into the scene),
Day/Night Scrubber (dragging it swaps the background with a visible crossfade), Postcard Export
(fired for real — produces a genuinely polished branded card), and Continuity Guardian / Prompt
Assist (verified earlier in Image/Motion/Audio Studio). Style from a Photo was verified by code
review rather than a click-through — the automation environment's OS-level file picker runs under a
process name the sandbox can't authorize, a tooling limitation rather than an app one; the extraction
pipeline itself reuses the exact Gemini multimodal call shape already proven live elsewhere.

Cast & Props' generalization (character/prop/vehicle/set) and its follow-on features were all
live-verified against real generations across every one of the four kinds: Turnaround (a real 4-angle
sequence), Design Sheet export (visually inspected the resulting PNG), the reference-image lightbox,
and Style Stack inheritance (confirmed a new entity auto-picked the project's actual "Retro Sci-Fi
Cozy" style from real generation history). Story Reel Continuity ran a real check and correctly
reported "no contradictions." Usage Summary confirmed showing real counts in Settings.

Two real bugs were caught and fixed during these passes, not just theorized about:
- Exporting a project with an accented name (e.g. "Moon Café") silently dropped the accent from the
  output filename.
- Seeding a Cast & Props entity's Style Stack from an older saved generation (predating a since-added
  axis) crashed on the missing field — fixed by merging over a fresh default instead of using the
  stored object directly.

## Known limitations

- **Dialogue voices are a fixed preset pool**, not full custom voice design — `dialogueScript.ts`
  cycles through three preset MiniMax voices per gender (`Calm_Woman`/`Wise_Woman`/`Lively_Girl`,
  `Deep_Voice_Man`/`Casual_Guy`/`Friendly_Person`). A 4th+ same-gender speaker in one script reuses
  an earlier voice rather than getting a unique one.
- **Multi-line dialogue generates as separate clip assets**, not one merged audio file — each line
  is its own asset in the Dialogue list (named by speaker), rather than being stitched into a single
  track. This avoids fragile raw MP3 byte-concatenation; sequencing multiple clips is a Scene
  Composer/export concern, not a generation-time one.
- **Single active scene per Cozyverse is the tested path**, though the schema supports multiple
  scenes (`project.scenes[]`) — the Scene Composer lets you create and switch between them, but most
  of the app assumes you're working with one at a time.
- **Frontend test coverage is minimal.** `npm test` runs a small Vitest suite (`src/lib/lightPresets.test.ts`,
  `src/store/payloadGuard.test.ts`) covering the pure-logic modules with real regression risk — most
  of the frontend (`sceneMatching.ts`, `exportFormat.ts`, the generation router, every component)
  was validated with ad hoc Node smoke tests and manual click-through during development rather than
  permanent tests — see git history for what was checked. The Rust backend has a much more complete
  `cargo test` suite (`src-tauri/src/lib.rs`, `providers.rs`), which is the primary safety net and
  should be extended for new Rust commands.

## Export format

Export produces a portable `.zip`: `cozyverse.json` (a cleaned-up manifest — not the same shape as
the internal project file, deliberately schema-stable for future web/mobile/AR runtimes to read) +
`assets/` + a `thumbnail.<ext>`. See `src/lib/exportFormat.ts` for the exact manifest shape.
