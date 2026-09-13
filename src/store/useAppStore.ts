import { create } from "zustand";
import * as api from "../lib/api";
import { buildAudioIntent, buildEditInstruction, buildImageIntent, buildMotionIntent, buildShotInstruction, type AudioKind, type ImageVariantControls, type ShotControls } from "../lib/continuity";
import { getAudioProvider, getImageProvider, getVideoProvider } from "../lib/providers";
import { audioModelForKind, connectedProviders, dialogueModel, elevenLabsVoiceIds, pickConnectedModel, runRealGeneration, upscaleModel } from "../lib/providers/realGeneration";
import { modelById } from "../lib/providers/modelRegistry";
import { buildExportManifest, validateForExport } from "../lib/exportFormat";
import { assignVoices, parseDialogueScript } from "../lib/dialogueScript";
import { pickBackgroundForControls } from "../lib/sceneMatching";
import { emptyScene } from "../types";
import type { Asset, AssetType, Character, CozyverseProject, CozyverseSummary, EntityKind, GenerationJob, Scene, TimelineShot, WorldBible } from "../types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Shot Mode's generic video-job shape — every reference slot is optional since which ones a
 * given model actually accepts is per-model (see RegisteredModel.supportsEndFrame /
 * supportsReferenceImages / supportsReferenceVideo); the field names here match what fal_input's
 * fal_shot_video_input (providers.rs) expects and drops per model. */
export type ShotVideoOptions = {
  prompt: string;
  modelId: string;
  startAssetId?: string;
  endAssetId?: string;
  referenceAssetIds?: string[];
  referenceVideoAssetId?: string;
  referenceAudioAssetIds?: string[];
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
  durationSeconds: number;
};

/** Audio Studio's Advanced Mode — full manual model pick plus every provider-specific parameter
 * (ElevenLabs voice character sliders, Suno Custom Mode lyrics/style/title) instead of the
 * kind-based auto-routing generateAudio() uses. Every field is optional; only the ones the picked
 * model actually supports get sent — see the input-building in generateAudioAdvanced. */
export type AdvancedAudioOptions = {
  modelId: string;
  assetType: AssetType;
  prompt: string;
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  lyrics?: string;
  styleTag?: string;
  title?: string;
  instrumental?: boolean;
  durationSeconds?: number;
};

type AppState = {
  summaries: CozyverseSummary[];
  loadingSummaries: boolean;
  dirName: string | null;
  project: CozyverseProject | null;
  assetUrls: Record<string, string>;
  saveStatus: SaveStatus;
  error: string | null;
  notice: string | null;
  clearError: () => void;
  clearNotice: () => void;
  generating: boolean;
  generatingMotion: boolean;
  generatingAudio: boolean;
  activeSceneId: string | null;
  /** Non-null while bringSceneToLife is mid-flight for that scene — drives the "Bring to Life"
   * button's loading state without a separate spinner per generation kind. */
  bringingToLifeSceneId: string | null;

  refreshSummaries: () => Promise<void>;
  createAndOpen: (name: string) => Promise<void>;
  open: (dirName: string) => Promise<boolean>;
  closeProject: () => void;
  rename: (dirName: string, newName: string) => Promise<void>;
  duplicate: (dirName: string) => Promise<void>;
  remove: (dirName: string) => Promise<void>;
  updateWorldBible: (patch: Partial<WorldBible>) => void;
  saveNow: () => Promise<void>;

  generateImage: (controls: ImageVariantControls, sourceAssetId?: string, useReal?: boolean, modelOverrideId?: string) => Promise<boolean>;
  generateShot: (sourceAssetId: string, controls: ShotControls, modelOverrideId?: string, additionalReferenceAssetIds?: string[]) => Promise<boolean>;
  /** "Assemble Cozies" — turns a rough in-app sketch (optionally plus one style reference asset)
   * into a finished scene via an edit-capable image model (GPT Image 2.5 by default). Saves the
   * sketch itself as a "reference" asset first, same as a picked/imported source image. */
  generateSketchAssembly: (sketchDataUrl: string, prompt: string, aspectRatio: string, styleAssetId?: string, modelOverrideId?: string) => Promise<boolean>;
  generateMotion: (sourceAssetId: string, motionDescription: string, durationSeconds: number, loop: boolean, useReal?: boolean, modelOverrideId?: string) => Promise<boolean>;
  generateVideoShot: (options: ShotVideoOptions) => Promise<boolean>;
  generateAudio: (kind: AudioKind, customInstruction: string, durationSeconds: number, loop: boolean, useReal?: boolean, genreDescription?: string, modelOverrideId?: string) => Promise<boolean>;
  generateAudioAdvanced: (options: AdvancedAudioOptions) => Promise<boolean>;
  generateDialogue: (text: string, modelOverrideId?: string) => Promise<boolean>;
  importImage: (assetType: AssetType) => Promise<void>;
  setHeroImage: (assetId: string) => Promise<void>;
  togglePreferred: (assetId: string) => Promise<void>;
  setAssetMetadata: (assetId: string, patch: Record<string, unknown>) => Promise<void>;
  renameAsset: (assetId: string, name: string) => Promise<void>;
  removeAsset: (assetId: string) => Promise<void>;
  assetUrl: (asset: Asset) => string | undefined;
  downloadAsset: (assetId: string) => Promise<void>;
  upscaleImage: (assetId: string, factor: 2 | 4) => Promise<boolean>;
  upscalingAssetId: string | null;

  setActiveScene: (sceneId: string | null) => void;
  ensureScene: () => Promise<void>;
  addScene: (name: string) => Promise<void>;
  removeScene: (sceneId: string) => Promise<void>;
  updateScene: (sceneId: string, patch: Partial<Scene>) => Promise<void>;
  setSceneControlValue: (sceneId: string, controlId: string, value: number | boolean | string) => Promise<void>;
  bringSceneToLife: (sceneId: string, useReal?: boolean) => Promise<boolean>;
  addCharacter: (name: string, kind?: EntityKind) => Promise<void>;
  removeCharacter: (characterId: string) => Promise<void>;
  updateCharacter: (characterId: string, patch: Partial<Character>) => Promise<void>;
  toggleCharacterReference: (characterId: string, assetId: string) => Promise<void>;

  addTimelineShot: (sceneId: string) => Promise<void>;
  removeTimelineShot: (shotId: string) => Promise<void>;
  moveTimelineShot: (shotId: string, direction: "up" | "down") => Promise<void>;
  setTimelineShotDuration: (shotId: string, durationSeconds: number) => Promise<void>;

  exporting: boolean;
  lastExportPath: string | null;
  exportCozyverse: () => Promise<void>;

  renderQueue: RenderQueueItem[];
  enqueueRender: (label: string, task: () => Promise<boolean>) => void;
  dismissRenderQueueItem: (id: string) => void;
  clearCompletedRenders: () => void;
};

/** A single queued generation — the task itself lives in queueTasks (see below), not here, so this
 * stays plain serializable-looking data safe to render directly in a queue panel. */
export type RenderQueueItem = { id: string; label: string; status: "queued" | "running" | "done" | "failed"; error?: string; createdAt: string; startedAt?: string };

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

// Queue tasks live outside Zustand state (closures aren't state), keyed by the same id as the
// RenderQueueItem in state. Concurrency is deliberately 1: generation jobs are already the slow part
// of this app (real providers take 1-3+ minutes), and running several at once would just compete for
// the same rate limits without actually finishing any faster.
const queueTasks = new Map<string, () => Promise<boolean>>();
let queueProcessing = false;

async function processRenderQueue(get: () => AppState, set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void) {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    for (;;) {
      const next = get().renderQueue.find((item) => item.status === "queued");
      if (!next) break;
      set((state) => ({ renderQueue: state.renderQueue.map((item) => (item.id === next.id ? { ...item, status: "running", startedAt: new Date().toISOString() } : item)) }));
      const task = queueTasks.get(next.id);
      queueTasks.delete(next.id);
      try {
        const success = task ? await task() : false;
        set((state) => ({
          renderQueue: state.renderQueue.map((item) => (item.id === next.id ? { ...item, status: success ? "done" : "failed", error: success ? undefined : state.error || "Generation failed." } : item)),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set((state) => ({ renderQueue: state.renderQueue.map((item) => (item.id === next.id ? { ...item, status: "failed", error: message } : item)) }));
      }
    }
  } finally {
    queueProcessing = false;
  }
}

async function loadAssetUrls(dirName: string, assets: Asset[], set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void) {
  const entries = await Promise.all(
    assets.map(async (asset) => {
      try {
        return [asset.id, await api.assetFileUrl(dirName, asset.filePath)] as const;
      } catch {
        return [asset.id, ""] as const;
      }
    }),
  );
  set((state) => ({ assetUrls: { ...state.assetUrls, ...Object.fromEntries(entries) } }));
}

function extensionFromDataUrl(dataUrl: string): string {
  const match = /^data:image\/(\w+);/.exec(dataUrl);
  return match ? match[1] : "png";
}

export const useAppStore = create<AppState>((set, get) => ({
  summaries: [],
  loadingSummaries: false,
  dirName: null,
  project: null,
  assetUrls: {},
  saveStatus: "idle",
  error: null,
  notice: null,
  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),
  generating: false,
  generatingMotion: false,
  generatingAudio: false,
  bringingToLifeSceneId: null,
  activeSceneId: null,
  upscalingAssetId: null,
  exporting: false,
  lastExportPath: null,
  renderQueue: [],

  enqueueRender: (label: string, task: () => Promise<boolean>) => {
    const id = crypto.randomUUID();
    queueTasks.set(id, task);
    set((state) => ({ renderQueue: [...state.renderQueue, { id, label, status: "queued", createdAt: new Date().toISOString() }] }));
    void processRenderQueue(get, set);
  },

  dismissRenderQueueItem: (id: string) => {
    queueTasks.delete(id);
    set((state) => ({ renderQueue: state.renderQueue.filter((item) => item.id !== id) }));
  },

  clearCompletedRenders: () => {
    set((state) => ({ renderQueue: state.renderQueue.filter((item) => item.status === "queued" || item.status === "running") }));
  },

  refreshSummaries: async () => {
    set({ loadingSummaries: true, error: null });
    try {
      const summaries = await api.listCozyverses();
      set({ summaries, loadingSummaries: false });
    } catch (error) {
      set({ loadingSummaries: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  createAndOpen: async (name: string) => {
    set({ error: null });
    try {
      const summary = await api.createCozyverse(name);
      await get().refreshSummaries();
      await get().open(summary.dirName);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  open: async (dirName: string) => {
    set({ error: null });
    try {
      const opened = await api.openCozyverse(dirName);
      set({ dirName: opened.dirName, project: opened.project, saveStatus: "saved", assetUrls: {}, activeSceneId: opened.project.scenes[0]?.id ?? null });
      await loadAssetUrls(opened.dirName, opened.project.assets, set);
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  closeProject: () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    set({ dirName: null, project: null, saveStatus: "idle", assetUrls: {}, activeSceneId: null });
  },

  rename: async (dirName: string, newName: string) => {
    try {
      const renamed = await api.renameCozyverse(dirName, newName);
      await get().refreshSummaries();
      if (get().dirName === dirName) await get().open(renamed.dirName);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  duplicate: async (dirName: string) => {
    try {
      await api.duplicateCozyverse(dirName);
      await get().refreshSummaries();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  remove: async (dirName: string) => {
    try {
      await api.deleteCozyverse(dirName);
      if (get().dirName === dirName) get().closeProject();
      await get().refreshSummaries();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  updateWorldBible: (patch: Partial<WorldBible>) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const worldBible = { ...project.worldBible, ...patch };
    const metadata = { ...project.metadata, name: worldBible.name || project.metadata.name, shortConcept: worldBible.shortConcept, updatedAt: new Date().toISOString() };
    set({ project: { ...project, worldBible, metadata }, saveStatus: "saving" });

    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      try {
        await Promise.all([api.saveWorldJson(dirName, worldBible), api.saveCozyverseJson(dirName, { ...project, worldBible, metadata })]);
        if (get().dirName === dirName) set({ saveStatus: "saved" });
      } catch (error) {
        set({ saveStatus: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }, 600);
  },

  saveNow: async () => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    set({ saveStatus: "saving" });
    try {
      await Promise.all([api.saveWorldJson(dirName, project.worldBible), api.saveCozyverseJson(dirName, project)]);
      set({ saveStatus: "saved", notice: "Saved." });
    } catch (error) {
      set({ saveStatus: "error", error: error instanceof Error ? error.message : String(error) });
    }
  },

  generateImage: async (controls: ImageVariantControls, sourceAssetId?: string, useReal = false, modelOverrideId?: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    const isVariant = Boolean(sourceAssetId);
    const intent = buildImageIntent(project.worldBible, controls, isVariant);
    const now = new Date().toISOString();

    let providerId = "mock";
    let modelId = "mock-renderer";
    let realModel: Awaited<ReturnType<typeof pickConnectedModel>> | undefined;
    let sourceDataUrl: string | undefined;
    let sourceAspectRatio: string | undefined;
    if (useReal) {
      try {
        realModel = modelOverrideId ? modelById(modelOverrideId) : undefined;
        if (modelOverrideId && !realModel) throw new Error(`Selected model "${modelOverrideId}" is not registered.`);
        realModel ??= await pickConnectedModel("image", "best-quality", isVariant);
        providerId = realModel.provider;
        modelId = realModel.id;
        if (isVariant && sourceAssetId) {
          const sourceAsset = project.assets.find((asset) => asset.id === sourceAssetId);
          if (!sourceAsset) throw new Error("Source image was not found.");
          sourceDataUrl = await api.assetAsDataUrl(dirName, sourceAsset.filePath);
          const sourceJob = project.generations.find((generation) => generation.id === sourceAsset.generationId);
          const sourceSettingRatio = sourceJob?.settings.aspectRatio;
          sourceAspectRatio = typeof sourceSettingRatio === "string" ? sourceSettingRatio : undefined;
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }

    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "image",
      provider: providerId,
      model: modelId,
      status: "running",
      prompt: intent.prompt,
      settings: intent.settings,
      sourceAssetIds: sourceAssetId ? [sourceAssetId] : [],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };

    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] }, generating: true, error: null } : {}));

    try {
      const realInput: Record<string, unknown> = {
        prompt: sourceDataUrl ? buildEditInstruction(controls, sourceAspectRatio) : intent.prompt,
        aspect_ratio: controls.aspectRatio,
      };
      if (sourceDataUrl) {
        realInput.image_url = sourceDataUrl;
        realInput.strength = controls.variantStrength;
      }
      const saved = realModel
        ? await runRealGeneration(realModel, realInput).then((url) => api.saveAssetFromUrl(dirName, "image", url))
        : await getImageProvider("mock")
            .generate(intent)
            .then((result) => api.saveGeneratedAsset(dirName, "image", result.dataUrl, extensionFromDataUrl(result.dataUrl)));

      const currentProject = get().project;
      if (!currentProject) return false;
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: "image",
        role: isVariant ? "variant" : "master",
        name: isVariant ? "Variant" : "Master Image",
        filePath: saved.filePath,
        source: "generated",
        provider: providerId,
        model: job.model,
        generationId: job.id,
        parentAssetId: sourceAssetId,
        metadata: { preferred: false },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [asset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, asset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, heroImageAssetId: currentProject.metadata.heroImageAssetId ?? asset.id, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, generating: false, notice: isVariant ? "Variant generated." : "Master image generated." });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, generating: false, error: message } : { generating: false, error: message }));
      return false;
    }
  },

  generateShot: async (sourceAssetId: string, controls: ShotControls, modelOverrideId?: string, additionalReferenceAssetIds?: string[]) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    const sourceAsset = project.assets.find((asset) => asset.id === sourceAssetId);
    if (!sourceAsset) {
      set({ error: "Select a source image before generating a shot." });
      return false;
    }

    let model;
    try {
      model = modelOverrideId ? modelById(modelOverrideId) : undefined;
      if (modelOverrideId && !model) throw new Error(`Selected model "${modelOverrideId}" is not registered.`);
      model ??= await pickConnectedModel("image", "editing", true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }

    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "image",
      provider: model.provider,
      model: model.id,
      status: "running",
      prompt: buildShotInstruction(controls),
      settings: { kind: "shot", subjectDescription: controls.subjectDescription, framing: controls.framing, aspectRatio: controls.aspectRatio },
      sourceAssetIds: [sourceAssetId, ...(additionalReferenceAssetIds || [])],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };
    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] }, generating: true, error: null } : {}));

    try {
      const referenceAssets = [sourceAsset, ...(additionalReferenceAssetIds || []).map((id) => project.assets.find((asset) => asset.id === id)).filter((asset): asset is Asset => Boolean(asset))];
      const referenceUrls = await Promise.all(referenceAssets.map((asset) => api.assetAsDataUrl(dirName, asset.filePath)));
      const sourceDataUrl = referenceUrls[0];
      // image_url (singular) keeps every non-multi-reference model working exactly as before;
      // reference_image_urls carries the full set for models whose provider mapping (fal_input /
      // gemini_generate_image) knows to prefer it — see RegisteredModel.supportsReferenceImages.
      const url = await runRealGeneration(model, { prompt: job.prompt, image_url: sourceDataUrl, reference_image_urls: referenceUrls, aspect_ratio: controls.aspectRatio });
      const saved = await api.saveAssetFromUrl(dirName, "image", url);
      const currentProject = get().project;
      if (!currentProject) return false;
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: "image",
        role: "shot",
        name: `Shot: ${controls.subjectDescription}`.slice(0, 60),
        filePath: saved.filePath,
        source: "generated",
        provider: model.provider,
        model: model.id,
        generationId: job.id,
        parentAssetId: sourceAssetId,
        metadata: { preferred: false },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [asset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, asset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, generating: false, notice: "Shot generated." });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, generating: false, error: message } : { generating: false, error: message }));
      return false;
    }
  },

  generateSketchAssembly: async (sketchDataUrl: string, prompt: string, aspectRatio: string, styleAssetId?: string, modelOverrideId?: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    if (!prompt.trim()) {
      set({ error: "Describe what the sketch should become before assembling." });
      return false;
    }

    let model;
    try {
      model = modelOverrideId ? modelById(modelOverrideId) : undefined;
      if (modelOverrideId && !model) throw new Error(`Selected model "${modelOverrideId}" is not registered.`);
      // GPT Image 2.5 Flare (via fal) is the natural default — the same model family ChatGPT's
      // own Sketch tool uses for turning a rough layout into a finished scene — but any connected
      // editing-capable model works, same fallback chain as Variant/Shot mode.
      model ??= modelById("openai/gpt-image-2.5/flare/edit");
      const available = await connectedProviders();
      if (!model || !available.has(model.provider)) model = await pickConnectedModel("image", "editing", true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }

    // Persist the sketch itself as a normal project asset first — same shape as an imported or
    // picked reference image, so it shows up in the gallery and can be reused later.
    let sketchAsset: Asset;
    try {
      const savedSketch = await api.saveGeneratedAsset(dirName, "image", sketchDataUrl, "png");
      sketchAsset = {
        id: crypto.randomUUID(),
        type: "image",
        role: "reference",
        name: "Sketch",
        filePath: savedSketch.filePath,
        source: "generated",
        metadata: { preferred: false },
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not save the sketch." });
      return false;
    }

    const styleAsset = styleAssetId ? project.assets.find((asset) => asset.id === styleAssetId) : undefined;
    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "image",
      provider: model.provider,
      model: model.id,
      status: "running",
      prompt,
      settings: { kind: "sketch-assembly", aspectRatio },
      sourceAssetIds: [sketchAsset.id, ...(styleAsset ? [styleAsset.id] : [])],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };
    const projectWithSketch: CozyverseProject = { ...project, assets: [...project.assets, sketchAsset], generations: [job, ...project.generations] };
    set({ project: projectWithSketch, generating: true, error: null });
    await api.saveCozyverseJson(dirName, projectWithSketch);
    await loadAssetUrls(dirName, [sketchAsset], set);

    try {
      const referenceUrls = [sketchDataUrl, ...(styleAsset ? [await api.assetAsDataUrl(dirName, styleAsset.filePath)] : [])];
      const url = await runRealGeneration(model, {
        prompt,
        image_url: sketchDataUrl,
        reference_image_urls: referenceUrls,
        aspect_ratio: aspectRatio,
      });
      const saved = await api.saveAssetFromUrl(dirName, "image", url);
      const currentProject = get().project;
      if (!currentProject) return false;
      const resultAsset: Asset = {
        id: crypto.randomUUID(),
        type: "image",
        role: "variant",
        name: "Assembled Cozy",
        filePath: saved.filePath,
        source: "generated",
        provider: model.provider,
        model: model.id,
        generationId: job.id,
        parentAssetId: sketchAsset.id,
        metadata: { preferred: false },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [resultAsset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, resultAsset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, generating: false, notice: "Cozy assembled from sketch." });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [resultAsset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, generating: false, error: message } : { generating: false, error: message }));
      return false;
    }
  },

  generateMotion: async (sourceAssetId: string, motionDescription: string, durationSeconds: number, loop: boolean, useReal = false, modelOverrideId?: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    const sourceAsset = project.assets.find((asset) => asset.id === sourceAssetId);
    if (!sourceAsset) {
      set({ error: "Select a source image before generating motion." });
      return false;
    }
    const sourceGeneration = sourceAsset.generationId ? project.generations.find((job) => job.id === sourceAsset.generationId) : undefined;
    const sourceSettings = (sourceGeneration?.settings || {}) as { weather?: string; timeOfDay?: string; lighting?: string; mood?: string; colorPalette?: string[] };
    const intent = buildMotionIntent(project.worldBible, sourceSettings, motionDescription);
    const now = new Date().toISOString();

    let providerId = "mock";
    let modelId = "mock-motion-renderer";
    let realModel: Awaited<ReturnType<typeof pickConnectedModel>> | undefined;
    let sourceDataUrl: string | undefined;
    if (useReal) {
      try {
        realModel = modelOverrideId ? modelById(modelOverrideId) : undefined;
        if (modelOverrideId && !realModel) throw new Error(`Selected model "${modelOverrideId}" is not registered.`);
        realModel ??= await pickConnectedModel("video", "best-quality", true);
        providerId = realModel.provider;
        modelId = realModel.id;
        sourceDataUrl = await api.assetAsDataUrl(dirName, sourceAsset.filePath);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }

    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "video",
      provider: providerId,
      model: modelId,
      status: "running",
      prompt: intent.prompt,
      settings: { ...intent.settings, durationSeconds, loop },
      sourceAssetIds: [sourceAssetId],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };

    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] }, generatingMotion: true, error: null } : {}));

    try {
      const saved = realModel
        ? await runRealGeneration(realModel, { prompt: intent.prompt, image_url: sourceDataUrl, duration: Math.min(15, Math.max(2, Math.round(durationSeconds))) }).then((url) =>
            api.saveAssetFromUrl(dirName, "video", url),
          )
        : await getVideoProvider("mock")
            .generate(intent, { durationSeconds, loop })
            .then((result) => api.saveGeneratedAsset(dirName, "video", result.dataUrl, result.extension));

      const currentProject = get().project;
      if (!currentProject) return false;
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: "video",
        role: "layer",
        name: `Motion: ${motionDescription || "Ambient drift"}`.slice(0, 60),
        filePath: saved.filePath,
        source: "generated",
        provider: providerId,
        model: job.model,
        generationId: job.id,
        parentAssetId: sourceAssetId,
        metadata: { preferred: false, durationSeconds, loop },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [asset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, asset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, generatingMotion: false, notice: "Motion clip generated." });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, generatingMotion: false, error: message } : { generatingMotion: false, error: message }));
      return false;
    }
  },

  generateVideoShot: async (options: ShotVideoOptions) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    const model = modelById(options.modelId);
    if (!model) {
      set({ error: `Selected model "${options.modelId}" is not registered.` });
      return false;
    }

    const resolveDataUrl = async (assetId?: string): Promise<string | undefined> => {
      if (!assetId) return undefined;
      const asset = project.assets.find((existing) => existing.id === assetId);
      if (!asset) return undefined;
      return api.assetAsDataUrl(dirName, asset.filePath);
    };

    let input: Record<string, unknown>;
    try {
      const [startUrl, endUrl, referenceUrls, referenceVideoUrl, referenceAudioUrls] = await Promise.all([
        resolveDataUrl(options.startAssetId),
        resolveDataUrl(options.endAssetId),
        Promise.all((options.referenceAssetIds || []).map(resolveDataUrl)),
        resolveDataUrl(options.referenceVideoAssetId),
        Promise.all((options.referenceAudioAssetIds || []).map(resolveDataUrl)),
      ]);
      input = {
        prompt: options.prompt,
        image_url: startUrl,
        end_image_url: endUrl,
        reference_image_urls: referenceUrls.filter((url): url is string => Boolean(url)),
        reference_video_urls: referenceVideoUrl ? [referenceVideoUrl] : [],
        reference_audio_urls: referenceAudioUrls.filter((url): url is string => Boolean(url)),
        aspect_ratio: options.aspectRatio,
        resolution: options.resolution,
        generate_audio: options.generateAudio,
        duration_seconds: Math.round(options.durationSeconds),
      };
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }

    const now = new Date().toISOString();
    const sourceAssetIds = [options.startAssetId, options.endAssetId, ...(options.referenceAssetIds || []), options.referenceVideoAssetId, ...(options.referenceAudioAssetIds || [])].filter(
      (id): id is string => Boolean(id),
    );
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "video",
      provider: model.provider,
      model: model.id,
      status: "running",
      prompt: options.prompt,
      settings: { durationSeconds: options.durationSeconds, aspectRatio: options.aspectRatio, shotMode: true },
      sourceAssetIds,
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };
    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] }, error: null } : {}));

    try {
      const url = await runRealGeneration(model, input);
      const saved = await api.saveAssetFromUrl(dirName, "video", url);
      const currentProject = get().project;
      if (!currentProject) return false;
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: "video",
        role: "layer",
        name: `Shot: ${options.prompt || "Untitled"}`.slice(0, 60),
        filePath: saved.filePath,
        source: "generated",
        provider: model.provider,
        model: model.id,
        generationId: job.id,
        parentAssetId: options.startAssetId,
        metadata: { preferred: false, durationSeconds: options.durationSeconds, loop: false, shotMode: true },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [asset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, asset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, notice: "Shot generated." });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, error: message } : { error: message }));
      return false;
    }
  },

  generateAudio: async (kind: AudioKind, customInstruction: string, durationSeconds: number, loop: boolean, useReal = false, genreDescription?: string, modelOverrideId?: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    const intent = buildAudioIntent(project.worldBible, kind, customInstruction, genreDescription);
    const now = new Date().toISOString();

    let providerId = "mock";
    let modelId = "mock-audio-renderer";
    let realModel: Awaited<ReturnType<typeof audioModelForKind>> | undefined;
    if (useReal) {
      try {
        realModel = modelOverrideId ? modelById(modelOverrideId) : undefined;
        if (modelOverrideId && !realModel) throw new Error(`Selected model "${modelOverrideId}" is not registered.`);
        realModel ??= await audioModelForKind(kind);
        providerId = realModel.provider;
        modelId = realModel.id;
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }

    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "audio",
      provider: providerId,
      model: modelId,
      status: "running",
      prompt: intent.prompt,
      settings: { ...intent.settings, durationSeconds, loop },
      sourceAssetIds: [],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };

    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] }, generatingAudio: true, error: null } : {}));

    const assetType: AssetType = kind === "ambience" ? "audio" : kind;

    try {
      const saved = realModel
        ? await runRealGeneration(realModel, { prompt: intent.prompt, duration: Math.max(kind === "music" ? 10 : 1, Math.round(durationSeconds)) }).then((url) => api.saveAssetFromUrl(dirName, assetType, url))
        : await getAudioProvider("mock")
            .generate(intent, { durationSeconds })
            .then((result) => api.saveGeneratedAsset(dirName, assetType, result.dataUrl, result.extension));

      const currentProject = get().project;
      if (!currentProject) return false;
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: assetType,
        role: currentProject.assets.some((existing) => existing.type === assetType) ? "layer" : "master",
        name: `${kind[0].toUpperCase()}${kind.slice(1)}${customInstruction ? `: ${customInstruction}` : ""}`.slice(0, 60),
        filePath: saved.filePath,
        source: "generated",
        provider: providerId,
        model: job.model,
        generationId: job.id,
        metadata: { preferred: false, durationSeconds, loop, volume: 0.8, muted: false },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [asset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, asset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, generatingAudio: false, notice: `${kind[0].toUpperCase()}${kind.slice(1)} generated.` });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, generatingAudio: false, error: message } : { generatingAudio: false, error: message }));
      return false;
    }
  },

  generateAudioAdvanced: async (options: AdvancedAudioOptions) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    const model = modelById(options.modelId);
    if (!model) {
      set({ error: `Selected model "${options.modelId}" is not registered.` });
      return false;
    }
    if (!options.prompt.trim() && !options.lyrics?.trim()) {
      set({ error: "Enter a prompt (or lyrics) before generating." });
      return false;
    }

    const input: Record<string, unknown> = { prompt: options.prompt };
    if (options.voiceId) input.voice_id = options.voiceId;
    if (options.stability !== undefined) input.stability = options.stability;
    if (options.similarityBoost !== undefined) input.similarity_boost = options.similarityBoost;
    if (options.style !== undefined) input.style = options.style;
    if (options.lyrics?.trim()) input.lyrics = options.lyrics;
    if (options.styleTag?.trim()) input.style = options.styleTag;
    if (options.title?.trim()) input.title = options.title;
    if (options.instrumental !== undefined) input.instrumental = options.instrumental;
    if (options.durationSeconds !== undefined) input.duration = Math.round(options.durationSeconds);

    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "audio",
      provider: model.provider,
      model: model.id,
      status: "running",
      prompt: options.lyrics || options.prompt,
      settings: { advanced: true, ...input },
      sourceAssetIds: [],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };
    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] }, generatingAudio: true, error: null } : {}));

    try {
      const url = await runRealGeneration(model, input);
      const saved = await api.saveAssetFromUrl(dirName, options.assetType, url);
      const currentProject = get().project;
      if (!currentProject) return false;
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: options.assetType,
        role: currentProject.assets.some((existing) => existing.type === options.assetType) ? "layer" : "master",
        name: (options.title || options.prompt || "Audio").slice(0, 60),
        filePath: saved.filePath,
        source: "generated",
        provider: model.provider,
        model: model.id,
        generationId: job.id,
        metadata: { preferred: false, durationSeconds: options.durationSeconds ?? 0, loop: false, volume: 0.8, muted: false },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [asset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, asset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, generatingAudio: false, notice: "Audio generated." });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, generatingAudio: false, error: message } : { generatingAudio: false, error: message }));
      return false;
    }
  },

  generateDialogue: async (text: string, modelOverrideId?: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    if (!text.trim()) {
      set({ error: "Enter the line to speak before generating dialogue." });
      return false;
    }
    let model;
    let voices: Map<string, string>;
    const lines = parseDialogueScript(text);
    try {
      model = modelOverrideId ? modelById(modelOverrideId) : undefined;
      if (modelOverrideId && !model) throw new Error(`Selected model "${modelOverrideId}" is not registered.`);
      model ??= await dialogueModel();
      if (model.provider === "elevenlabs") {
        const uniqueSpeakers = [...new Set(lines.map((line) => line.speaker.toLowerCase()))];
        const voiceIds = await elevenLabsVoiceIds(uniqueSpeakers.length);
        voices = new Map(uniqueSpeakers.map((speaker, index) => [speaker, voiceIds[index]]));
      } else {
        voices = assignVoices(lines);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }

    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "audio",
      provider: model.provider,
      model: model.id,
      status: "running",
      prompt: text,
      settings: { kind: "dialogue", speakers: lines.length },
      sourceAssetIds: [],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };
    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] }, generatingAudio: true, error: null } : {}));

    try {
      const resultAssetIds: string[] = [];
      for (const [index, line] of lines.entries()) {
        const voiceId = voices.get(line.speaker.toLowerCase());
        const url = await runRealGeneration(model, { prompt: line.text, ...(voiceId ? { voice_id: voiceId } : {}) });
        const saved = await api.saveAssetFromUrl(dirName, "dialogue", url);
        const currentProject = get().project;
        if (!currentProject) return false;
        const asset: Asset = {
          id: crypto.randomUUID(),
          type: "dialogue",
          role: currentProject.assets.some((existing) => existing.type === "dialogue") && index > 0 ? "layer" : "master",
          name: line.speaker ? `${line.speaker}: ${line.text.slice(0, 50)}` : line.text.slice(0, 60),
          filePath: saved.filePath,
          source: "generated",
          provider: model.provider,
          model: model.id,
          generationId: job.id,
          metadata: { preferred: false, volume: 0.8, muted: false, loop: false },
          createdAt: new Date().toISOString(),
        };
        resultAssetIds.push(asset.id);
        const nextProject: CozyverseProject = {
          ...currentProject,
          assets: [...currentProject.assets, asset],
          metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
        };
        set({ project: nextProject });
        await loadAssetUrls(dirName, [asset], set);
      }
      const finalProject = get().project;
      if (!finalProject) return false;
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds };
      const nextProject: CozyverseProject = {
        ...finalProject,
        generations: finalProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
      };
      set({ project: nextProject, generatingAudio: false, notice: lines.length > 1 ? `Generated ${lines.length} dialogue lines with distinct voices.` : "Dialogue generated." });
      await api.saveCozyverseJson(dirName, nextProject);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, generatingAudio: false, error: message } : { generatingAudio: false, error: message }));
      return false;
    }
  },

  importImage: async (assetType: AssetType) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    try {
      const imported = await api.importAsset(dirName, assetType);
      if (!imported) return;
      const isAudioFamily = assetType === "audio" || assetType === "music" || assetType === "sfx" || assetType === "dialogue";
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: assetType,
        role: project.assets.some((existing) => existing.type === assetType) ? (isAudioFamily ? "layer" : "reference") : "master",
        name: imported.name,
        filePath: imported.filePath,
        source: "imported",
        metadata: isAudioFamily ? { preferred: false, bytes: imported.bytes, volume: 0.8, muted: false, loop: false } : { preferred: false, bytes: imported.bytes },
        createdAt: new Date().toISOString(),
      };
      const nextProject: CozyverseProject = {
        ...project,
        assets: [...project.assets, asset],
        metadata: { ...project.metadata, heroImageAssetId: project.metadata.heroImageAssetId ?? (assetType === "image" ? asset.id : project.metadata.heroImageAssetId), updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  setHeroImage: async (assetId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = { ...project, metadata: { ...project.metadata, heroImageAssetId: assetId, updatedAt: new Date().toISOString() } };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  togglePreferred: async (assetId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = {
      ...project,
      assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, metadata: { ...asset.metadata, preferred: !asset.metadata.preferred } } : asset)),
    };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  setAssetMetadata: async (assetId: string, patch: Record<string, unknown>) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = {
      ...project,
      assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, metadata: { ...asset.metadata, ...patch } } : asset)),
    };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  renameAsset: async (assetId: string, name: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextProject: CozyverseProject = {
      ...project,
      assets: project.assets.map((asset) => (asset.id === assetId ? { ...asset, name: trimmed } : asset)),
    };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  downloadAsset: async (assetId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const asset = project.assets.find((existing) => existing.id === assetId);
    if (!asset) return;
    try {
      const suggestedName = asset.filePath.split("/").pop() || asset.name;
      await api.exportAssetFile(dirName, asset.filePath, suggestedName);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  upscaleImage: async (assetId: string, factor: 2 | 4) => {
    const { project, dirName } = get();
    if (!project || !dirName) return false;
    const sourceAsset = project.assets.find((asset) => asset.id === assetId);
    if (!sourceAsset) return false;

    let model;
    try {
      model = await upscaleModel();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }

    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      type: "image",
      provider: model.provider,
      model: model.id,
      status: "running",
      prompt: `Upscale ${factor}x`,
      settings: { upscaleFactor: factor },
      sourceAssetIds: [assetId],
      createdAt: now,
      startedAt: now,
      resultAssetIds: [],
    };
    set((state) => (state.project ? { project: { ...state.project, generations: [job, ...state.project.generations] } } : {}));
    set({ upscalingAssetId: assetId, error: null });

    try {
      const sourceDataUrl = await api.assetAsDataUrl(dirName, sourceAsset.filePath);
      const url = await runRealGeneration(model, { image_url: sourceDataUrl, upscale_factor: factor });
      const saved = await api.saveAssetFromUrl(dirName, "image", url);
      const currentProject = get().project;
      if (!currentProject) return false;
      const asset: Asset = {
        id: crypto.randomUUID(),
        type: "image",
        role: "layer",
        name: `${sourceAsset.name} (${factor}x upscale)`,
        filePath: saved.filePath,
        source: "generated",
        provider: model.provider,
        model: model.id,
        generationId: job.id,
        parentAssetId: assetId,
        metadata: { preferred: false },
        createdAt: new Date().toISOString(),
      };
      const completedJob: GenerationJob = { ...job, status: "completed", completedAt: new Date().toISOString(), resultAssetIds: [asset.id] };
      const nextProject: CozyverseProject = {
        ...currentProject,
        assets: [...currentProject.assets, asset],
        generations: currentProject.generations.map((existing) => (existing.id === job.id ? completedJob : existing)),
        metadata: { ...currentProject.metadata, updatedAt: new Date().toISOString() },
      };
      set({ project: nextProject, upscalingAssetId: null, notice: `${factor}x upscale generated.` });
      await api.saveCozyverseJson(dirName, nextProject);
      await loadAssetUrls(dirName, [asset], set);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => (state.project ? { project: { ...state.project, generations: state.project.generations.map((existing) => (existing.id === job.id ? { ...existing, status: "failed" as const, error: message, completedAt: new Date().toISOString() } : existing)) }, upscalingAssetId: null, error: message } : { upscalingAssetId: null, error: message }));
      return false;
    }
  },

  removeAsset: async (assetId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const asset = project.assets.find((existing) => existing.id === assetId);
    if (!asset) return;
    try {
      await api.deleteAssetFile(dirName, asset.filePath);
      const nextProject: CozyverseProject = {
        ...project,
        assets: project.assets
          .filter((existing) => existing.id !== assetId)
          .map((existing) => (existing.parentAssetId === assetId ? { ...existing, parentAssetId: undefined } : existing)),
        metadata: {
          ...project.metadata,
          heroImageAssetId: project.metadata.heroImageAssetId === assetId ? undefined : project.metadata.heroImageAssetId,
          updatedAt: new Date().toISOString(),
        },
      };
      set((state) => {
        const nextUrls = { ...state.assetUrls };
        delete nextUrls[assetId];
        return { project: nextProject, assetUrls: nextUrls };
      });
      await api.saveCozyverseJson(dirName, nextProject);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  assetUrl: (asset: Asset) => get().assetUrls[asset.id],

  setActiveScene: (sceneId: string | null) => set({ activeSceneId: sceneId }),

  ensureScene: async () => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    if (project.scenes.length > 0) {
      set((state) => ({ activeSceneId: state.activeSceneId && project.scenes.some((scene) => scene.id === state.activeSceneId) ? state.activeSceneId : project.scenes[0].id }));
      return;
    }
    const scene = emptyScene("Main Scene", project.worldBible);
    scene.backgroundAssetId = project.metadata.heroImageAssetId || project.assets.find((asset) => asset.type === "image")?.id;
    scene.motionAssetId = project.assets.find((asset) => asset.type === "video")?.id;
    scene.ambienceAssetId = project.assets.find((asset) => asset.type === "audio")?.id;
    scene.musicAssetId = project.assets.find((asset) => asset.type === "music")?.id;
    scene.sfxAssetIds = project.assets.filter((asset) => asset.type === "sfx").map((asset) => asset.id);

    const nextProject: CozyverseProject = { ...project, scenes: [scene], metadata: { ...project.metadata, updatedAt: new Date().toISOString() } };
    set({ project: nextProject, activeSceneId: scene.id });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  addScene: async (name: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const scene = emptyScene(name.trim() || `Scene ${project.scenes.length + 1}`, project.worldBible);
    const nextProject: CozyverseProject = { ...project, scenes: [...project.scenes, scene], metadata: { ...project.metadata, updatedAt: new Date().toISOString() } };
    set({ project: nextProject, activeSceneId: scene.id });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  removeScene: async (sceneId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextScenes = project.scenes.filter((scene) => scene.id !== sceneId);
    const nextProject: CozyverseProject = { ...project, scenes: nextScenes, metadata: { ...project.metadata, updatedAt: new Date().toISOString() } };
    set((state) => ({ project: nextProject, activeSceneId: state.activeSceneId === sceneId ? nextScenes[0]?.id ?? null : state.activeSceneId }));
    await api.saveCozyverseJson(dirName, nextProject);
  },

  updateScene: async (sceneId: string, patch: Partial<Scene>) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = {
      ...project,
      scenes: project.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
    };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  setSceneControlValue: async (sceneId: string, controlId: string, value: number | boolean | string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = {
      ...project,
      scenes: project.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, controls: scene.controls.map((control) => (control.id === controlId ? { ...control, value } : control)) } : scene,
      ),
    };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  addCharacter: async (name: string, kind: EntityKind = "character") => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const character: Character = { id: crypto.randomUUID(), name: name.trim() || "New Character", kind, styleSheet: "", referenceAssetIds: [], createdAt: new Date().toISOString() };
    const nextProject: CozyverseProject = { ...project, characters: [...(project.characters ?? []), character] };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  removeCharacter: async (characterId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = { ...project, characters: (project.characters ?? []).filter((character) => character.id !== characterId) };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  updateCharacter: async (characterId: string, patch: Partial<Character>) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = {
      ...project,
      characters: (project.characters ?? []).map((character) => (character.id === characterId ? { ...character, ...patch } : character)),
    };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  toggleCharacterReference: async (characterId: string, assetId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = {
      ...project,
      characters: (project.characters ?? []).map((character) =>
        character.id === characterId
          ? { ...character, referenceAssetIds: character.referenceAssetIds.includes(assetId) ? character.referenceAssetIds.filter((id) => id !== assetId) : [...character.referenceAssetIds, assetId] }
          : character,
      ),
    };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  // Turns a still scene into a fully layered one — motion + ambience + music — with a single click,
  // instead of four separate trips through Motion Studio and Audio Studio. Reuses the existing
  // generateMotion/generateAudio actions unchanged (so this can never drift from what those produce
  // on their own) with blank description text, which their own intent builders already turn into
  // sensible World-Bible-driven defaults — the same "Ambient drift" fallback Simple Mode uses when
  // its own field is left blank. Each successful clip is located by taking the newest matching asset
  // off the end of project.assets right after its generation call resolves (generateMotion/
  // generateAudio don't return the created asset's id, only success/failure), which is safe because
  // both actions always push the new asset as the last array entry before returning.
  bringSceneToLife: async (sceneId: string, useReal = false) => {
    const { project } = get();
    if (!project) return false;
    const scene = project.scenes.find((existing) => existing.id === sceneId);
    if (!scene) return false;

    const controls: Record<string, string> = { weather: "Clear", timeOfDay: "Day", lighting: "Natural" };
    for (const control of scene.controls) {
      if (control.target === "weather" || control.target === "time" || control.target === "lighting") {
        controls[control.target === "time" ? "timeOfDay" : control.target] = String(control.value);
      }
    }
    const background = pickBackgroundForControls(project.assets, project.generations, { weather: controls.weather, timeOfDay: controls.timeOfDay, lighting: controls.lighting }, scene.backgroundAssetId);
    if (!background) {
      set({ error: "This scene needs a background image before it can be brought to life — generate one in Image Studio first." });
      return false;
    }

    set({ bringingToLifeSceneId: sceneId });
    let anySucceeded = false;

    if (!scene.motionAssetId) {
      const ok = await get().generateMotion(background.id, "", 5, true, useReal);
      if (ok) {
        const assets = get().project?.assets ?? [];
        const newest = [...assets].reverse().find((asset) => asset.type === "video" && asset.parentAssetId === background.id);
        if (newest) {
          await get().updateScene(sceneId, { motionAssetId: newest.id });
          anySucceeded = true;
        }
      }
    }

    if (!scene.ambienceAssetId) {
      const ok = await get().generateAudio("ambience", "", 6, true, useReal);
      if (ok) {
        const assets = get().project?.assets ?? [];
        const newest = [...assets].reverse().find((asset) => asset.type === "audio");
        if (newest) {
          await get().updateScene(sceneId, { ambienceAssetId: newest.id });
          anySucceeded = true;
        }
      }
    }

    if (!scene.musicAssetId) {
      const ok = await get().generateAudio("music", "", 10, true, useReal);
      if (ok) {
        const assets = get().project?.assets ?? [];
        const newest = [...assets].reverse().find((asset) => asset.type === "music");
        if (newest) {
          await get().updateScene(sceneId, { musicAssetId: newest.id });
          anySucceeded = true;
        }
      }
    }

    set({ bringingToLifeSceneId: null, notice: anySucceeded ? "Scene brought to life." : null });
    return anySucceeded;
  },

  addTimelineShot: async (sceneId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const shot: TimelineShot = { id: crypto.randomUUID(), sceneId, durationSeconds: 8 };
    const nextProject: CozyverseProject = { ...project, timeline: [...project.timeline, shot] };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  removeTimelineShot: async (shotId: string) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = { ...project, timeline: project.timeline.filter((shot) => shot.id !== shotId) };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  moveTimelineShot: async (shotId: string, direction: "up" | "down") => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const index = project.timeline.findIndex((shot) => shot.id === shotId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= project.timeline.length) return;
    const nextTimeline = project.timeline.slice();
    [nextTimeline[index], nextTimeline[swapWith]] = [nextTimeline[swapWith], nextTimeline[index]];
    const nextProject: CozyverseProject = { ...project, timeline: nextTimeline };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  setTimelineShotDuration: async (shotId: string, durationSeconds: number) => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const nextProject: CozyverseProject = { ...project, timeline: project.timeline.map((shot) => (shot.id === shotId ? { ...shot, durationSeconds } : shot)) };
    set({ project: nextProject });
    await api.saveCozyverseJson(dirName, nextProject);
  },

  exportCozyverse: async () => {
    const { project, dirName } = get();
    if (!project || !dirName) return;
    const validation = validateForExport(project);
    if (!validation.ok) {
      set({ error: validation.reason });
      return;
    }
    set({ exporting: true, error: null });
    try {
      const manifest = buildExportManifest(project);
      const heroAsset = project.assets.find((asset) => asset.id === project.metadata.heroImageAssetId);
      // \p{L}\p{N} (Unicode letter/number, not the ASCII-only a-z0-9) — the plain a-z0-9 version
      // silently dropped accented characters instead of preserving them (confirmed live: "Moon
      // Café" exported as "Moon-Caf.zip", the "é" just vanishing rather than being replaced with a
      // hyphen like every other punctuation character), which given this app's explicitly
      // international project names (Lagos, Café, ...) is a real filename-mangling bug, not an edge
      // case.
      const suggestedName = `${project.metadata.name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "cozyverse"}.zip`;
      const savedPath = await api.exportCozyverse(dirName, JSON.stringify(manifest, null, 2), heroAsset?.filePath, suggestedName);
      set({ exporting: false, lastExportPath: savedPath, notice: savedPath ? `Exported to ${savedPath}` : null });
    } catch (error) {
      set({ exporting: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
