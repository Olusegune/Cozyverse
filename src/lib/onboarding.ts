// One-time, dismiss-forever notes shown the first time someone reaches a
// meaningful moment (e.g. their first Generate click). Said once, trust
// earned, then gone — not a recurring nag.

const SEEN_GENERATE_NOTE_KEY = "cozyverse-seen-generate-note";

export function hasSeenGenerateNote(): boolean {
  try {
    return localStorage.getItem(SEEN_GENERATE_NOTE_KEY) === "1";
  } catch {
    return true; // fail closed — never show a note we can't remember dismissing
  }
}

export function markSeenGenerateNote() {
  try {
    localStorage.setItem(SEEN_GENERATE_NOTE_KEY, "1");
  } catch {
    /* private-browsing / storage disabled — it'll just show again next time */
  }
}
