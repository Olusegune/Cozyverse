// One-click lighting setups for the in-app 3D viewer (ModelViewer / the combined-scene preview).
// Each preset is just a description of the same light rig ModelViewer already builds (hemisphere +
// ambient + key/fill/rim directional) with different colors/intensities/positions — no new
// rendering path, so applying one is a cheap prop change, not a re-mount.

export type LightPresetId = "studio" | "goldenHour" | "cozyWarm" | "moonlitBlue" | "overcast";

export type LightPresetDef = {
  id: LightPresetId;
  label: string;
  /** Swatch color shown in the picker UI. */
  swatch: string;
  hemisphere: { sky: number; ground: number; intensity: number };
  ambient: { color: number; intensity: number };
  key: { color: number; intensity: number; position: [number, number, number] };
  fill: { color: number; intensity: number; position: [number, number, number] };
  rim: { color: number; intensity: number; position: [number, number, number] };
  background: number | null; // null = transparent, matches ModelViewer's current default
};

export const LIGHT_PRESETS: Record<LightPresetId, LightPresetDef> = {
  studio: {
    id: "studio",
    label: "Studio",
    swatch: "#c7cad1",
    hemisphere: { sky: 0xffffff, ground: 0x505060, intensity: 3.2 },
    ambient: { color: 0xffffff, intensity: 0.6 },
    key: { color: 0xffffff, intensity: 3.0, position: [3, 5, 4] },
    fill: { color: 0xffffff, intensity: 1.4, position: [-4, 2, -3] },
    rim: { color: 0xffffff, intensity: 1.0, position: [0, 3, -5] },
    background: null,
  },
  goldenHour: {
    id: "goldenHour",
    label: "Golden Hour",
    swatch: "#f0a860",
    hemisphere: { sky: 0xffb870, ground: 0x3a2a1a, intensity: 2.6 },
    ambient: { color: 0xffddaa, intensity: 0.5 },
    key: { color: 0xffb347, intensity: 3.6, position: [6, 2.5, 3] },
    fill: { color: 0xff8f6b, intensity: 1.1, position: [-3, 1.5, -2] },
    rim: { color: 0xffe1a8, intensity: 1.3, position: [-1, 2, -5] },
    background: 0x2a1c14,
  },
  cozyWarm: {
    id: "cozyWarm",
    label: "Cozy Warm",
    swatch: "#e8955e",
    hemisphere: { sky: 0xffddb0, ground: 0x40301f, intensity: 2.4 },
    ambient: { color: 0xffcc99, intensity: 0.9 },
    key: { color: 0xffbb77, intensity: 2.4, position: [2, 4, 3] },
    fill: { color: 0xff9955, intensity: 1.6, position: [-3, 1, -1] },
    rim: { color: 0xffe0b0, intensity: 0.8, position: [0, 2, -4] },
    background: 0x241a12,
  },
  moonlitBlue: {
    id: "moonlitBlue",
    label: "Moonlit Blue",
    swatch: "#5c7aa8",
    hemisphere: { sky: 0x6b85c9, ground: 0x0a0f1e, intensity: 2.2 },
    ambient: { color: 0x8ea6d8, intensity: 0.4 },
    key: { color: 0x9fb8ea, intensity: 1.8, position: [-3, 5, 4] },
    fill: { color: 0x3a5a9a, intensity: 1.2, position: [4, 1.5, -2] },
    rim: { color: 0xc7d9ff, intensity: 1.4, position: [0, 3, -5] },
    background: 0x0a0e1a,
  },
  overcast: {
    id: "overcast",
    label: "Overcast Soft",
    swatch: "#aab2bd",
    hemisphere: { sky: 0xd8dee8, ground: 0x606870, intensity: 3.0 },
    ambient: { color: 0xe8ecf2, intensity: 1.0 },
    key: { color: 0xf0f2f6, intensity: 1.8, position: [2, 6, 2] },
    fill: { color: 0xe0e4ea, intensity: 1.6, position: [-2, 4, -2] },
    rim: { color: 0xffffff, intensity: 0.5, position: [0, 2, -4] },
    background: 0x3a3e44,
  },
};

export const LIGHT_PRESET_LIST = Object.values(LIGHT_PRESETS);
