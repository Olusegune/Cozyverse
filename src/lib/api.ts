import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Asset, AssetType, CozyverseProject, CozyverseSummary, WorldBible } from "../types";

type RustCozyverseSummary = {
  id: string;
  name: string;
  shortConcept: string;
  dirName: string;
  updatedAt: string;
  heroImagePath?: string | null;
};

const toSummary = (raw: RustCozyverseSummary): CozyverseSummary => ({
  id: raw.id,
  name: raw.name,
  shortConcept: raw.shortConcept,
  dirName: raw.dirName,
  updatedAt: raw.updatedAt,
  heroImagePath: raw.heroImagePath ? convertFileSrc(raw.heroImagePath) : undefined,
});

export async function listCozyverses(): Promise<CozyverseSummary[]> {
  const raw = await invoke<RustCozyverseSummary[]>("list_cozyverses");
  return raw.map(toSummary);
}

export async function createCozyverse(name: string): Promise<CozyverseSummary> {
  return toSummary(await invoke<RustCozyverseSummary>("create_cozyverse", { name }));
}

export async function renameCozyverse(dirName: string, newName: string): Promise<CozyverseSummary> {
  return toSummary(await invoke<RustCozyverseSummary>("rename_cozyverse", { dirName, newName }));
}

export async function duplicateCozyverse(dirName: string): Promise<CozyverseSummary> {
  return toSummary(await invoke<RustCozyverseSummary>("duplicate_cozyverse", { dirName }));
}

export async function deleteCozyverse(dirName: string): Promise<void> {
  await invoke("delete_cozyverse", { dirName });
}

export type OpenedCozyverse = { dirName: string; project: CozyverseProject; worldBible: WorldBible };

export async function openCozyverse(dirName: string): Promise<OpenedCozyverse> {
  const opened = await invoke<{ dirName: string; cozyverseJson: string; worldJson: string }>("open_cozyverse", { dirName });
  const parsed = JSON.parse(opened.cozyverseJson) as {
    metadata: CozyverseProject["metadata"];
    assets: Asset[];
    generations: CozyverseProject["generations"];
    scenes: CozyverseProject["scenes"];
    timeline?: CozyverseProject["timeline"];
  };
  const worldBible = JSON.parse(opened.worldJson) as WorldBible;
  return {
    dirName: opened.dirName,
    worldBible,
    project: {
      metadata: parsed.metadata,
      assets: parsed.assets || [],
      generations: parsed.generations || [],
      scenes: parsed.scenes || [],
      timeline: parsed.timeline || [],
      worldBible,
    },
  };
}

export async function saveCozyverseJson(dirName: string, project: CozyverseProject): Promise<void> {
  const payload = {
    format: "cozyverse-project",
    version: 1,
    metadata: project.metadata,
    assets: project.assets,
    generations: project.generations,
    scenes: project.scenes,
    timeline: project.timeline,
  };
  await invoke("save_cozyverse_json", { dirName, contents: JSON.stringify(payload, null, 2) });
}

export async function saveWorldJson(dirName: string, worldBible: WorldBible): Promise<void> {
  await invoke("save_world_json", { dirName, contents: JSON.stringify(worldBible, null, 2) });
}

export async function importAsset(dirName: string, assetType: AssetType): Promise<{ filePath: string; name: string; bytes: number } | null> {
  return invoke("import_asset", { dirName, assetType });
}

export async function saveGeneratedAsset(dirName: string, assetType: AssetType, dataUrl: string, extension: string): Promise<{ filePath: string; name: string; bytes: number }> {
  return invoke("save_generated_asset", { dirName, assetType, base64Data: dataUrl, extension });
}

export async function assetFileUrl(dirName: string, relativePath: string): Promise<string> {
  const path = await invoke<string>("asset_file_url", { dirName, relativePath });
  return convertFileSrc(path);
}

export async function assetAbsolutePath(dirName: string, relativePath: string): Promise<string> {
  return invoke<string>("asset_file_url", { dirName, relativePath });
}

export async function assetAsDataUrl(dirName: string, relativePath: string): Promise<string> {
  return invoke("asset_as_data_url", { dirName, relativePath });
}

export async function deleteAssetFile(dirName: string, relativePath: string): Promise<void> {
  await invoke("delete_asset_file", { dirName, relativePath });
}

export async function providerKeyStatus(provider: string): Promise<boolean> {
  const status = await invoke<{ configured: boolean }>("provider_key_status", { provider });
  return status.configured;
}

export async function saveProviderKey(provider: string, key: string): Promise<void> {
  await invoke("save_provider_key", { provider, key });
}

export async function deleteProviderKey(provider: string): Promise<void> {
  await invoke("delete_provider_key", { provider });
}

export async function checkProviderConnection(provider: string): Promise<{ reachable: boolean; authenticated: boolean; detail: string }> {
  return invoke("check_provider_connection", { provider });
}

export async function submitGeneration(
  provider: string,
  modelId: string,
  input: Record<string, unknown>,
): Promise<{ requestId: string; statusUrl?: string; responseUrl?: string }> {
  return invoke("submit_generation", { request: { provider, modelId, input } });
}

export async function pollGeneration(provider: string, modelId: string, requestId: string, statusUrl?: string): Promise<{ status?: string }> {
  return invoke("poll_generation", { provider, modelId, requestId, statusUrl });
}

export async function generationResult(provider: string, modelId: string, requestId: string, responseUrl?: string): Promise<unknown> {
  return invoke("generation_result", { provider, modelId, requestId, responseUrl });
}

export async function saveAssetFromUrl(dirName: string, assetType: AssetType, url: string): Promise<{ filePath: string; name: string; bytes: number }> {
  return invoke("save_asset_from_url", { dirName, assetType, url });
}

export async function geminiGenerateText(prompt: string): Promise<string> {
  return invoke("gemini_generate_text", { prompt });
}

export async function elevenLabsListVoices(): Promise<Array<{ voiceId: string; name: string }>> {
  return invoke("elevenlabs_list_voices");
}

export async function exportAssetFile(dirName: string, relativePath: string, suggestedName: string): Promise<string | null> {
  return invoke("export_asset_file", { dirName, relativePath, suggestedName });
}

export async function exportCozyverse(
  dirName: string,
  manifestJson: string,
  thumbnailRelativePath: string | undefined,
  suggestedName: string,
): Promise<string | null> {
  return invoke("export_cozyverse", { dirName, manifestJson, thumbnailRelativePath, suggestedName });
}

export type LocalModelConfig = {
  id: string;
  name: string;
  capability: "image" | "video" | "audio";
  serverUrl: string;
  workflow: unknown;
  promptNodeId: string;
  promptField: string;
  imageNodeId?: string;
  imageField?: string;
};

export async function listLocalModels(): Promise<LocalModelConfig[]> {
  return invoke("list_local_models");
}

export async function saveLocalModel(model: LocalModelConfig): Promise<void> {
  await invoke("save_local_model", { model });
}

export async function deleteLocalModel(id: string): Promise<void> {
  await invoke("delete_local_model", { id });
}

export async function comfyuiTestConnection(serverUrl: string): Promise<{ reachable: boolean; authenticated: boolean; detail: string }> {
  return invoke("comfyui_test_connection", { serverUrl });
}

export async function ffmpegAvailable(): Promise<boolean> {
  return invoke("ffmpeg_available");
}

export async function revealInExplorer(path: string): Promise<void> {
  await invoke("reveal_in_explorer", { path });
}

/** Opens a native Save As dialog and copies the rendered file there. Returns null if the user
 * cancels the dialog — not an error. */
export async function saveVideoCopy(sourcePath: string, suggestedName: string): Promise<string | null> {
  return invoke("save_video_copy", { sourcePath, suggestedName });
}

/** Converts a raw filesystem path (what render_scene_video/render_timeline_video return) into a
 * URL the webview's asset protocol can actually load in a <video> tag. */
export function localFileUrl(path: string): string {
  return convertFileSrc(path);
}

// --- Ollama (local prompt assistant) --------------------------------------------------------

export type OllamaSettings = { serverUrl: string; model: string };

export async function ollamaGetSettings(): Promise<OllamaSettings> {
  return invoke("ollama_get_settings");
}

export async function ollamaSaveSettings(settings: OllamaSettings): Promise<void> {
  await invoke("ollama_save_settings", { settings });
}

export async function ollamaTestConnection(serverUrl: string): Promise<{ reachable: boolean; detail: string }> {
  return invoke("ollama_test_connection", { serverUrl });
}

export async function ollamaListModels(serverUrl: string): Promise<string[]> {
  return invoke("ollama_list_models", { serverUrl });
}

export async function ollamaGenerate(serverUrl: string, model: string, system: string, prompt: string): Promise<string> {
  return invoke("ollama_generate", { serverUrl, model, system, prompt });
}

export type TimelineShotRenderInput = {
  backgroundRelPath?: string;
  motionRelPath?: string;
  ambienceRelPath?: string;
  ambienceVolume: number;
  musicRelPath?: string;
  musicVolume: number;
  durationSeconds: number;
};

const normalizeTimelineShot = (shot: TimelineShotRenderInput) => ({
  backgroundRelPath: shot.backgroundRelPath,
  motionRelPath: shot.motionRelPath,
  ambienceRelPath: shot.ambienceRelPath,
  ambienceVolume: shot.ambienceVolume,
  musicRelPath: shot.musicRelPath,
  musicVolume: shot.musicVolume,
  durationSeconds: Math.round(shot.durationSeconds),
});

/** Renders one shot of a Storyboard reel into a session-scoped temp folder — called once per
 * shot (in order) so the caller can report real "shot N of M" progress between calls, rather
 * than one opaque wait for the whole reel. `session` must be the same value across every shot in
 * one render and the following finishTimelineRender call. */
export async function renderTimelineShot(dirName: string, session: string, index: number, shot: TimelineShotRenderInput): Promise<void> {
  await invoke("render_timeline_shot", { dirName, session, index, shot: normalizeTimelineShot(shot) });
}

/** Concatenates the shots already rendered via renderTimelineShot for this session into the
 * final story reel, and cleans up the temp folder. */
export async function finishTimelineRender(dirName: string, session: string, shotCount: number): Promise<string> {
  return invoke("finish_timeline_render", { dirName, session, shotCount });
}

export async function renderSceneVideo(options: {
  dirName: string;
  sceneName: string;
  backgroundRelPath?: string;
  motionRelPath?: string;
  ambienceRelPath?: string;
  ambienceVolume: number;
  musicRelPath?: string;
  musicVolume: number;
  durationSeconds: number;
}): Promise<string> {
  return invoke("render_scene_video", {
    dirName: options.dirName,
    sceneName: options.sceneName,
    backgroundRelPath: options.backgroundRelPath,
    motionRelPath: options.motionRelPath,
    ambienceRelPath: options.ambienceRelPath,
    ambienceVolume: options.ambienceVolume,
    musicRelPath: options.musicRelPath,
    musicVolume: options.musicVolume,
    durationSeconds: Math.round(options.durationSeconds),
  });
}
