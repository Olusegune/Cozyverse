/** Shared environmental-control option lists — Image Studio, Scene Composer, and Preview all need
 * the exact same values for weather/time/lighting, since Scene Composer's Live Preview matches a
 * scene's current controls against each generated image's own saved generation settings by plain
 * string equality (see sceneMatching.ts) — if these lists ever drifted apart between pages, a scene
 * set to a value only one page offers would never match anything. Keep this the single source. */

export const WEATHER_OPTIONS = ["Clear", "Rain", "Snow", "Fog", "Overcast", "Storm", "Windy", "Drizzle", "Heatwave", "Aurora"];

export const TIME_OPTIONS = ["Dawn", "Morning", "Day", "Golden Hour", "Sunset", "Dusk", "Night", "Midnight"];

export const LIGHTING_OPTIONS = [
  "Natural",
  "Warm",
  "Cool",
  "Dramatic",
  "Soft",
  "Cinematic",
  "Noir",
  "Golden",
  "Moody",
  "High-Key",
  "Backlit",
  "Neon",
  "Candlelit",
];

/** Quick-pick mood presets — the Mood field stays free text (so anything can still be typed), this
 * just gives a fast starting point instead of a blank box. */
export const MOOD_PRESETS = [
  "Cozy",
  "Peaceful",
  "Nostalgic",
  "Whimsical",
  "Melancholic",
  "Romantic",
  "Mysterious",
  "Adventurous",
  "Tense",
  "Joyful",
  "Serene",
  "Eerie",
  "Hopeful",
  "Lonely",
  "Triumphant",
];
