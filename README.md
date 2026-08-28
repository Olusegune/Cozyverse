# Cozyverse Studio

A local-first Windows creator app for building **Cozyverses** — small, immersive "private heaven"
digital-art worlds made of artwork, motion, audio, and a lightweight interactive scene.

## Golden path

```
Create Project → Define World → Create Master Image → Create Variants →
Organize Assets → Add Motion → Add Audio → Configure Interactivity → Preview → Export
```

Every screen in the app's left nav maps to one step of that path.

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
| fal.ai    | Image generation + editing (FLUX, Nano Banana Edit), image-to-video (Wan 2.7), ambience/music/SFX (CassetteAI) | fal.ai/dashboard/keys |
| KIE AI    | Image generation (Nano Banana, GPT Image), text-to-video (Kling)         | kie.ai             |
| WaveSpeed | Image generation (FLUX), dialogue speech (MiniMax Speech 2.8 Turbo)      | wavespeed.ai       |

Keys are stored in the **Windows Credential Manager** via the OS keyring — never inside a project
file, never synced anywhere. Once a key is connected, every studio gets an "Auto (connected
provider)" rendering option alongside Mock:

- **Image Studio** — text-to-image master images, and instruction-following edit variants (change
  weather/time/lighting/season while keeping the subject, via fal's Nano Banana Edit — plain
  strength-blended img2img can't do this reliably, so variants specifically route to an edit model).
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
- **Scene state matching** (`src/lib/sceneMatching.ts`) is how the Scene Composer and Preview swap
  backgrounds when you drag an environmental control (Weather, Time, Lighting): it scores your
  *already-generated* image variants against the requested state and picks the best match. Nothing
  regenerates live during playback — this is deliberate, per the "don't build a game engine" rule
  the whole project follows.

## Splash screen & branding

- App icon source: `src-tauri/icons/` (generated from a single 1024×1024+ PNG via
  `npx tauri icon <path-to-source.png>`, which produces `icon.ico` and the PNG set Windows needs).
  To change it, replace the source image and re-run that command.
- Splash screen images live in `public/splash/exterior.png` and `public/splash/interior.png`. The
  app alternates between them on every launch (tracked in `localStorage`), auto-dismisses after
  4.5 seconds, and can be skipped immediately via the **Skip** button top-right
  (`src/components/SplashScreen.tsx`). To change the artwork, replace those two files — any
  resolution works, they're rendered `object-cover` full-bleed.

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
- **No automated frontend test runner is configured** (no vitest/jest). Pure logic modules
  (`sceneMatching.ts`, `exportFormat.ts`, the generation router) were validated with ad hoc Node
  smoke tests during development rather than a permanent test suite — see git history for what was
  checked. The Rust backend does have a real `cargo test` suite (`src-tauri/src/lib.rs`,
  `providers.rs`), which is the primary safety net and should be extended for new Rust commands.

## Export format

Export produces a portable `.zip`: `cozyverse.json` (a cleaned-up manifest — not the same shape as
the internal project file, deliberately schema-stable for future web/mobile/AR runtimes to read) +
`assets/` + a `thumbnail.<ext>`. See `src/lib/exportFormat.ts` for the exact manifest shape.
