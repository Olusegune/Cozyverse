# Design note — a third decompose path: "Asset Library"

*Status: proposal, not built. 2026-08-28.*

## The idea

After decomposition detects the objects in an image (sofa, lamp, rug, plant…),
offer a third path alongside **3D gen** (Tripo/Meshy) and **Images** (cutouts for
your own tool):

> **Asset Library** — for each detected object, search curated free 3D-asset
> sources, let the user pick a model, download it, and drop it into the same
> `scene.json` layout so it assembles in Blender exactly like the AI-generated
> path does.

## Is it a good idea? Mostly yes.

For a *cozy interior diorama* — generic furniture and props — a curated library
asset usually beats AI gen:

| | AI gen (Tripo/Meshy) | Curated library asset |
|---|---|---|
| Topology | often lumpy, non-manifold | clean, made for DCC |
| UVs / materials | auto, sometimes smeared | authored |
| Scale / orientation | arbitrary | usually known / consistent within a pack |
| Uniqueness | unique to your image | shared / generic |
| Cost | ~$0.05–0.20 per model | free |
| Speed | 1–5 min each | seconds |

So this isn't power-madness — it's arguably the **highest-quality path for the
80% of objects that are generic**. AI gen earns its keep on the *distinctive*
object (the weird bespoke lamp), the library earns its keep on everything else.
The golden-path version even lets you mix: library for the couch and shelves,
AI gen for the one-of-a-kind centrepiece, images for whatever neither nails.

## Pushback — three subproblems that will sink it if hand-waved

### 1. Licensing is not optional plumbing
"Free" spans CC0, CC-BY (attribution *required*), CC-BY-NC, GPL, "free for
personal use", and proprietary free tiers. Auto-pulling assets into a user's
project and letting them export/ship a scene without tracking this is a real
liability.

**Non-negotiables:**
- Default filter to **CC0 / public-domain**. CC-BY allowed only with attribution
  capture.
- Every downloaded asset records `{source, sourceUrl, author, license, licenseUrl}`
  into `scene.json` and a human-readable `CREDITS.txt` in the project.
- The Blender bridge and any export surface the attribution list.
- Never cache/redistribute the asset bytes through any Cozyverse-hosted service —
  download is always client→source.

### 2. "A sofa" ≠ "the sofa in the image"
Text search on the coarse class label gets you *a* sofa, not one that matches the
one you generated. Options, cheapest first:
- **Text-only** (v1): search `"<class>"`, show a thumbnail grid, user picks. Fine
  for diorama assembly, weak for design-matching.
- **CLIP re-rank** (v2): embed the object cutout, embed each candidate's
  thumbnail/preview, sort by cosine similarity. Turns "a sofa" into "the closest
  sofa we can find". Needs an embedding model in the runtime (the full pipeline
  already ships CLIP via ultralytics) and per-source thumbnail fetching.
- **Objaverse-style precomputed embeddings** (v3): nearest-neighbour against a
  large prebuilt index. Big win on recall, but see quality caveat below.

### 3. Style coherence
Photoreal sofa + low-poly lamp + photogrammetry rug = incoherent room. Mitigate
by letting the user **pin a source/pack** ("assemble from Quaternius CC0
furniture") so everything shares a look, or by filtering candidates on a style
embedding.

## Source options

| Source | License | API / auth | Catalog fit | Notes |
|---|---|---|---|---|
| **Poly Haven** | CC0 | open JSON API, no auth | props, some furniture | small but pristine; best v1 pick |
| **Quaternius / Kenney** | CC0 | static packs (bundle locally) | stylised furniture/props | consistent low-poly look; great for a "cozy" style lane |
| **ambientCG** | CC0 | open API | mostly materials | few models |
| **Sketchfab** | mixed; filterable | OAuth (PKCE) + download API, rate-limited | huge | v2: `downloadable=true&license=cc0`; must honour rate limits + attribution |
| **BlenderKit** | free tier royalty-free | API key | furniture/props, curated | *this is already 90% of the feature, as a Blender addon* |
| **Objaverse / -XL** | "the internet" | HF dataset + CLIP index | 800K–10M | quality is a lottery; licensing per-object is murky; research-grade |

## Recommended build order

**Phase 1 — CC0-only, text search (small, low-risk, genuinely useful).**
- New Rust module `asset_library.rs`: `library_search(class, source) -> Vec<Candidate>`
  and `library_download(candidate, project_dir) -> rel_glb_path`. Start with Poly
  Haven's API + one bundled Quaternius pack.
- `scene.json` gains a model kind `"library"` next to `tripo_fast` etc., with the
  license block. `preferred` can point at it.
- Confirm panel: a third section "Asset Library" — per detected object, a
  thumbnail row of candidates + a "use this" pick; picked assets download to
  `assets/library/` and show in the job card with a small viewer (reuse
  `ModelViewer`) and the licence line.
- Blender bridge: `"library"` becomes a selectable preferred-model source; it
  already places by bbox.
- `CREDITS.txt` writer.

**Phase 2 — Sketchfab.** OAuth PKCE, license-filtered search, attribution export,
rate-limit backoff. Much bigger catalog; more moving parts.

**Phase 3 — CLIP visual match.** Re-rank Phase 1/2 candidates by similarity of
the object cutout to each candidate's thumbnail. Makes it "the sofa".

**Or — don't build the browser at all: hand off to BlenderKit.** After importing
`scene.json`, the Blender bridge drops a per-object BlenderKit search query into
the N-panel so the user assembles from BlenderKit's (excellent, licensed,
curated) in-Blender browser. Almost nothing to build or maintain; Cozyverse's job
stays "detect + lay out + hand off". Downside: Blender-only, nothing in-app.

## Recommendation

Build **Phase 1** as the "Asset Library" path. It's a week of work, near-zero
legal risk if the CC0 filter + credits writer are done properly, and it slots
into the existing `scene.json` / Blender-bridge machinery without disturbing the
two paths that already work. Defer Sketchfab and CLIP-match until Phase 1 proves
people use it. Keep the BlenderKit hand-off in the back pocket as the cheap
alternative if Phase 1 feels like too much surface to own.
