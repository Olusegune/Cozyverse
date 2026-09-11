import { entityKind, ENTITY_KIND_LABELS, type Character, type WorldBible } from "../types";

export type ContinuityIssue = {
  /** What's wrong or missing, in plain language — e.g. "Amara's style sheet says she always wears
   * an orange head wrap, but this prompt doesn't mention it." */
  note: string;
  /** A short phrase to append to the prompt that resolves the issue. Empty when the issue is a
   * "Things to Avoid" violation with no simple fix-by-addition (those should be edited, not patched). */
  suggestedAddition: string;
};

/** Builds the system prompt for a continuity check — given the selected characters' style sheets
 * and the World Bible's "Things to Avoid" list, asks the local model to flag contradictions between
 * those established facts and the prompt actually being sent, not to critique the prompt generally. */
function buildContinuitySystemPrompt(characters: Character[], worldBible: WorldBible | undefined): string {
  const lines: string[] = [
    "You are a continuity checker for a creative tool called Cozyverse Studio. You are given established facts about a project, and a generation prompt the user is about to submit. Your only job is to catch contradictions or missing established details — not to critique writing quality, not to suggest unrelated improvements.",
  ];

  const sheets = characters.filter((character) => character.styleSheet.trim());
  if (sheets.length > 0) {
    lines.push("Established cast and props (their appearance/materials must stay consistent whenever they appear in a prompt):");
    for (const character of sheets) lines.push(`- ${character.name} (${ENTITY_KIND_LABELS[entityKind(character)].toLowerCase()}): ${character.styleSheet.trim()}`);
  }
  if (worldBible?.thingsToAvoid) lines.push(`Things this world must always avoid: ${worldBible.thingsToAvoid}.`);
  if (worldBible?.characters) lines.push(`World Bible's general character notes: ${worldBible.characters}.`);

  lines.push(
    "Compare the prompt against ONLY the facts above. For each real contradiction or clearly missing established detail (e.g. a named character, prop, vehicle, or set appears but a defining trait from its style sheet is absent), output one line in this exact format:",
    "ISSUE: <one short sentence describing the problem> | ADD: <a short phrase to append to the prompt that fixes it, or empty if there's no simple fix-by-addition>",
    "If there are no real issues, output exactly: OK",
    "Do not invent issues, do not comment on style or quality, do not output anything except ISSUE/ADD lines or OK. Output nothing else — no preamble, no explanation.",
  );

  return lines.join("\n");
}

/** Parses the model's line-based ISSUE/ADD response, defensively — tolerant of minor formatting
 * drift from local models (missing "ADD:" segment, extra whitespace, stray blank lines). */
export function parseContinuityIssues(raw: string): ContinuityIssue[] {
  const trimmed = raw.trim();
  if (!trimmed || /^ok\.?$/i.test(trimmed)) return [];

  const issues: ContinuityIssue[] = [];
  for (const line of trimmed.split("\n")) {
    const match = line.match(/ISSUE:\s*(.+?)(?:\s*\|\s*ADD:\s*(.*))?$/i);
    if (!match) continue;
    const note = match[1]?.trim();
    if (!note) continue;
    issues.push({ note, suggestedAddition: (match[2] || "").trim() });
  }
  return issues;
}

/** Builds the system prompt for a whole-reel continuity check — same established-facts framing as
 * the per-shot check, but comparing a scene's generation prompt against every OTHER scene's, not
 * just against the cast/props list. A per-shot check can never catch "Amara has an orange head wrap
 * in Scene 2's prompt but Scene 5's prompt describes her in a blue apron" — each shot looks
 * internally consistent on its own; the contradiction only exists across the reel. */
function buildReelContinuitySystemPrompt(characters: Character[], worldBible: WorldBible | undefined): string {
  const lines: string[] = [
    "You are a continuity checker for a creative tool called Cozyverse Studio, reviewing an entire sequence of scenes (a \"story reel\") for cross-scene contradictions — not reviewing any one scene in isolation. You will be given the established cast/props, then a numbered list of every scene's own generation prompt in reel order. Your only job is to find real contradictions in how the SAME named character, prop, vehicle, or set is described differently across two or more scenes.",
  ];
  const sheets = characters.filter((character) => character.styleSheet.trim());
  if (sheets.length > 0) {
    lines.push("Established cast and props (their appearance/materials should stay consistent across every scene they appear in):");
    for (const character of sheets) lines.push(`- ${character.name} (${ENTITY_KIND_LABELS[entityKind(character)].toLowerCase()}): ${character.styleSheet.trim()}`);
  }
  if (worldBible?.thingsToAvoid) lines.push(`Things this world must always avoid: ${worldBible.thingsToAvoid}.`);
  lines.push(
    "For each real cross-scene contradiction found, output one line in this exact format:",
    "ISSUE: <name the scenes involved and the specific contradiction, one short sentence>",
    "If there are no real cross-scene contradictions, output exactly: OK",
    "Do not flag a detail simply because one scene mentions it and another doesn't — only flag it when two scenes actively describe the same named thing differently. Do not comment on style, quality, or anything unrelated to consistency. Output nothing else — no preamble, no explanation.",
  );
  return lines.join("\n");
}

export type ReelSceneEntry = { sceneName: string; prompt: string };

/** Runs a whole-story-reel continuity check via the local Ollama model — see
 * buildReelContinuitySystemPrompt. Silent-empty (not an error) under the same conditions as
 * checkContinuity: no Ollama configured, no established context, or fewer than two scenes with a
 * real prompt to actually compare against each other. */
export async function checkReelContinuity(
  ollamaGenerate: (serverUrl: string, model: string, system: string, prompt: string) => Promise<string>,
  ollamaSettings: { serverUrl: string; model: string },
  scenes: ReelSceneEntry[],
  characters: Character[],
  worldBible: WorldBible | undefined,
): Promise<ContinuityIssue[]> {
  const withPrompts = scenes.filter((scene) => scene.prompt.trim());
  if (!ollamaSettings.model || withPrompts.length < 2) return [];
  const hasContext = characters.some((character) => character.styleSheet.trim());
  if (!hasContext) return [];

  const system = buildReelContinuitySystemPrompt(characters, worldBible);
  const userPrompt = withPrompts.map((scene, index) => `${index + 1}. "${scene.sceneName}": ${scene.prompt.trim()}`).join("\n");
  const raw = await ollamaGenerate(ollamaSettings.serverUrl, ollamaSettings.model, system, userPrompt);
  return parseContinuityIssues(raw).map((issue) => ({ ...issue, suggestedAddition: "" }));
}

/** Builds the system prompt for the World Bible ↔ Cast & Props consistency check — the one place
 * this app has TWO descriptions of "who's in this world" that don't otherwise know about each
 * other: the World Bible's free-text "Characters" field (prose, predates Cast & Props, still
 * useful for background/extras) and each Cast & Props entity's own structured style sheet. Nothing
 * keeps them in sync automatically, so this specifically hunts for the same named character/prop/
 * vehicle/set being described differently in the two places — not for anything else. */
function buildWorldBibleConsistencySystemPrompt(entities: Character[]): string {
  const lines: string[] = [
    "You are a continuity checker for a creative tool called Cozyverse Studio. This project describes its cast in two separate places that don't automatically stay in sync: a free-text \"World Bible\" characters note, and a list of structured Cast & Props entities, each with its own style sheet. Your only job is to find places where the SAME named character, prop, vehicle, or set is described differently between the two — not to critique either one, not to flag someone who only appears in one place.",
    "Structured Cast & Props entities:",
  ];
  for (const entity of entities) lines.push(`- ${entity.name} (${ENTITY_KIND_LABELS[entityKind(entity)].toLowerCase()}): ${entity.styleSheet.trim()}`);
  lines.push(
    "For each real contradiction found between the World Bible text below and one of the entities above, output one line in this exact format:",
    "ISSUE: <name who it's about and the specific contradiction, one short sentence>",
    "If there are no real contradictions, output exactly: OK",
    "Do not flag someone mentioned in only one place — that's normal, not a contradiction. Only flag it when both sources actively describe the same named thing differently. Output nothing else — no preamble, no explanation.",
  );
  return lines.join("\n");
}

/** Runs the World Bible ↔ Cast & Props consistency check via the local Ollama model — see
 * buildWorldBibleConsistencySystemPrompt. Silent-empty under the same conditions as the other
 * checks here: no Ollama configured, no free-text notes to compare, or no Cast & Props entities
 * with a style sheet yet to compare against. */
export async function checkWorldBibleConsistency(
  ollamaGenerate: (serverUrl: string, model: string, system: string, prompt: string) => Promise<string>,
  ollamaSettings: { serverUrl: string; model: string },
  characterNotes: string,
  entities: Character[],
): Promise<ContinuityIssue[]> {
  const sheets = entities.filter((entity) => entity.styleSheet.trim());
  if (!ollamaSettings.model || !characterNotes.trim() || sheets.length === 0) return [];

  const system = buildWorldBibleConsistencySystemPrompt(sheets);
  const raw = await ollamaGenerate(ollamaSettings.serverUrl, ollamaSettings.model, system, characterNotes.trim());
  return parseContinuityIssues(raw).map((issue) => ({ ...issue, suggestedAddition: "" }));
}

/** Runs a continuity check via the local Ollama model. Returns an empty array (not an error) when
 * Ollama isn't configured or unreachable — this is a soft, best-effort assist, never a blocker on
 * generation, so callers should treat a thrown error the same as "nothing to flag" and stay silent
 * rather than interrupting the user's flow with infrastructure noise. */
export async function checkContinuity(
  ollamaGenerate: (serverUrl: string, model: string, system: string, prompt: string) => Promise<string>,
  ollamaSettings: { serverUrl: string; model: string },
  prompt: string,
  characters: Character[],
  worldBible: WorldBible | undefined,
): Promise<ContinuityIssue[]> {
  if (!ollamaSettings.model || !prompt.trim()) return [];
  const hasContext = characters.some((character) => character.styleSheet.trim()) || Boolean(worldBible?.thingsToAvoid);
  if (!hasContext) return [];

  const system = buildContinuitySystemPrompt(characters, worldBible);
  const raw = await ollamaGenerate(ollamaSettings.serverUrl, ollamaSettings.model, system, prompt.trim());
  return parseContinuityIssues(raw);
}
