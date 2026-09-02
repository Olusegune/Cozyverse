export type AssetType = "image" | "video" | "audio" | "music" | "sfx" | "dialogue" | "3d";
export type AssetRole = "master" | "variant" | "shot" | "layer" | "reference" | "other";
export type AssetSource = "generated" | "imported";

export type Asset = {
  id: string;
  type: AssetType;
  role: AssetRole;
  name: string;
  /** Relative to the project's assets/ directory. */
  filePath: string;
  thumbnailPath?: string;
  source: AssetSource;
  provider?: string;
  model?: string;
  generationId?: string;
  parentAssetId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type GenerationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type GenerationType = "image" | "video" | "audio";

export type GenerationJob = {
  id: string;
  type: GenerationType;
  provider: string;
  model: string;
  status: GenerationStatus;
  prompt: string;
  settings: Record<string, unknown>;
  sourceAssetIds: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  resultAssetIds: string[];
};

export type WorldBible = {
  name: string;
  shortConcept: string;
  description: string;
  mood: string;
  artStyle: string;
  colorPalette: string[];
  locationEnvironment: string;
  architecture: string;
  importantObjects: string;
  characters: string;
  cameraComposition: string;
  lighting: string;
  weather: string;
  timeOfDay: string;
  thingsToAvoid: string;
  additionalNotes: string;
};

export type SceneEnvironmentControl = {
  id: string;
  label: string;
  kind: "slider" | "toggle" | "select";
  target: "time" | "lighting" | "weather" | "ambienceVolume" | "musicVolume" | "custom";
  min?: number;
  max?: number;
  value: number | boolean | string;
};

export type Scene = {
  id: string;
  name: string;
  backgroundAssetId?: string;
  motionAssetId?: string;
  ambienceAssetId?: string;
  musicAssetId?: string;
  sfxAssetIds: string[];
  controls: SceneEnvironmentControl[];
};

/** A cut-only story reel: an ordered sequence of scenes, each rendered for its own duration and
 * concatenated in order. No transitions yet (Tier 2 crossfade is a later pass) — each shot's clip
 * is rendered independently (same pipeline as Scene Composer's single-scene export) and stitched
 * with ffmpeg's concat demuxer. */
export type TimelineShot = {
  id: string;
  sceneId: string;
  durationSeconds: number;
};

export type CozyverseMetadata = {
  id: string;
  name: string;
  shortConcept: string;
  heroImageAssetId?: string;
  createdAt: string;
  updatedAt: string;
};

/** A reusable named character — a "style sheet" (appearance, wardrobe, personality, anything that
 * needs to stay consistent) plus reference images that ARE this character. Picking a character into
 * a shot (Image/Motion Studio Shot Mode) auto-attaches its reference image as a real reference input
 * on models that support one, and folds the style sheet text into the prompt for every model either
 * way — so consistency doesn't depend on the user re-typing the same description every time. */
export type Character = {
  id: string;
  name: string;
  styleSheet: string;
  referenceAssetIds: string[];
  createdAt: string;
};

/** In-memory shape of a fully loaded Cozyverse project. */
export type CozyverseProject = {
  metadata: CozyverseMetadata;
  worldBible: WorldBible;
  assets: Asset[];
  generations: GenerationJob[];
  scenes: Scene[];
  timeline: TimelineShot[];
  /** Optional for backward compatibility with projects saved before this field existed — always
   * read through the projectCharacters() helper below, never this field directly. */
  characters?: Character[];
};

export type CozyverseSummary = {
  id: string;
  name: string;
  shortConcept: string;
  dirName: string;
  updatedAt: string;
  heroImagePath?: string;
};

export const emptyWorldBible = (): WorldBible => ({
  name: "",
  shortConcept: "",
  description: "",
  mood: "",
  artStyle: "",
  colorPalette: [],
  locationEnvironment: "",
  architecture: "",
  importantObjects: "",
  characters: "",
  cameraComposition: "",
  lighting: "",
  weather: "",
  timeOfDay: "",
  thingsToAvoid: "",
  additionalNotes: "",
});

export const defaultSceneControls = (bible: WorldBible): SceneEnvironmentControl[] => [
  { id: "time", label: "Time", kind: "select", target: "time", value: bible.timeOfDay || "Day" },
  { id: "lighting", label: "Lighting", kind: "select", target: "lighting", value: bible.lighting || "Natural" },
  { id: "weather", label: "Weather", kind: "select", target: "weather", value: bible.weather || "Clear" },
  { id: "ambienceVolume", label: "Ambience Volume", kind: "slider", target: "ambienceVolume", min: 0, max: 100, value: 70 },
  { id: "musicVolume", label: "Music Volume", kind: "slider", target: "musicVolume", min: 0, max: 100, value: 50 },
];

export const emptyScene = (name: string, bible: WorldBible): Scene => ({
  id: crypto.randomUUID(),
  name,
  sfxAssetIds: [],
  controls: defaultSceneControls(bible),
});

export const emptyProject = (name: string): CozyverseProject => {
  const now = new Date().toISOString();
  return {
    metadata: { id: crypto.randomUUID(), name, shortConcept: "", createdAt: now, updatedAt: now },
    worldBible: { ...emptyWorldBible(), name },
    assets: [],
    generations: [],
    scenes: [],
    timeline: [],
    characters: [],
  };
};

/** Safe accessor for project.characters — always use this instead of reading the field directly,
 * since it's optional for backward compatibility with projects saved before Characters existed. */
export const projectCharacters = (project: CozyverseProject): Character[] => project.characters ?? [];
