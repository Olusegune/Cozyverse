import { useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import * as api from "../lib/api";
import { checkWorldBibleConsistency, type ContinuityIssue } from "../lib/continuityGuardian";
import { useAppStore } from "../store/useAppStore";
import { projectCharacters } from "../types";

/** Checks the World Bible's free-text "Characters" note against Cast & Props' structured style
 * sheets for the one class of drift nothing else in the app catches: the same named character,
 * prop, vehicle, or set described differently in the two places, since neither has any visibility
 * into the other. Report-only, like the reel-wide check — a contradiction between two whole-project
 * fields isn't something to auto-patch. */
export function WorldBibleConsistencyCheck({ characterNotes }: { characterNotes: string }) {
  const project = useAppStore((state) => state.project);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [issues, setIssues] = useState<ContinuityIssue[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const entities = project ? projectCharacters(project) : [];
  if (!entities.some((entity) => entity.styleSheet.trim())) return null;

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
      const found = await checkWorldBibleConsistency(api.ollamaGenerate, settings, characterNotes, entities);
      setIssues(found);
      setChecked(true);
    } catch {
      setUnavailable("Couldn't reach Ollama — best-effort check, nothing blocked.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={checking}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-base-600 text-slate-400 hover:text-accent-400 hover:border-accent-500 transition disabled:opacity-40"
        title="Compare this text against Cast & Props' structured style sheets for the same named character"
      >
        {checking ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Check vs. Cast &amp; Props
      </button>

      {unavailable && <p className="text-[11px] text-slate-500 mt-1.5">{unavailable}</p>}

      {checked && issues.length === 0 && (
        <p className="text-[11px] text-green-400/80 mt-1.5 flex items-center gap-1">
          <ShieldCheck size={11} /> No contradictions with Cast &amp; Props found.
        </p>
      )}

      {issues.length > 0 && (
        <div className="space-y-1.5 mt-1.5">
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
