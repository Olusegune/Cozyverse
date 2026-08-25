import type { StyleStackControls } from "./styleStack";

/**
 * "Musical Cozies" — genre-driven presets from the reference deck's music taxonomy. Each bundles a
 * Style Stack selection (material/lighting/color/atmosphere) with a setting and mood matched to that
 * genre's emotional world, so picking one gives a fully-formed starting point instead of a blank
 * form. The deck's own framing: genre describes the emotional world, style presets describe how it's
 * built — this is exactly that composition, reusing the Phase 3 style stack rather than a separate system.
 */
export type MusicGenrePreset = {
  id: string;
  label: string;
  /** Short genre description fed into the Suno prompt for real music generation. */
  genreDescription: string;
  /** Scene-setting text applied to Image Studio's Additional Instructions. */
  settingDescription: string;
  mood: string;
  styleStack: Partial<StyleStackControls>;
};

export const MUSIC_GENRE_PRESETS: MusicGenrePreset[] = [
  {
    id: "jazz-lofi",
    label: "Jazz / Lo-Fi",
    genreDescription: "warm, intimate jazz / lo-fi, late-night nostalgic feel, gentle piano and brushed drums",
    settingDescription: "A tiny rainy jazz café with a listening corner — walnut wood, velvet seating, brass fixtures, steam rising from a mug.",
    mood: "Nostalgic, intimate, late-night",
    styleStack: { material: "painted-wood", lightingPreset: "warm-practical-glow", colorPreset: "vintage-cafe", atmospherePreset: "rainy-window", cameraPreset: "macro-intimacy" },
  },
  {
    id: "hip-hop",
    label: "Hip-Hop",
    genreDescription: "bold hip-hop, strong graphic composition, storefront glow, confident rhythm",
    settingDescription: "A neighborhood record shop corner with a rooftop skyline behind it — concrete, painted brick, vinyl records, colored window glow.",
    mood: "Bold, confident, urban",
    styleStack: { material: "mixed-material", lightingPreset: "rainy-neon", colorPreset: "neon-midnight", cameraPreset: "three-quarter-diorama" },
  },
  {
    id: "rnb-soul",
    label: "R&B / Soul",
    genreDescription: "smooth, romantic R&B / soul, plush and warm, flattering candlelit tone",
    settingDescription: "A candlelit lounge apartment with plush seating — velvet, satin, smoked glass, brass, soft saturated shadows.",
    mood: "Romantic, smooth, warm",
    styleStack: { material: "matte-resin", lightingPreset: "candlelit", colorPreset: "burgundy-soul", cameraPreset: "eye-level-miniature" },
  },
  {
    id: "edm-electronic",
    label: "EDM / Electronic",
    genreDescription: "futuristic EDM / electronic, restrained neon energy, driving synth pulse",
    settingDescription: "A miniature nightclub DJ booth glowing with neon — acrylic panels, resin surfaces, matte metal, controlled electric-blue and magenta glow.",
    mood: "Electric, futuristic, driving",
    styleStack: { material: "acrylic", lightingPreset: "rainy-neon", colorPreset: "neon-midnight", cameraPreset: "wide-environmental" },
  },
  {
    id: "indie-acoustic",
    label: "Indie / Acoustic",
    genreDescription: "natural, handmade indie / acoustic, gentle folk warmth, unhurried and organic",
    settingDescription: "A cozy wooden cabin studio filled with plants — raw wood, linen, wicker, morning light through the window.",
    mood: "Gentle, organic, unhurried",
    styleStack: { material: "painted-wood", lightingPreset: "golden-hour-miniature", colorPreset: "forest-sage", atmospherePreset: "soft-haze", cameraPreset: "window-view" },
  },
  {
    id: "rock-alternative",
    label: "Rock / Alternative",
    genreDescription: "compact rock / alternative, stage energy, controlled grit and volume",
    settingDescription: "A basement rehearsal room with amps, guitars, and a worn drum kit — dramatic side-lit stage lamps, red accent light.",
    mood: "Energetic, gritty, alive",
    styleStack: { material: "cardboard-model", lightingPreset: "stage-side-light", colorPreset: "autumn-vinyl", cameraPreset: "foreground-peek" },
  },
  {
    id: "classical",
    label: "Classical",
    genreDescription: "elegant classical, refined and spacious, restrained chamber-music grace",
    settingDescription: "An elegant miniature concert hall with a grand piano — marble, polished wood, matte gold, soft chandelier light.",
    mood: "Elegant, refined, spacious",
    styleStack: { material: "matte-resin", construction: "luxury-miniature", lightingPreset: "soft-overcast", colorPreset: "classical-ivory", cameraPreset: "high-angle-storybook" },
  },
];

export function musicGenreById(id: string): MusicGenrePreset | undefined {
  return MUSIC_GENRE_PRESETS.find((preset) => preset.id === id);
}
