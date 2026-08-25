import * as api from "../api";
import { routeGeneration } from "./generationRouter";
import { activeModelsFor, modelById, setLocalModels } from "./modelRegistry";
import type { GenerationCapability, ModelProfile, ProviderId, RegisteredModel } from "./modelRegistry";

/** Turns a user-configured ComfyUI model (Settings > Local Models) into the same shape every
 * catalog model has, so it can flow through the existing dropdowns/routing code unchanged.
 * Never carries a profile — local models are only ever picked explicitly (see connectedModelsFor
 * below), never by Auto routing, since routeGeneration filters by connectedProviders() and
 * "comfyui" is deliberately never a member of that set. */
function toRegisteredModel(local: api.LocalModelConfig): RegisteredModel {
  return {
    id: local.id,
    provider: "comfyui",
    family: "ComfyUI",
    label: local.name,
    capabilities: [local.capability],
    profiles: [],
    aspectRatios: [],
    costHint: "low",
    speedHint: "balanced",
    requiresStartFrame: Boolean(local.imageNodeId),
    adapterState: "active",
  };
}

export async function connectedProviders(): Promise<Set<ProviderId>> {
  const providers: ProviderId[] = ["fal", "kie", "wavespeed", "gemini", "elevenlabs", "openai"];
  const results = await Promise.all(providers.map(async (provider) => [provider, await api.providerKeyStatus(provider).catch(() => false)] as const));
  return new Set(results.filter(([, configured]) => configured).map(([provider]) => provider));
}

export async function pickConnectedModel(
  capability: GenerationCapability,
  profile: ModelProfile = "best-quality",
  requiresStartFrame = false,
): Promise<RegisteredModel> {
  const available = await connectedProviders();
  const decision = routeGeneration(capability, profile, available, requiresStartFrame);
  if (!decision.model) {
    const detected = available.size ? [...available].join(", ") : "none";
    throw new Error(`${decision.explanation} (detected connected: ${detected})`);
  }
  return decision.model;
}

/**
 * Lists every active model for a capability that's actually usable right now (its provider is
 * connected), for a Pro-mode "pick the exact model" picker rather than always trusting Auto's choice.
 */
export async function connectedModelsFor(capability: GenerationCapability, requiresStartFrame = false): Promise<RegisteredModel[]> {
  const [available, localConfigs] = await Promise.all([connectedProviders(), api.listLocalModels().catch(() => [])]);
  setLocalModels(localConfigs.map(toRegisteredModel));
  const catalog = activeModelsFor(capability)
    .filter((model) => Boolean(model.requiresStartFrame) === requiresStartFrame)
    .filter((model) => available.has(model.provider) || model.provider === "comfyui");
  return catalog;
}

/**
 * Shot Mode's model picker, unlike connectedModelsFor above, deliberately does NOT filter by
 * requiresStartFrame — it needs to list both start-frame models (Seedance Pro, Kling O3, LTX,
 * Hunyuan i2v) and reference-only models (Seedance Lite, Wan 2.7 reference) side by side, since
 * which reference slots to show is decided per-model from supportsEndFrame/supportsReferenceImages/
 * supportsReferenceVideo once one is picked, not by a single true/false toggle up front.
 */
export async function connectedVideoModelsForShotMode(): Promise<RegisteredModel[]> {
  const [available, localConfigs] = await Promise.all([connectedProviders(), api.listLocalModels().catch(() => [])]);
  setLocalModels(localConfigs.map(toRegisteredModel));
  return activeModelsFor("video").filter((model) => available.has(model.provider) || model.provider === "comfyui");
}

/**
 * Ambience/music/SFX aren't picked via the generic best-provider router — each creative "kind" maps
 * to a specific model built for that job, not a quality/speed tradeoff among interchangeable models.
 * Music specifically prefers Suno (full, real songs) over CassetteAI's short loop generator when both
 * are connected, since that's a strictly better result for the same "music" request. Throws if
 * nothing usable is connected.
 */
export async function audioModelForKind(kind: "ambience" | "music" | "sfx"): Promise<RegisteredModel> {
  const available = await connectedProviders();

  if (kind === "music") {
    if (available.has("kie")) {
      const suno = modelById("suno/v5");
      if (suno) return suno;
    }
    if (available.has("fal")) {
      const cassette = modelById("cassetteai/music-generator");
      if (cassette) return cassette;
    }
    throw new Error("No connected provider supports music generation yet — add a KIE AI (Suno) or fal.ai (CassetteAI) API key in Settings.");
  }

  const id = "cassetteai/sound-effects-generator";
  const model = modelById(id);
  if (!model) throw new Error(`Audio model ${id} is not registered.`);
  if (!available.has(model.provider)) {
    throw new Error(`No connected provider supports ${kind} generation yet — add a fal.ai API key in Settings.`);
  }
  return model;
}

/**
 * Dialogue prefers ElevenLabs (real voice design, whatever voices exist on the connected account —
 * premade and any cloned ones) over WaveSpeed's fixed 3-voice-per-gender MiniMax pool, when both are
 * connected. Mirrors how audioModelForKind prefers Suno over CassetteAI for music.
 */
export async function dialogueModel(): Promise<RegisteredModel> {
  const available = await connectedProviders();
  if (available.has("elevenlabs")) {
    const elevenlabs = modelById("elevenlabs/tts");
    if (elevenlabs) return elevenlabs;
  }
  return pickConnectedModel("audio", "lowest-cost");
}

/**
 * Returns up to `count` distinct voice IDs from the connected ElevenLabs account, cycling through
 * whatever voices actually exist there if fewer than `count` are available. There's no confirmed
 * gender/style metadata on the list endpoint to match WaveSpeed's Female/Male preset pools, so this
 * assigns distinct voices per speaker without attempting to honor a requested gender.
 */
export async function elevenLabsVoiceIds(count: number): Promise<string[]> {
  const voices = await api.elevenLabsListVoices();
  if (!voices.length) throw new Error("This ElevenLabs account has no voices available.");
  return Array.from({ length: count }, (_, index) => voices[index % voices.length].voiceId);
}

/** Resolves the upscaler model — a fixed operation, not something chosen by quality/speed profile. */
export async function upscaleModel(): Promise<RegisteredModel> {
  const model = modelById("fal-ai/clarity-upscaler");
  if (!model) throw new Error("Upscaler model is not registered.");
  const available = await connectedProviders();
  if (!available.has(model.provider)) {
    throw new Error("No connected provider supports upscaling yet — add a fal.ai API key in Settings.");
  }
  return model;
}

/** Recursively pulls every https URL — or inline data: URI, for synchronous providers like Gemini
 * that return the result bytes directly rather than a hosted link — out of a provider's response. */
function outputUrls(value: unknown): string[] {
  if (typeof value === "string") return /^(https:\/\/|data:)/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(outputUrls);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(outputUrls);
  return [];
}

// Veo video generation commonly runs several minutes — longer than every other job type here — so
// the ceiling has margin for it specifically rather than being tuned to the faster providers.
const MAX_POLL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

/** Submits a generation job to a real provider, polls to completion, and returns the first result URL. */
export async function runRealGeneration(model: RegisteredModel, input: Record<string, unknown>): Promise<string> {
  const submission = await api.submitGeneration(model.provider, model.id, input);
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const state = await api.pollGeneration(model.provider, model.id, submission.requestId, submission.statusUrl);
    const status = state.status || "IN_QUEUE";
    if (status === "COMPLETED") {
      const result = await api.generationResult(model.provider, model.id, submission.requestId, submission.responseUrl);
      const urls = [...new Set(outputUrls(result))];
      if (!urls.length) throw new Error("The provider completed the job but returned no media URL.");
      return urls[0];
    }
    if (status === "FAILED") throw new Error("The provider reported this generation failed.");
  }
  throw new Error("Generation timed out after 5 minutes.");
}
