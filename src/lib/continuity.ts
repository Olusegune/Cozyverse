import type { WorldBible } from "../types";
import { CAMERA_PRESETS, composeStyleStackFragments, defaultStyleStack, type StyleStackControls } from "./styleStack";

export type ImageVariantControls = {
  weather: string;
  timeOfDay: string;
  lighting: string;
  season: string;
  mood: string;
  customInstruction: string;
  /** How much a real image-to-image generation is allowed to deviate from the source image
   * (0 = nearly identical pixels, 1 = mostly repainted). Passed to the provider as "strength". */
  variantStrength: number;
  aspectRatio: string;
  /** Independent art-direction axes (art style, construction, material, lighting preset, etc.) —
   * see src/lib/styleStack.ts. All default to unset so this never changes existing behavior. */
  styleStack: StyleStackControls;
  /** When non-empty, used verbatim as the entire prompt — World Bible identity, mood/weather/lighting
   * fields, the style stack, and "Additional Instructions" are all skipped. A full bypass, not another
   * append point. */
  rawPromptOverride: string;
};

/**
 * Expands a lighting preset into richer descriptive language for the prompt. Diffusion/edit models
 * have no separate "contrast" parameter — the only lever is how vividly the prompt describes it, so
 * presets like "Dramatic" and "Cinematic" spell out contrast/shadow language explicitly rather than
 * relying on the model to infer it from a single adjective.
 */
const LIGHTING_DESCRIPTIONS: Record<string, string> = {
  Natural: "natural daylight",
  Warm: "warm, golden-hour glow",
  Cool: "cool, blue-toned light",
  Soft: "soft, evenly diffused light",
  Dramatic: "dramatic, high-contrast lighting with deep shadows and strong highlights",
  Cinematic: "cinematic, high-contrast, moody film lighting — deep shadows, glowing highlights, strong directional light",
  Noir: "high-contrast noir lighting, near-black shadows, a single strong light source",
};

export function describeLighting(lighting: string): string {
  return LIGHTING_DESCRIPTIONS[lighting] || lighting;
}

export const defaultVariantControls = (bible: WorldBible): ImageVariantControls => ({
  weather: bible.weather || "Clear",
  timeOfDay: bible.timeOfDay || "Day",
  lighting: bible.lighting || "Natural",
  season: "Any",
  mood: bible.mood || "Cozy",
  customInstruction: "",
  variantStrength: 0.6,
  aspectRatio: "1:1",
  styleStack: defaultStyleStack(),
  rawPromptOverride: "",
});

export type GenerationIntent = {
  prompt: string;
  negativePrompt: string;
  settings: Record<string, unknown>;
};

/**
 * Combines World Bible + requested changes into a single generation intent.
 * This is the one place prompt construction happens — providers never see the World Bible directly.
 */
export function buildImageIntent(bible: WorldBible, controls: ImageVariantControls, isVariant: boolean): GenerationIntent {
  if (controls.rawPromptOverride.trim()) {
    return {
      prompt: controls.rawPromptOverride.trim(),
      negativePrompt: bible.thingsToAvoid || "",
      settings: { rawPromptOverride: true, variantStrength: isVariant ? controls.variantStrength : undefined, aspectRatio: controls.aspectRatio },
    };
  }

  const subjectParts = [
    bible.shortConcept,
    bible.description,
    bible.locationEnvironment && `Set in ${bible.locationEnvironment}.`,
    bible.architecture && `Architecture: ${bible.architecture}.`,
    bible.importantObjects && `Important objects: ${bible.importantObjects}.`,
    bible.characters && `Characters: ${bible.characters}.`,
  ].filter(Boolean);

  // Style Stack fragments used to be appended at the very end of the prompt, after mood, weather,
  // lighting, and custom instructions — diffusion/edit models weight earlier tokens more heavily,
  // so a strong art-direction fragment like "isometric miniature diorama" landing last got diluted
  // by everything ahead of it. Moving it to merely lead directionParts (right after subjectParts)
  // still wasn't enough — confirmed live: a long World Bible description ahead of it as the
  // prompt's opening sentences still dominated the framing, and the generation came back as a
  // normal ground-level illustration/photo, not a diorama. The camera/composition instruction is
  // the strongest visual-framing signal a prompt can carry, so it now leads the ENTIRE prompt —
  // ahead of the subject description, not just ahead of mood/weather/lighting — matching the
  // "style first, subject second" ordering diffusion models respond to best. Per the Style Stack's
  // own documented behavior ("leave at None to fall back to the World Bible's own art style"), a
  // chosen Art Style axis also fully replaces bible.artStyle rather than both competing for
  // attention in the same prompt.
  const styleFragments = composeStyleStackFragments(controls.styleStack);
  const hasStyleStackArtStyle = Boolean(controls.styleStack.artStyle);
  const artStyleLine = hasStyleStackArtStyle
    ? `Art style: ${styleFragments.join(", ")}.`
    : [`Art style: ${bible.artStyle || "cinematic illustration"}.`, styleFragments.length > 0 && `${styleFragments.join(", ")}.`].filter(Boolean).join(" ");

  const directionParts = [
    `Mood: ${controls.mood}.`,
    `Weather: ${controls.weather}.`,
    `Time of day: ${controls.timeOfDay}.`,
    `Lighting: ${describeLighting(controls.lighting)}.`,
    controls.season !== "Any" && `Season: ${controls.season}.`,
    bible.cameraComposition && `Camera / composition: ${bible.cameraComposition}.`,
    controls.customInstruction && controls.customInstruction,
  ].filter(Boolean);

  const prompt = [artStyleLine, ...subjectParts, ...directionParts].join(" ");
  const negativePrompt = bible.thingsToAvoid || "";

  return {
    prompt,
    negativePrompt,
    settings: {
      weather: controls.weather,
      timeOfDay: controls.timeOfDay,
      lighting: controls.lighting,
      season: controls.season,
      mood: controls.mood,
      customInstruction: controls.customInstruction,
      variantStrength: isVariant ? controls.variantStrength : undefined,
      colorPalette: bible.colorPalette,
      aspectRatio: controls.aspectRatio,
      styleStack: controls.styleStack,
    },
  };
}

/**
 * A short, imperative instruction for real image-EDIT models (as opposed to buildImageIntent's
 * prompt, which re-describes the whole subject and is meant for text-to-image generation). Edit
 * models already have the subject from the source image — burying "change to Night" after a full
 * paragraph re-describing the building, garden, and objects dilutes it. Lead with the edit itself.
 */
export function buildEditInstruction(controls: ImageVariantControls, sourceAspectRatio?: string): string {
  if (controls.rawPromptOverride.trim()) return controls.rawPromptOverride.trim();

  const changes = [
    `weather to ${controls.weather}`,
    `time of day to ${controls.timeOfDay}`,
    `lighting to ${describeLighting(controls.lighting)}`,
    controls.season !== "Any" && `season to ${controls.season}`,
  ].filter(Boolean);

  const styleFragments = composeStyleStackFragments(controls.styleStack);
  const changingAspectRatio = Boolean(sourceAspectRatio) && sourceAspectRatio !== controls.aspectRatio;

  return [
    `Edit this image: change the ${changes.join(", ")}, mood: ${controls.mood}.`,
    controls.customInstruction && controls.customInstruction,
    styleFragments.length > 0 && `Art direction: ${styleFragments.join(", ")}.`,
    changingAspectRatio
      ? `The output frame is a different aspect ratio (${controls.aspectRatio}) than the source image. Keep every existing object, wall, and piece of furniture fully visible at its original scale — do not crop or cut anything off. Extend the scene naturally by adding plausible new environment detail at the edges to fill the new frame.`
      : "Keep the same building, layout, and everything else in the scene exactly as it is — only apply the requested changes.",
  ].filter(Boolean).join(" ");
}

export type ShotControls = {
  /** What to frame in on — e.g. "the red car", "Maya's face", "the front door". Required: this is
   * what distinguishes a Shot from a Variant (reframing vs. changing conditions). */
  subjectDescription: string;
  /** One of CAMERA_PRESETS' values (from styleStack.ts) — reusing the same camera/composition
   * language as the Style Stack rather than inventing a parallel list. */
  framing: string;
  customInstruction: string;
  aspectRatio: string;
};

/**
 * A framing-focused instruction for the edit model, distinct from buildEditInstruction (which
 * changes environmental conditions on the whole scene). A Shot keeps the world exactly as it is and
 * only changes what the camera is looking at and how close it's looking.
 */
export function buildShotInstruction(controls: ShotControls): string {
  const framingPreset = CAMERA_PRESETS.find((preset) => preset.value === controls.framing);
  const framingText = framingPreset?.fragment || "a closer, more focused framing";

  return [
    `Reframe this image to focus on: ${controls.subjectDescription}.`,
    `Camera treatment: ${framingText}.`,
    controls.customInstruction && controls.customInstruction,
    "Do not change the subject's actual appearance, materials, or the world's art style — only the framing, camera distance, and composition change. Everything visible should look exactly as it does in the source image, just seen from this new framing.",
  ].filter(Boolean).join(" ");
}

export type MotionSourceSettings = {
  weather?: string;
  timeOfDay?: string;
  lighting?: string;
  mood?: string;
  colorPalette?: string[];
  styleStack?: StyleStackControls;
};

/**
 * Builds the motion generation intent from World Bible + the source image's own generation
 * settings (when known), so a video stays visually continuous with the frame it came from.
 */
export function buildMotionIntent(bible: WorldBible, sourceSettings: MotionSourceSettings, motionDescription: string): GenerationIntent {
  const weather = sourceSettings.weather || bible.weather || "Clear";
  const timeOfDay = sourceSettings.timeOfDay || bible.timeOfDay || "Day";
  const lighting = sourceSettings.lighting || bible.lighting || "Natural";
  const mood = sourceSettings.mood || bible.mood || "Cozy";
  const colorPalette = sourceSettings.colorPalette?.length ? sourceSettings.colorPalette : bible.colorPalette;

  // The source image already carries its diorama style in its pixels, but image-to-video models
  // that also read the text prompt for style (not just motion) were still coming back generic —
  // same gap as buildEditInstruction had before it started appending style fragments explicitly.
  // Pull the exact Style Stack the source image was generated with (recorded on its own generation
  // job) rather than re-describing it, so a video never contradicts the diorama type its own frame
  // was made with.
  const styleFragments = sourceSettings.styleStack ? composeStyleStackFragments(sourceSettings.styleStack) : [];

  const prompt = [
    bible.shortConcept,
    `Motion: ${motionDescription || "gentle ambient drift"}.`,
    `Weather: ${weather}.`,
    `Time of day: ${timeOfDay}.`,
    `Lighting: ${lighting}.`,
    `Mood: ${mood}.`,
    styleFragments.length > 0 && `Art direction (keep consistent with the source frame): ${styleFragments.join(", ")}.`,
  ].filter(Boolean).join(" ");

  return {
    prompt,
    negativePrompt: bible.thingsToAvoid || "",
    settings: { weather, timeOfDay, lighting, mood, colorPalette, motionDescription, styleStack: sourceSettings.styleStack },
  };
}

export type AudioKind = "ambience" | "music" | "sfx";

/** Builds the audio generation intent from World Bible mood/weather/environment plus what was asked for.
 * `genreDescription` (from a Musical Cozy preset, see musicalCozies.ts) only applies to "music" — it
 * describes the genre's sound directly, which is what a real music model like Suno actually needs;
 * mood/weather are enough context for ambience/SFX. */
export function buildAudioIntent(bible: WorldBible, kind: AudioKind, customInstruction: string, genreDescription?: string): GenerationIntent {
  const weather = bible.weather || "Clear";
  const mood = bible.mood || "Cozy";
  const environment = bible.locationEnvironment || "";

  const prompt = [
    kind === "ambience" && `Ambient soundscape for ${environment || "the scene"}, weather: ${weather}.`,
    kind === "music" && (genreDescription ? `Music genre: ${genreDescription}.` : `Background music, mood: ${mood}.`),
    kind === "sfx" && "A short sound effect.",
    `Mood: ${mood}.`,
    customInstruction,
  ].filter(Boolean).join(" ");

  return {
    prompt,
    negativePrompt: bible.thingsToAvoid || "",
    settings: { kind, weather, mood, environment, customInstruction, genreDescription },
  };
}
