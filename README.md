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

**Characters** (its own nav item) are recurring characters defined once — a name, a free-text style
sheet (appearance/wardrobe/personality), and reference images — then picked into any Shot Mode
generation in Image or Motion Studio. Picking a character auto-attaches its reference image (on
models that support one) and folds its style sheet into the prompt either way.

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

## Local AI features (Ollama)

A few features run entirely on a local Ollama model instead of a paid API — no key, no cost, fully
private. Connect Ollama once in **Settings → Prompt Assistant (Ollama)** (server URL + pick a pulled
model), then:

- **Prompt Assist** (✨ Assist next to any prompt field in Image/Motion/Audio Studio) — describe an
  idea in plain language, get back 2–3 ready-to-use prompt drafts grounded in the project's World
  Bible, active scene conditions, and the target model's own prompting idiom (`src/lib/promptAssist.ts`,
  `src/components/PromptAssist.tsx`).
- **Continuity Guardian** ("Check Continuity" next to the Characters picker in Image/Motion Studio
  Shot Mode) — compares the prompt against selected characters' style sheets and the World Bible's
  "Things to Avoid" list, flagging contradictions or missing established details with a one-click
  "Add" fix. Silent (never blocks generation) when Ollama isn't configured
  (`src/lib/continuityGuardian.ts`, `src/components/ContinuityCheck.tsx`).

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

## Architecture

- **Tauri 2** (Rust backend + native webview) — no Electron, no bundled Chromium.
- **React 19 + TypeScript + Vite** frontend, **Tailwind CSS** for styling, **Zustand** for app state
  (`src/store/useAppStore.ts` is the single source of truth for the open project).
- **Rust backend** (`src-tauri/src/`) is split by concern:
  - `lib.rs` — project filesystem (create/open/save/rename/duplicate/delete), asset storage, export
    packaging.
  - `providers.rs` — API key storage, connection checks, and the submit → poll → result generation
    job lifecycle for real providers.
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
  one prompt fragment. The Art Style axis leads the *entire* generated prompt (ahead of even the
  World Bible's own subject description) rather than being appended at the end — diffusion models
  weight earlier tokens more heavily, and a late-appended style fragment gets diluted. Every
  diorama-family Art Style preset (Cozy 3D Diorama, Retro Sci-Fi Cozy, Miniature/Toy, Handcrafted
  Clay, etc.) folds explicit camera/composition language (elevated isometric angle, visible base/
  pedestal, tilt-shift, toy-scale) directly into its own fragment rather than depending on a separate
  Camera preset nobody would think to pair with it — confirmed live across three iterations that a
  single word like "diorama" in a longer sentence isn't enough on its own.

## Splash screen & branding

- App icon source: `src-tauri/icons/` (generated from a single 1024×1024+ PNG via
  `npx tauri icon <path-to-source.png>`, which produces `icon.ico` and the PNG set Windows needs).
  To change it, replace the source image and re-run that command.
- Splash screen images live in `public/splash/exterior.png` and `public/splash/interior.png`. The
  app alternates between them on every launch (tracked in `localStorage`), auto-dismisses after
  4.5 seconds, and can be skipped immediately via the **Skip** button top-right
  (`src/components/SplashScreen.tsx`). To change the artwork, replace those two files — any
  resolution works, they're rendered `object-cover` full-bleed.

## Live-verification status (as of the last overnight feature batch)

Confirmed working end-to-end with real click-throughs: World Map (landing view, scene tiles,
navigation into Scene Composer), Bring This Scene to Life (fired a real ambience generation,
auto-linked into the scene), Day/Night Scrubber (dragging it swaps the background with a visible
crossfade). Continuity Guardian and Prompt Assist were verified earlier in the same session on
Image/Motion/Audio Studio. Style from a Photo and Postcard Export shipped with a clean typecheck and
follow the same proven patterns as the rest, but haven't had a dedicated click-through yet — worth a
quick look next time you're in Image Studio.

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
