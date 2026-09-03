import { useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import * as api from "../lib/api";
import { checkContinuity, type ContinuityIssue } from "../lib/continuityGuardian";
import type { Character, WorldBible } from "../types";

/** A small "Check Continuity" button that compares the current prompt against the selected
 * characters' style sheets and the World Bible's "Things to Avoid" list, using the same local
 * Ollama model as Prompt Assist. Silent when Ollama isn't set up — this is a best-effort guardrail,
 * never a blocker. Only ever suggests appending text to the prompt; never edits it automatically. */
export function ContinuityCheck({
  prompt,
  characters,
  worldBible,
  onAppend,
}: {
  prompt: string;
  characters: Character[];
  worldBible?: WorldBible;
  onAppend: (addition: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [issues, setIssues] = useState<ContinuityIssue[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  const run = async () => {
    setChecking(true);
    setChecked(false);
    setUnavailable(false);
    try {
      const settings = await api.ollamaGetSettings();
      if (!settings.model) {
        setUnavailable(true);
        return;
      }
      const found = await checkContinuity(api.ollamaGenerate, settings, prompt, characters, worldBible);
      setIssues(found);
      setChecked(true);
    } catch {
      // Best-effort — Ollama being unreachable shouldn't block or alarm the user mid-flow.
      setUnavailable(true);
    } finally {
      setChecking(false);
    }
  };

  const dismiss = (index: number) => {
    setIssues((current) => current.filter((_, existingIndex) => existingIndex !== index));
  };

  const hasContext = characters.some((character) => character.styleSheet.trim()) || Boolean(worldBible?.thingsToAvoid);
  if (!hasContext) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={!prompt.trim() || checking}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-base-600 text-slate-400 hover:text-accent-400 hover:border-accent-500 transition shrink-0 disabled:opacity-40"
        title="Compare this prompt against established characters and Things to Avoid"
      >
        {checking ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Check Continuity
      </button>

      {unavailable && <p className="text-[11px] text-slate-500 mt-1.5">Ollama not set up — configure it in Settings to use this.</p>}

      {checked && issues.length === 0 && (
        <p className="text-[11px] text-green-400/80 mt-1.5 flex items-center gap-1">
          <ShieldCheck size={11} /> No contradictions found.
        </p>
      )}

      {issues.length > 0 && (
        <div className="space-y-1.5 mt-1.5">
          {issues.map((issue, index) => (
            <div key={index} className="rounded-md border border-yellow-600/40 bg-yellow-500/5 p-2">
              <p className="text-[11px] text-yellow-500 flex items-start gap-1.5">
                <ShieldAlert size={12} className="shrink-0 mt-0.5" /> {issue.note}
              </p>
              <div className="flex items-center gap-2 mt-1.5 pl-4">
                {issue.suggestedAddition && (
                  <button
                    type="button"
                    onClick={() => {
                      onAppend(issue.suggestedAddition);
                      dismiss(index);
                    }}
                    className="text-[11px] px-2 py-1 rounded-md bg-accent-500 hover:bg-accent-400 text-accentText font-medium transition"
                  >
                    Add "{issue.suggestedAddition}"
                  </button>
                )}
                <button type="button" onClick={() => dismiss(index)} className="text-[11px] text-slate-500 hover:text-white">
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
