export type ProviderId = "fal" | "kie" | "wavespeed" | "gemini" | "elevenlabs" | "openai" | "comfyui";
export type GenerationCapability = "image" | "video" | "audio";
export type ModelProfile = "best-quality" | "fastest" | "lowest-cost" | "character-consistency" | "realism" | "animation" | "product-rendering" | "editing";

export type RegisteredModel = {
  id: string; provider: ProviderId; family: string; label: string; capabilities: GenerationCapability[];
  profiles: ModelProfile[]; maxDurationSeconds?: number; aspectRatios: string[];
  costHint: "low" | "medium" | "high"; speedHint: "fast" | "balanced" | "slow";
  requiresStartFrame?: boolean;
  /** Shot Mode capability flags — which extra reference slots this specific video model actually
   * accepts, so the UI only shows fields the provider will use rather than one generic form for
   * every model. Verified against each provider's own API docs, not assumed uniform. */
  supportsEndFrame?: boolean;
  supportsReferenceImages?: number; // max count, if the model accepts a reference_image_urls array
  supportsReferenceVideo?: boolean;
  supportsReferenceAudio?: number; // max count, if the model accepts an audio reference array
  supportsResolution?: string[]; // resolution enum values, if the model takes an explicit resolution field
  supportsAudioToggle?: boolean; // if the model takes a generate_audio boolean
  /** Granular per-type @mention support — NOT the same as just accepting multiple references.
   * Seedance 2.0's docs confirm @Image1/@Video1/@Audio1 for all three reference kinds; Wan 2.6/2.7's
   * own prompt guide confirms @Video1/@Video2/@Video3 tagging for reference *videos* only — it never
   * documents an @Image mention for Wan's reference images, and Wan's reference-to-video has no
   * audio input at all. Keeping these separate (instead of one blanket boolean) means the chip row
   * only ever offers a mention type that model's own docs actually back up. */
  mentionSyntax?: { images?: boolean; video?: boolean; audio?: boolean };
  adapterState: "active" | "catalog-only";
};

/** Mostly text-to-* models — no image-to-video conditioning, since that would require uploading
 * local files to provider-hosted storage first, which is out of scope for this pass. Image variants
 * ARE supported for fal, since fal's models accept the source image inline as a base64 data URI
 * (no separate upload step needed) — see fal_input's handling of "fal-ai/nano-banana/edit".
 * Nano Banana Edit is used (not FLUX's img2img) because it's an instruction-following *edit* model —
 * it preserves the subject while changing described attributes, unlike strength-blended img2img
 * which either barely changes (low strength) or discards the subject entirely (high strength). */
export const modelRegistry: RegisteredModel[] = [
  { id: "fal-ai/flux/dev", provider: "fal", family: "FLUX", label: "FLUX.1 Dev", capabilities: ["image"], profiles: ["best-quality", "realism"], aspectRatios: ["1:1", "16:9", "9:16"], costHint: "medium", speedHint: "balanced", adapterState: "active" },
  // supportsReferenceImages: confirmed via fal's own API docs — image_urls takes a list (no
  // documented max for nano-banana; capped at a tasteful 4 in the UI rather than the raw ceiling).
  { id: "fal-ai/nano-banana/edit", provider: "fal", family: "Nano Banana", label: "Nano Banana Edit", capabilities: ["image"], profiles: ["best-quality", "editing", "character-consistency"], aspectRatios: ["1:1", "16:9", "9:16"], costHint: "medium", speedHint: "balanced", requiresStartFrame: true, supportsReferenceImages: 4, adapterState: "active" },
  // fal is OpenAI's official launch partner for GPT Image 2 — no org verification needed (unlike
  // calling OpenAI's API directly), and it reuses the exact same image_size/image_urls shapes as
  // flux/dev and nano-banana/edit above. Preferred over the native "openai" provider entries below.
  { id: "openai/gpt-image-2", provider: "fal", family: "GPT Image", label: "GPT Image 2 (via fal)", capabilities: ["image"], profiles: ["best-quality", "product-rendering", "realism"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "balanced", adapterState: "active" },
  // Confirmed via fal's docs: "A maximum of 16 images are allowed" — capped at 6 in the UI, since
  // a 16-thumbnail picker stops being a usable control long before it stops being a valid request.
  { id: "openai/gpt-image-2/edit", provider: "fal", family: "GPT Image", label: "GPT Image 2 Edit (via fal)", capabilities: ["image"], profiles: ["best-quality", "editing"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "balanced", requiresStartFrame: true, supportsReferenceImages: 6, adapterState: "active" },
  // GPT Image 2.5 (Sep 2026) — two variants on the exact same fal endpoint shape as GPT Image 2
  // above (verified against fal's own OpenAPI schema for each endpoint). Flare is OpenAI's new
  // default: ~50% lower latency than GPT Image 2 at the same quality. Sunburst trades speed for
  // precision on intricate detail/text — the mode the Sketch feature defaults to, since composing
  // a rough layout into a finished scene benefits from that extra structural accuracy.
  { id: "openai/gpt-image-2.5/flare/text-to-image", provider: "fal", family: "GPT Image", label: "GPT Image 2.5 Flare (via fal)", capabilities: ["image"], profiles: ["best-quality", "fastest", "product-rendering", "realism"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "fast", adapterState: "active" },
  { id: "openai/gpt-image-2.5/flare/edit", provider: "fal", family: "GPT Image", label: "GPT Image 2.5 Flare Edit (via fal)", capabilities: ["image"], profiles: ["best-quality", "fastest", "editing"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "fast", requiresStartFrame: true, supportsReferenceImages: 6, adapterState: "active" },
  { id: "openai/gpt-image-2.5/sunburst/text-to-image", provider: "fal", family: "GPT Image", label: "GPT Image 2.5 Sunburst (via fal)", capabilities: ["image"], profiles: ["best-quality", "product-rendering", "realism"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "slow", adapterState: "active" },
  { id: "openai/gpt-image-2.5/sunburst/edit", provider: "fal", family: "GPT Image", label: "GPT Image 2.5 Sunburst Edit (via fal)", capabilities: ["image"], profiles: ["best-quality", "editing"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "slow", requiresStartFrame: true, supportsReferenceImages: 6, adapterState: "active" },
  { id: "google/nano-banana", provider: "kie", family: "Nano Banana", label: "Nano Banana", capabilities: ["image"], profiles: ["best-quality", "editing", "character-consistency"], aspectRatios: ["1:1", "16:9", "9:16"], costHint: "medium", speedHint: "balanced", adapterState: "active" },
  { id: "gpt-image-2-text-to-image", provider: "kie", family: "GPT Image", label: "GPT Image 2 (via KIE)", capabilities: ["image"], profiles: ["best-quality", "product-rendering", "realism"], aspectRatios: ["1:1", "16:9", "9:16"], costHint: "medium", speedHint: "balanced", adapterState: "active" },
  { id: "wavespeed-ai/flux-dev", provider: "wavespeed", family: "FLUX", label: "WaveSpeed FLUX Dev", capabilities: ["image"], profiles: ["fastest", "lowest-cost", "realism"], aspectRatios: ["1:1", "16:9", "9:16"], costHint: "low", speedHint: "fast", adapterState: "active" },
  // Verified working with a real key — both text-to-image and edit-with-source-image (inline_data)
  // confirmed end-to-end. Kept after fal/kie/wavespeed in routing order since those have the longer
  // validated track record; Gemini is picked when it's the only connected provider, or the profile
  // prefers it.
  // aspectRatios reflects Gemini's confirmed supported set (1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16,
  // 16:9, 21:9) intersected with what the app's own aspect-ratio picker offers.
  { id: "gemini-3.1-flash-image", provider: "gemini", family: "Nano Banana", label: "Gemini Nano Banana", capabilities: ["image"], profiles: ["best-quality", "realism"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "fast", adapterState: "active" },
  // Gemini's generateContent natively supports multiple image parts in one request (confirmed —
  // Google's own multi-image-understanding/composition examples pass several inline_data parts
  // alongside the text prompt), so this gets the same multi-reference treatment as the fal edits.
  { id: "gemini-3.1-flash-image-edit", provider: "gemini", family: "Nano Banana", label: "Gemini Nano Banana Edit", capabilities: ["image"], profiles: ["best-quality", "editing", "character-consistency"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], costHint: "medium", speedHint: "fast", requiresStartFrame: true, supportsReferenceImages: 4, adapterState: "active" },
  // Native OpenAI — requires Organization Verification for the GPT Image family, unlike the fal
  // partner route above, which is why fal is registered first and preferred when both are connected.
  // Distinct ids from the fal entries above (Rust's "openai" provider branch ignores model_id content
  // and always calls gpt-image-2 directly, so the id here is just a routing label, not a wire value).
  { id: "openai-native/gpt-image-2", provider: "openai", family: "GPT Image", label: "GPT Image 2 (native)", capabilities: ["image"], profiles: ["product-rendering"], aspectRatios: ["1:1"], costHint: "medium", speedHint: "balanced", adapterState: "active" },
  { id: "openai-native/gpt-image-2-edit", provider: "openai", family: "GPT Image", label: "GPT Image 2 Edit (native)", capabilities: ["image"], profiles: ["product-rendering"], aspectRatios: ["1:1"], costHint: "medium", speedHint: "balanced", requiresStartFrame: true, adapterState: "active" },
  // Native OpenAI 2.5 — Rust's openai_model_from_id() maps these ids to the literal
  // "gpt-image-2.5-flare"/"gpt-image-2.5-sunburst" model strings OpenAI's API expects.
  { id: "openai-native/gpt-image-2.5-flare", provider: "openai", family: "GPT Image", label: "GPT Image 2.5 Flare (native)", capabilities: ["image"], profiles: ["fastest", "product-rendering"], aspectRatios: ["1:1"], costHint: "medium", speedHint: "fast", adapterState: "active" },
  { id: "openai-native/gpt-image-2.5-flare-edit", provider: "openai", family: "GPT Image", label: "GPT Image 2.5 Flare Edit (native)", capabilities: ["image"], profiles: ["fastest", "editing"], aspectRatios: ["1:1"], costHint: "medium", speedHint: "fast", requiresStartFrame: true, adapterState: "active" },
  { id: "openai-native/gpt-image-2.5-sunburst", provider: "openai", family: "GPT Image", label: "GPT Image 2.5 Sunburst (native)", capabilities: ["image"], profiles: ["product-rendering"], aspectRatios: ["1:1"], costHint: "medium", speedHint: "slow", adapterState: "active" },
  { id: "openai-native/gpt-image-2.5-sunburst-edit", provider: "openai", family: "GPT Image", label: "GPT Image 2.5 Sunburst Edit (native)", capabilities: ["image"], profiles: ["editing"], aspectRatios: ["1:1"], costHint: "medium", speedHint: "slow", requiresStartFrame: true, adapterState: "active" },
  { id: "kling-2.6/text-to-video", provider: "kie", family: "Kling", label: "Kling 2.6 Text to Video", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 10, aspectRatios: ["1:1", "16:9", "9:16"], costHint: "high", speedHint: "balanced", adapterState: "active" },
  { id: "fal-ai/wan/v2.7/image-to-video", provider: "fal", family: "Wan", label: "Wan 2.7 (Image to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 15, aspectRatios: ["1:1", "16:9", "9:16"], costHint: "high", speedHint: "balanced", requiresStartFrame: true, adapterState: "active" },
  // Verified working with a real key — image conditioning (bytesBase64Encoded, not inlineData), the
  // predictLongRunning submit/poll flow, and the completed-operation video URL path all confirmed.
  { id: "veo-3.1-generate-preview", provider: "gemini", family: "Veo", label: "Veo 3.1 (Image to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 8, aspectRatios: ["16:9", "9:16"], costHint: "high", speedHint: "slow", requiresStartFrame: true, adapterState: "active" },

  // --- Shot Mode video models — field names below all verified against each model's own fal.ai
  // API docs page (not assumed uniform across models), since every provider names its start/end
  // frame and reference fields differently. See fal_video_input in providers.rs for the mapping.
  { id: "fal-ai/bytedance/seedance/v1/pro/text-to-video", provider: "fal", family: "Seedance", label: "Seedance 1.0 Pro (Text to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 12, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", supportsResolution: ["480p", "720p", "1080p"], adapterState: "active" },
  { id: "fal-ai/bytedance/seedance/v1/pro/image-to-video", provider: "fal", family: "Seedance", label: "Seedance 1.0 Pro (Image to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 12, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", requiresStartFrame: true, supportsEndFrame: true, supportsResolution: ["480p", "720p", "1080p"], adapterState: "active" },
  { id: "fal-ai/bytedance/seedance/v1/lite/reference-to-video", provider: "fal", family: "Seedance", label: "Seedance 1.0 Lite (Multi-Reference)", capabilities: ["video"], profiles: ["realism", "animation", "character-consistency"], maxDurationSeconds: 12, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "medium", speedHint: "balanced", supportsReferenceImages: 4, supportsResolution: ["480p", "720p"], adapterState: "active" },
  { id: "fal-ai/kling-video/o3/standard/image-to-video", provider: "fal", family: "Kling", label: "Kling O3 (Image to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 10, aspectRatios: ["16:9", "9:16", "1:1"], costHint: "high", speedHint: "slow", requiresStartFrame: true, supportsEndFrame: true, supportsAudioToggle: true, adapterState: "active" },
  // mentionSyntax.video: confirmed via fal's own Wan 2.6/2.7 prompt guide — "Tag reference videos
  // in prompts using @Video1, @Video2, and @Video3." No @Image mention is documented for Wan's
  // reference images, so that half stays unset rather than guessed.
  { id: "fal-ai/wan/v2.7/reference-to-video", provider: "fal", family: "Wan", label: "Wan 2.7 (Multi-Reference + Video Ref)", capabilities: ["video"], profiles: ["realism", "animation", "character-consistency"], maxDurationSeconds: 10, aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"], costHint: "high", speedHint: "balanced", supportsReferenceImages: 5, supportsReferenceVideo: true, supportsResolution: ["720p", "1080p"], mentionSyntax: { video: true }, adapterState: "active" },
  // MiniMax Hailuo 02 — verified against fal's own API docs. No end-frame/reference support
  // confirmed for this model (unlike Hailuo H3/03, which does support first+last frame and
  // multimodal references but only via a distinct MiniMax-native `content[]` array shape on
  // kie.ai that couldn't be verified against real docs — not wired in to avoid guessing it).
  { id: "fal-ai/minimax/hailuo-02/standard/image-to-video", provider: "fal", family: "MiniMax Hailuo", label: "MiniMax Hailuo 02 Standard (Image to Video)", capabilities: ["video"], profiles: ["realism", "animation", "lowest-cost"], maxDurationSeconds: 10, aspectRatios: ["16:9", "9:16", "1:1"], costHint: "low", speedHint: "fast", requiresStartFrame: true, supportsResolution: ["512p", "768p"], adapterState: "active" },
  { id: "fal-ai/minimax/hailuo-02/pro/text-to-video", provider: "fal", family: "MiniMax Hailuo", label: "MiniMax Hailuo 02 Pro (Text to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 10, aspectRatios: ["16:9", "9:16", "1:1"], costHint: "medium", speedHint: "balanced", supportsResolution: ["1080p"], adapterState: "active" },
  { id: "lightricks/ltx-2.5/image-to-video/pro", provider: "fal", family: "LTX", label: "LTX 2.5 Pro (Image to Video)", capabilities: ["video"], profiles: ["best-quality", "realism"], maxDurationSeconds: 10, aspectRatios: ["16:9", "9:16", "1:1"], costHint: "medium", speedHint: "balanced", requiresStartFrame: true, supportsEndFrame: true, adapterState: "active" },
  { id: "fal-ai/hunyuan-video-v1.5/text-to-video", provider: "fal", family: "Hunyuan Video", label: "Hunyuan Video 1.5 (Text to Video)", capabilities: ["video"], profiles: ["realism", "animation", "lowest-cost"], aspectRatios: ["16:9", "9:16"], costHint: "low", speedHint: "balanced", adapterState: "active" },
  { id: "fal-ai/hunyuan-video-v1.5/image-to-video", provider: "fal", family: "Hunyuan Video", label: "Hunyuan Video 1.5 (Image to Video)", capabilities: ["video"], profiles: ["realism", "animation", "lowest-cost"], aspectRatios: ["16:9", "9:16"], costHint: "low", speedHint: "balanced", requiresStartFrame: true, adapterState: "active" },
  // Seedance 2.0 — verified against fal's own GitHub API reference (fal-ai/seedance-2.0-api) and
  // WaveSpeed's model pages. v2.0's reference-to-video takes THREE separate reference kinds (images,
  // video clips, audio clips) unlike v1's image-only reference model — see supportsReferenceAudio.
  { id: "bytedance/seedance-2.0/text-to-video", provider: "fal", family: "Seedance", label: "Seedance 2.0 (Text to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 15, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", supportsResolution: ["480p", "720p", "1080p"], supportsAudioToggle: true, adapterState: "active" },
  { id: "bytedance/seedance-2.0/image-to-video", provider: "fal", family: "Seedance", label: "Seedance 2.0 (Image to Video)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 15, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", requiresStartFrame: true, supportsEndFrame: true, supportsResolution: ["480p", "720p", "1080p"], supportsAudioToggle: true, adapterState: "active" },
  { id: "bytedance/seedance-2.0/fast/image-to-video", provider: "fal", family: "Seedance", label: "Seedance 2.0 Fast (Image to Video)", capabilities: ["video"], profiles: ["fastest", "realism", "animation"], maxDurationSeconds: 15, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "medium", speedHint: "fast", requiresStartFrame: true, supportsEndFrame: true, supportsResolution: ["480p", "720p", "1080p"], supportsAudioToggle: true, adapterState: "active" },
  // mentionSyntax (all three): confirmed via fal's GitHub API reference for this exact endpoint —
  // "Use @Image1, @Video1, @Audio1 in prompts to reference inputs and control multi-modal
  // generation." Not assumed for any other reference-taking model without the same confirmation.
  { id: "bytedance/seedance-2.0/reference-to-video", provider: "fal", family: "Seedance", label: "Seedance 2.0 (Multi-Reference: Images + Video + Audio)", capabilities: ["video"], profiles: ["realism", "animation", "character-consistency"], maxDurationSeconds: 15, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", supportsReferenceImages: 9, supportsReferenceVideo: true, supportsReferenceAudio: 3, supportsResolution: ["480p", "720p", "1080p"], supportsAudioToggle: true, mentionSyntax: { images: true, video: true, audio: true }, adapterState: "active" },
  // Same model family via WaveSpeed instead of fal — distinct ids (WaveSpeed names its start/end
  // frame fields "image"/"last_image", not "image_url"/"end_image_url" like fal) so the mapping in
  // wavespeed_video_input can tell them apart from the fal entries above.
  { id: "wavespeed-ai/seedance-2.0/image-to-video", provider: "wavespeed", family: "Seedance", label: "Seedance 2.0 (via WaveSpeed)", capabilities: ["video"], profiles: ["best-quality", "realism", "animation"], maxDurationSeconds: 15, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", requiresStartFrame: true, supportsEndFrame: true, supportsResolution: ["480p", "720p", "1080p", "4k"], supportsAudioToggle: true, adapterState: "active" },
  // "Spicy" is ByteDance/WaveSpeed's own official model name for this less-restricted-content
  // variant — not something added by this app. Same safety posture as every other model here: the
  // provider's own server-side filtering applies, this is just an API client for their product.
  { id: "wavespeed-ai/seedance-2.0/image-to-video-spicy", provider: "wavespeed", family: "Seedance", label: "Seedance 2.0 Spicy (Image to Video)", capabilities: ["video"], profiles: ["realism", "animation"], maxDurationSeconds: 15, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", requiresStartFrame: true, supportsEndFrame: true, supportsResolution: ["480p", "720p", "1080p"], supportsAudioToggle: true, adapterState: "active" },
  { id: "wavespeed-ai/seedance-v1.5-pro/image-to-video-spicy", provider: "wavespeed", family: "Seedance", label: "Seedance 1.5 Pro Spicy (Image to Video)", capabilities: ["video"], profiles: ["realism", "animation"], maxDurationSeconds: 12, aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], costHint: "high", speedHint: "balanced", requiresStartFrame: true, supportsEndFrame: true, supportsResolution: ["480p", "720p", "1080p"], supportsAudioToggle: true, adapterState: "active" },
  { id: "minimax/speech-2.8-turbo", provider: "wavespeed", family: "MiniMax Speech", label: "MiniMax Speech 2.8 Turbo", capabilities: ["audio"], profiles: ["fastest", "lowest-cost"], maxDurationSeconds: 300, aspectRatios: ["audio"], costHint: "low", speedHint: "fast", adapterState: "active" },
  // Voice id is resolved dynamically per-call from the account's own voice list (elevenlabs_list_voices)
  // rather than a hardcoded catalog, so this entry carries no fixed voice — dialogueModel() in
  // realGeneration.ts prefers this over MiniMax when connected, for real voice quality/design.
  { id: "elevenlabs/tts", provider: "elevenlabs", family: "ElevenLabs", label: "ElevenLabs Text to Speech", capabilities: ["audio"], profiles: ["best-quality"], maxDurationSeconds: 300, aspectRatios: ["audio"], costHint: "medium", speedHint: "fast", adapterState: "active" },
  { id: "cassetteai/music-generator", provider: "fal", family: "CassetteAI", label: "CassetteAI Music", capabilities: ["audio"], profiles: ["fastest", "lowest-cost"], maxDurationSeconds: 180, aspectRatios: ["audio"], costHint: "low", speedHint: "fast", adapterState: "active" },
  // Not routed generically (empty capabilities/profiles) — resolved directly by musicModel() in
  // realGeneration.ts, since Music Studio always wants a full Suno song rather than a short loop.
  { id: "suno/v5", provider: "kie", family: "Suno", label: "Suno v5", capabilities: [], profiles: [], aspectRatios: ["audio"], costHint: "medium", speedHint: "slow", adapterState: "active" },
  { id: "cassetteai/sound-effects-generator", provider: "fal", family: "CassetteAI", label: "CassetteAI Sound Effects", capabilities: ["audio"], profiles: ["fastest", "lowest-cost"], maxDurationSeconds: 30, aspectRatios: ["audio"], costHint: "low", speedHint: "fast", adapterState: "active" },
  // Not part of the general image-generation routing (empty capabilities/profiles so routeGeneration
  // never picks it) — resolved directly by upscaleModel() in realGeneration.ts, since upscaling is a
  // fixed operation on an existing image rather than a quality/speed tradeoff among generation models.
  { id: "fal-ai/clarity-upscaler", provider: "fal", family: "Clarity Upscaler", label: "Clarity Upscaler", capabilities: [], profiles: [], aspectRatios: [], costHint: "medium", speedHint: "balanced", requiresStartFrame: true, adapterState: "active" },
];

// User-configured ComfyUI models (Settings > Local Models) aren't known ahead of time, so they
// can't live in the static array above. connectedModelsFor (realGeneration.ts) hydrates this
// cache whenever a Studio page loads its model dropdown; modelById/modelsFor/activeModelsFor all
// read through it so a local model picked in a dropdown resolves the same way a catalog one does.
let localModels: RegisteredModel[] = [];

export function setLocalModels(models: RegisteredModel[]) {
  localModels = models;
}

function allModels(): RegisteredModel[] {
  return [...modelRegistry, ...localModels];
}

export function modelById(id: string): RegisteredModel | undefined {
  return allModels().find((model) => model.id === id);
}

export function modelsFor(capability: GenerationCapability, profile?: ModelProfile): RegisteredModel[] {
  return allModels().filter((model) => model.capabilities.includes(capability) && (!profile || model.profiles.includes(profile)));
}

export function activeModelsFor(capability: GenerationCapability, profile?: ModelProfile): RegisteredModel[] {
  return modelsFor(capability, profile).filter((model) => model.adapterState === "active");
}
