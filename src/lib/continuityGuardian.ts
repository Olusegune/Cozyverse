import type { Character, WorldBible } from "../types";

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
    lines.push("Established characters (their appearance/traits must stay consistent whenever they appear in a prompt):");
    for (const character of sheets) lines.push(`- ${character.name}: ${character.styleSheet.trim()}`);
  }
  if (worldBible?.thingsToAvoid) lines.push(`Things this world must always avoid: ${worldBible.thingsToAvoid}.`);
  if (worldBible?.characters) lines.push(`World Bible's general character notes: ${worldBible.characters}.`);

  lines.push(
    "Compare the prompt against ONLY the facts above. For each real contradiction or clearly missing established detail (e.g. a named character appears but a defining trait from their style sheet is absent), output one line in this exact format:",
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
