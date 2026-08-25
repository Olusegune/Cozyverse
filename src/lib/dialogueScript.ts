export type DialogueLine = { speaker: string; gender?: "male" | "female"; descriptor?: string; text: string };

// The parenthetical can be just "Female" or a richer descriptor like "Male, British accent" — gender
// is pulled out of it separately rather than requiring an exact match, so extra detail doesn't break
// speaker splitting.
const LINE_PATTERN = /^\s*([^():]+?)\s*\(([^)]+)\)\s*:\s*"?([^"]*?)"?\s*$/;

function detectGender(descriptor: string): "male" | "female" | undefined {
  if (/\bfemale\b/i.test(descriptor)) return "female";
  if (/\bmale\b/i.test(descriptor)) return "male";
  return undefined;
}

/**
 * Splits a dialogue script into per-speaker lines when it follows the "Speaker (descriptor): "text""
 * convention — the descriptor just needs to contain "male"/"female" somewhere in it, so accents, ages,
 * etc. can ride along too. Returns a single unlabeled line (the whole input) when no line matches that
 * pattern, so plain single-voice input still works exactly as before.
 */
export function parseDialogueScript(text: string): DialogueLine[] {
  const rawLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed: DialogueLine[] = [];
  for (const line of rawLines) {
    const match = LINE_PATTERN.exec(line);
    if (!match) return [{ speaker: "", text: text.trim() }];
    const [, speaker, descriptor, spoken] = match;
    if (!spoken.trim()) continue;
    parsed.push({ speaker: speaker.trim(), gender: detectGender(descriptor), descriptor: descriptor.trim(), text: spoken.trim() });
  }
  return parsed.length ? parsed : [{ speaker: "", text: text.trim() }];
}

const FEMALE_VOICES = ["Calm_Woman", "Wise_Woman", "Lively_Girl"];
const MALE_VOICES = ["Deep_Voice_Man", "Casual_Guy", "Friendly_Person"];

/** Assigns a stable, distinct voice_id per unique speaker label, cycling within the matching gender pool. */
export function assignVoices(lines: DialogueLine[]): Map<string, string> {
  const assignment = new Map<string, string>();
  let femaleIndex = 0;
  let maleIndex = 0;
  for (const line of lines) {
    const key = line.speaker.toLowerCase();
    if (assignment.has(key)) continue;
    if (line.gender === "male") {
      assignment.set(key, MALE_VOICES[maleIndex % MALE_VOICES.length]);
      maleIndex += 1;
    } else if (line.gender === "female") {
      assignment.set(key, FEMALE_VOICES[femaleIndex % FEMALE_VOICES.length]);
      femaleIndex += 1;
    } else {
      assignment.set(key, "Calm_Woman");
    }
  }
  return assignment;
}
