import { describe, expect, it } from "vitest";
import { LIGHT_PRESETS, LIGHT_PRESET_LIST, type LightPresetId } from "./lightPresets";

const EXPECTED_IDS: LightPresetId[] = ["studio", "goldenHour", "cozyWarm", "moonlitBlue", "overcast"];

describe("LIGHT_PRESETS", () => {
  it("has exactly the 5 documented presets, keyed by their own id", () => {
    expect(Object.keys(LIGHT_PRESETS).sort()).toEqual([...EXPECTED_IDS].sort());
    for (const id of EXPECTED_IDS) {
      expect(LIGHT_PRESETS[id].id).toBe(id);
    }
  });

  it("LIGHT_PRESET_LIST matches LIGHT_PRESETS (this session's UI iterates the list, not the map)", () => {
    expect(LIGHT_PRESET_LIST).toHaveLength(EXPECTED_IDS.length);
    expect(LIGHT_PRESET_LIST.map((p) => p.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("every preset has a valid hex color everywhere a color is expected", () => {
    const hexColor = /^0x[0-9a-fA-F]{6}$/;
    const asHex = (n: number) => "0x" + n.toString(16).padStart(6, "0");
    for (const preset of LIGHT_PRESET_LIST) {
      for (const value of [preset.hemisphere.sky, preset.hemisphere.ground, preset.ambient.color, preset.key.color, preset.fill.color, preset.rim.color]) {
        expect(asHex(value)).toMatch(hexColor);
      }
      if (preset.background !== null) {
        expect(asHex(preset.background)).toMatch(hexColor);
      }
    }
  });

  it("every preset has 3 positive light intensities and 3-component positions", () => {
    for (const preset of LIGHT_PRESET_LIST) {
      for (const light of [preset.key, preset.fill, preset.rim]) {
        expect(light.intensity).toBeGreaterThan(0);
        expect(light.position).toHaveLength(3);
        expect(light.position.every((n) => Number.isFinite(n))).toBe(true);
      }
    }
  });

  it("studio is the only preset with a transparent (null) background — it's the app's original default", () => {
    expect(LIGHT_PRESETS.studio.background).toBeNull();
    for (const id of EXPECTED_IDS.filter((i) => i !== "studio")) {
      expect(LIGHT_PRESETS[id].background).not.toBeNull();
    }
  });
});
