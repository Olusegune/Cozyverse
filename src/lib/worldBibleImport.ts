import type { WorldBible } from "../types";

/** Every WorldBible field the extraction model is asked to fill, except colorPalette (handled separately
 * since it's an array of hex strings rather than free text). */
const TEXT_FIELDS: Array<keyof WorldBible> = [
  "name",
  "shortConcept",
  "description",
  "mood",
  "artStyle",
  "locationEnvironment",
  "architecture",
  "importantObjects",
  "characters",
  "cameraComposition",
  "lighting",
  "weather",
  "timeOfDay",
  "thingsToAvoid",
  "additionalNotes",
];

/** Drafts a full World Bible from a one-line idea. Unlike extraction (which must
 * never invent beyond the source), this is explicitly asked to invent rich,
 * specific, cohesive detail — the point is to turn "a rainy Tokyo noodle shop"
 * into a usable starting point in one shot, editable after. */
export function buildDraftPrompt(oneLiner: string, existingName?: string): string {
  return [
    "You are drafting a complete, vivid \"World Bible\" for a Cozyverse Studio project from a one-line idea.",
    "Invent specific, cohesive, evocative detail — colors, materials, small objects, a sense of mood and light.",
    "Don't hedge or stay generic; commit to concrete choices a visual artist could draw from immediately.",
    "Return ONLY a single raw JSON object — no markdown code fences, no commentary before or after it.",
    `The JSON object must have exactly these string keys: ${TEXT_FIELDS.join(", ")}.`,
    'It must also have a "colorPalette" key: an array of 3-6 hex color strings like "#8b7bf6" that capture the palette you invented.',
    existingName ? `The project is already named "${existingName}" — keep that as the "name" field unless the idea clearly implies a better one.` : "",
    "Every field should be filled in with something concrete — none should be left empty unless truly not applicable (e.g. \"characters\" can be an empty string for an empty scene).",
    "--- ONE-LINE IDEA ---",
    oneLiner,
  ].filter(Boolean).join("\n");
}

export function buildExtractionPrompt(sourceText: string): string {
  return [
    "You are extracting structured fields for a Cozyverse Studio \"World Bible\" from the source document below.",
    "Return ONLY a single raw JSON object — no markdown code fences, no commentary before or after it.",
    `The JSON object must have exactly these string keys: ${TEXT_FIELDS.join(", ")}.`,
    'It must also have a "colorPalette" key: an array of 3-6 hex color strings like "#8b7bf6" that capture the described palette.',
    "For any field not present or not reasonably inferable from the source text, use an empty string (or an empty array for colorPalette). Never invent details the source doesn't support.",
    "--- SOURCE DOCUMENT ---",
    sourceText,
  ].join("\n");
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Strips markdown code fences a model sometimes wraps JSON in despite being told not to. */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/** Parses the model's raw text response into a validated, type-safe Partial<WorldBible> — every field
 * is coerced to the expected type or dropped, so a malformed or partial response degrades gracefully
 * instead of crashing or writing garbage into the project. */
export function parseExtractedWorldBible(raw: string): Partial<WorldBible> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    throw new Error(`The model's response wasn't valid JSON. Raw response:\n\n${raw}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object, got something else. Raw response:\n\n${raw}`);
  }
  const source = parsed as Record<string, unknown>;
  const result: Partial<WorldBible> = {};

  for (const key of TEXT_FIELDS) {
    const value = source[key];
    if (typeof value === "string") (result as Record<string, string>)[key] = value;
  }

  const colorPalette = source.colorPalette;
  if (Array.isArray(colorPalette)) {
    const validColors = colorPalette.filter((value): value is string => typeof value === "string" && HEX_COLOR.test(value));
    if (validColors.length) result.colorPalette = validColors;
  }

  if (!Object.keys(result).length) {
    throw new Error(`The model's JSON had none of the expected World Bible fields. Raw response:\n\n${raw}`);
  }
  return result;
}
