# Code-signing the Windows installer

**Status: not yet signed.** `Cozyverse Studio_x64-setup.exe` / `.msi` currently trigger Windows
SmartScreen's "Unknown publisher" warning on first run. This can't be automated end-to-end — a
certificate requires *your* identity verification and payment with a Certificate Authority — but
everything short of that step is prepped below.

## The fastest legitimate path: Azure Trusted Signing

For an indie/small studio, a traditional OV/EV Authenticode certificate (DigiCert, Sectigo, etc.)
runs $200–500/year and EV certs require notarized business documents. **Azure Trusted Signing** is
Microsoft's newer, cheaper alternative built for exactly this case:

- ~$9.99/month (Basic tier), no hardware token, no EV paperwork
- Still requires identity verification (a real business or 3+ years of verifiable individual
  identity — Microsoft tightened individual eligibility in 2024, so check current requirements
  at the link below before starting)
- Signs immediately, integrates with `signtool.exe` the same way a traditional cert does

Steps (you'll need to do these — they require your own Microsoft/Azure account and identity docs):

1. Create an Azure account and a **Trusted Signing** resource in the Azure portal.
2. Complete identity verification (follow Microsoft's current flow — this has changed more than
   once, so use their docs as the source of truth: <https://learn.microsoft.com/azure/trusted-signing/>).
3. Create a signing certificate profile inside that resource (Public Trust, "Individual" or
   "Private Trust" depending on what you're eligible for).
4. Install the `Azure.CodeSigning` CLI/dlib per Microsoft's Trusted Signing setup guide.

## Wiring it into this build once you have it

Tauri's Windows bundler signs via `signtool.exe` and accepts either a certificate thumbprint (for a
cert installed in the Windows certificate store) or a custom sign command (needed for Trusted
Signing, which signs via its own dlib rather than a store-installed cert). Add whichever applies to
`src-tauri/tauri.conf.json`'s `bundle.windows` block:

```jsonc
// Traditional cert installed in the Windows cert store:
"windows": {
  "certificateThumbprint": "THE_CERT_THUMBPRINT",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com"
}
```

```jsonc
// Azure Trusted Signing (custom sign command — exact invocation depends on the
// Azure.CodeSigning.Dlib version; see Microsoft's Tauri/Electron integration guide):
"windows": {
  "signCommand": "azuresigntool sign -kvu %1 ..."
}
```

Don't add a `certificateThumbprint` pointing at a certificate that doesn't exist yet — `tauri build`
will fail immediately looking for it. Leave `bundle.windows` as-is until you have real signing
credentials in hand, then add the block above.

## What signing gets you (and what it doesn't)

- Removes the "Unknown publisher" line from the SmartScreen prompt and shows your verified name
  instead.
- Does **not** eliminate SmartScreen's reputation-based warning immediately — a *new* certificate
  still needs to build download reputation over the first weeks/months of real installs, same as
  an unsigned app does, just faster and with a name attached instead of "Unknown."
- Is a prerequisite for a smooth auto-update flow later (Tauri's updater plugin expects a
  consistent, verifiable publisher identity).
