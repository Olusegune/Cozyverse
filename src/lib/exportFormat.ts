import type { CozyverseProject } from "../types";

export const EXPORT_FORMAT_VERSION = 1;

/**
 * The portable Cozyverse package manifest. This is deliberately a separate, cleaner shape from the
 * internal project file — it strips editor-only bookkeeping (job polling state, trash, absolute
 * paths) and keeps only what a future web/mobile/AR runtime would need: world identity, the asset
 * graph with lineage, and scene composition. Asset `path` values are relative to the package's own
 * `assets/` folder, never to this machine.
 */
export type ExportManifest = {
  format: "cozyverse-package";
  version: number;
  id: string;
  name: string;
  shortConcept: string;
  worldBible: CozyverseProject["worldBible"];
  heroImageAssetId?: string;
  thumbnail?: string;
  assets: Array<{
    id: string;
    type: string;
    role: string;
    name: string;
    path: string;
    source: string;
    provider?: string;
    model?: string;
    parentAssetId?: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  scenes: CozyverseProject["scenes"];
  exportedAt: string;
};

export type ExportValidation = { ok: true } | { ok: false; reason: string };

/** Export validation: a package with no visual asset isn't a usable Cozyverse experience. */
export function validateForExport(project: CozyverseProject): ExportValidation {
  if (!project.assets.some((asset) => asset.type === "image")) {
    return { ok: false, reason: "Generate or import at least one image before exporting." };
  }
  return { ok: true };
}

export function buildExportManifest(project: CozyverseProject): ExportManifest {
  const heroAsset = project.assets.find((asset) => asset.id === project.metadata.heroImageAssetId);
  // Scenes may reference assets that were since deleted from the library — drop those dangling refs
  // rather than shipping a package that points at files that don't exist.
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  const cleanScenes = project.scenes.map((scene) => ({
    ...scene,
    backgroundAssetId: scene.backgroundAssetId && assetIds.has(scene.backgroundAssetId) ? scene.backgroundAssetId : undefined,
    motionAssetId: scene.motionAssetId && assetIds.has(scene.motionAssetId) ? scene.motionAssetId : undefined,
    ambienceAssetId: scene.ambienceAssetId && assetIds.has(scene.ambienceAssetId) ? scene.ambienceAssetId : undefined,
    musicAssetId: scene.musicAssetId && assetIds.has(scene.musicAssetId) ? scene.musicAssetId : undefined,
    sfxAssetIds: scene.sfxAssetIds.filter((id) => assetIds.has(id)),
  }));

  return {
    format: "cozyverse-package",
    version: EXPORT_FORMAT_VERSION,
    id: project.metadata.id,
    name: project.metadata.name,
    shortConcept: project.metadata.shortConcept,
    worldBible: project.worldBible,
    heroImageAssetId: project.metadata.heroImageAssetId,
    thumbnail: heroAsset ? `thumbnail.${heroAsset.filePath.split(".").pop() || "png"}` : undefined,
    assets: project.assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      role: asset.role,
      name: asset.name,
      path: asset.filePath,
      source: asset.source,
      provider: asset.provider,
      model: asset.model,
      parentAssetId: asset.parentAssetId,
      metadata: asset.metadata,
      createdAt: asset.createdAt,
    })),
    scenes: cleanScenes,
    exportedAt: new Date().toISOString(),
  };
}
