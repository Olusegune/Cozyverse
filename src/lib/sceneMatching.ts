import type { Asset, GenerationJob } from "../types";

export type ControlValues = { weather: string; timeOfDay: string; lighting: string };

/**
 * Picks the best already-generated image asset for the requested environmental state, instead of
 * generating new media during playback. Each image's own generation settings (captured when it was
 * made in Image Studio) are scored against the requested controls; the asset with the most matching
 * fields wins. Falls back to `fallbackAssetId` when nothing scores above zero.
 */
export function pickBackgroundForControls(
  assets: Asset[],
  generations: GenerationJob[],
  controls: ControlValues,
  fallbackAssetId?: string,
): Asset | undefined {
  const imageAssets = assets.filter((asset) => asset.type === "image");
  const fallback = imageAssets.find((asset) => asset.id === fallbackAssetId);

  let best: { asset: Asset; score: number } | undefined;
  for (const asset of imageAssets) {
    const job = asset.generationId ? generations.find((existing) => existing.id === asset.generationId) : undefined;
    const settings = job?.settings as Partial<Record<keyof ControlValues, string>> | undefined;
    if (!settings) continue;
    let score = 0;
    if (settings.weather && settings.weather === controls.weather) score += 1;
    if (settings.timeOfDay && settings.timeOfDay === controls.timeOfDay) score += 1;
    if (settings.lighting && settings.lighting === controls.lighting) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { asset, score };
  }

  return best?.asset || fallback;
}
