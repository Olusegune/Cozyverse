import { useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import * as api from "../lib/api";
import { checkReelContinuity, type ContinuityIssue, type ReelSceneEntry } from "../lib/continuityGuardian";
import type { Character, WorldBible } from "../types";

/** A "Check Story Reel Continuity" button for Storyboard — the whole-reel counterpart to
 * ContinuityCheck's per-shot version. Compares every scene's own generation prompt against every
 * other scene's, catching contradictions a per-shot check structurally can't see (each shot looks
 * fine in isolation; the problem only exists across the sequence). Report-only — there's no single
 * prompt field to patch across multiple scenes, so issues are informational, not one-click-fixable. */
export function ReelContinuityCheck({ scenes, characters, worldBible }: { scenes: ReelSceneEntry[]; characters: Character[]; worldBible?: WorldBible }) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [issues, setIssues] = useState<ContinuityIssue[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const run = async () => {
    setChecking(true);
    setChecked(false);
    setUnavailable(null);
    try {
      const settings = await api.ollamaGetSettings();
      if (!settings.model) {
        setUnavailable("Ollama not set up — configure it in Settings to use this.");
        return;
      }
      if (scenes.filter((scene) => scene.prompt.trim()).length < 2) {
        setUnavailable("Needs at least two rendered/generated scenes with a resolved background to compare.");
        return;
      }
      const found = await checkReelContinuity(api.ollamaGenerate, settings, scenes, characters, worldBible);
      setIssues(found);
      setChecked(true);
    } catch {
      setUnavailable("Couldn't reach Ollama — best-effort check, nothing blocked.");
    } finally {
      setChecking(false);
    }
  };

  const hasContext = characters.some((character) => character.styleSheet.trim());
  if (!hasContext) return null;

  return (
    <div className="rounded-xl border border-base-700 bg-base-900 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">Story Reel Continuity</h3>
          <p className="text-xs text-slate-500 mt-0.5">Checks every scene's prompt against every other scene's, for cast/prop contradictions a single shot can't reveal.</p>
        </div>
        <button
          onClick={() => void run()}
          disabled={checking}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 disabled:opacity-50 transition shrink-0"
        >
          {checking ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Check Reel
        </button>
      </div>

      {unavailable && <p className="text-[11px] text-slate-500 mt-2">{unavailable}</p>}

      {checked && issues.length === 0 && (
        <p className="text-[11px] text-green-400/80 mt-2 flex items-center gap-1">
          <ShieldCheck size={11} /> No cross-scene contradictions found.
        </p>
      )}

      {issues.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {issues.map((issue, index) => (
            <p key={index} className="text-[11px] text-yellow-500 flex items-start gap-1.5 rounded-md border border-yellow-600/40 bg-yellow-500/5 p-2">
              <ShieldAlert size={12} className="shrink-0 mt-0.5" /> {issue.note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
