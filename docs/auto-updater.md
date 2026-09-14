# Auto-updater

**Status: signing keypair generated, live update-fetching NOT wired in yet.** This is deliberate —
an auto-updater is a network endpoint the app will later trust to hand it an executable to install,
which is exactly the kind of surface this project's own security process (see `CLAUDE.md`'s
"designing... network endpoints" rule) says should get a design look before code, not after. The
half that's genuinely safe to do ahead of time (generating the signing key) is done; the half that
decides what the app will trust is intentionally left for a moment you're actually reviewing it.

## What exists right now

A minisign keypair, generated via `npx tauri signer generate --ci -w <path>`:

- **Private key:** `%USERPROFILE%\.cozyverse-updater.key` — outside this repo entirely, on this
  machine only. Generated with **no password** (a CLI warning, not an error) — fine for a solo
  project, but you can regenerate with `-p <password>` for stronger protection before this ever
  signs a real release. **If this file is lost, you cannot sign updates for this keypair again** —
  back it up somewhere safe (a password manager's file storage, not this repo).
- **Public key:** `%USERPROFILE%\.cozyverse-updater.key.pub` — safe to embed in `tauri.conf.json`
  once you're ready (see below). This is what verifies a downloaded update was actually signed by
  the matching private key, before the app installs it.
- **`.gitignore`** now excludes `*.key` (but not `*.key.pub`) so the private key can never be
  committed by habit, even though it doesn't live in this directory today.

## What's left to decide before wiring it live

1. **Where do update manifests get hosted?** The simplest option, since this repo already lives on
   GitHub, is GitHub Releases' `latest.json` convention
   (`https://github.com/Olusegune/Cozyverse/releases/latest/download/latest.json`) — no separate
   hosting needed. Confirm that's actually the plan before config gets written around it.
2. **Add the plugin**: `@tauri-apps/plugin-updater` (npm) + `tauri-plugin-updater` (Cargo), then a
   `plugins.updater` block in `tauri.conf.json`:
   ```jsonc
   "plugins": {
     "updater": {
       "pubkey": "<paste the contents of .cozyverse-updater.key.pub here>",
       "endpoints": ["https://github.com/Olusegune/Cozyverse/releases/latest/download/latest.json"]
     }
   }
   ```
3. **A release workflow** that builds the installer, signs it with the private key
   (`TAURI_SIGNING_PRIVATE_KEY_PATH` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env vars feed
   `tauri build` automatically once set), and publishes both the installer and the generated
   `latest.json`/`.sig` files to a GitHub Release. This is a separate, deliberate "cut a release"
   action — not something that should happen on every push the way `build.yml` does.
4. **A small "Check for updates" UI hook** (Settings, or the Help menu) calling the plugin's
   `check()`/`downloadAndInstall()` — straightforward once 1–3 are settled.

## Why this wasn't finished autonomously

Wiring the live endpoint without you having looked at where it points would mean the app trusts a
URL and a hosting decision made without your review — reversible in principle (it's just config),
but the wrong call here is the kind of mistake that's expensive to notice later (a user's machine
fetching updates from the wrong place). The keypair itself carries no such risk — it's inert until
something actually uses it to sign or verify a real release.

## Design decisions (rafter-secure-design pass)

Walked against the `deployment.md` design questions before writing any code:

- **Endpoint**: GitHub Releases' `latest.json` convention, as proposed above — no new hosting, no
  new attack surface beyond GitHub's own infrastructure, and it's a fixed, hardcoded URL baked into
  `tauri.conf.json` at build time. The app never accepts a user- or server-supplied endpoint, so
  there's no way to redirect it to fetch from somewhere else (no config injection surface).
- **Trust boundary**: the private signing key never leaves two places — this machine's
  `%USERPROFILE%\.cozyverse-updater.key` (dev-only, gitignored) and, for the release workflow, a
  GitHub Actions **encrypted repository secret** (`TAURI_SIGNING_PRIVATE_KEY`, plus
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is later re-generated with a password). It is
  never embedded in the shipped app — only the **public** key is, and only the public key can be
  derived from it. A compromised end-user machine learns nothing that helps forge an update.
- **CI posture for the release workflow**: separate from `build.yml`, triggered only on pushing a
  version tag (`v*`), not on every push — cutting a release is a deliberate act, not a side effect
  of merging. Uses the default `GITHUB_TOKEN` scoped to `contents: write` (needed to create the
  Release + upload assets) and nothing broader. Secrets are only ever available to a same-repo tag
  push, never to a PR built from a fork.
- **What ships in the app**: only the public key (`tauri.conf.json`'s `plugins.updater.pubkey`) and
  the fixed endpoint URL. No way to disable signature verification exists in a release build — the
  plugin always verifies before installing.
- **Residual risk accepted**: this is signed-artifact integrity (minisign signature checked before
  install), not a full reproducible-build/SLSA-3 attested pipeline — a reasonable bar for a solo
  project shipping from GitHub-hosted runners; revisit if this ever needs to satisfy an org's
  supply-chain policy.

## What's wired now

- `tauri.conf.json` has a `plugins.updater` block with the public key above and the GitHub Releases
  endpoint.
- `@tauri-apps/plugin-updater` (JS) + `tauri-plugin-updater` (Rust) are registered.
- Settings has a "Check for Updates" action that calls the plugin's `check()`, and — only if an
  update is found — a confirmation before `downloadAndInstall()` runs (never silent/automatic).
- `.github/workflows/release.yml` builds, signs (via the two `TAURI_SIGNING_PRIVATE_KEY*` secrets
  you still need to add in GitHub → Settings → Secrets), and publishes a GitHub Release with the
  installer + `latest.json` + `.sig` files, on every `v*` tag push.

## What you still need to do

1. Add `TAURI_SIGNING_PRIVATE_KEY` as a GitHub Actions repo secret — the contents of
   `%USERPROFILE%\.cozyverse-updater.key`. (Add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` too, only if
   you regenerate the key with a password — the current one has none.)
2. Push a `v0.2.0` tag (or whatever the next real version is) to cut the first signed release and
   confirm the workflow produces a working `latest.json`.
3. From then on, every future release just needs `git tag vX.Y.Z && git push --tags`.
