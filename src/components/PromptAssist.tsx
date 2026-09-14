import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import * as api from "../lib/api";
import { buildAssistSystemPrompt, parseAssistVariants, type PromptAssistKind } from "../lib/promptAssist";
import type { RegisteredModel } from "../lib/providers/modelRegistry";
import type { StyleStackControls } from "../lib/styleStack";
import type { Character, Scene, WorldBible } from "../types";

/** A small "✨ Assist" trigger + popover panel: the user describes a loose concept, a local Ollama
 * model (configured in Settings) writes a few prompt drafts grounded in the project's World Bible,
 * the active scene's environment, and the currently-selected diorama/Style Stack, and the user
 * either uses one as-is or edits it further — this only ever fills the caller's prompt field, never
 * submits a generation itself. */
export function PromptAssist({
  kind,
  worldBible,
  scene,
  model,
  shotCharacters,
  styleStack,
  onUse,
}: {
  kind: PromptAssistKind;
  worldBible?: WorldBible;
  scene?: Scene;
  model?: RegisteredModel;
  shotCharacters?: Character[];
  styleStack?: StyleStackControls;
  onUse: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<string[]>([]);

  const generate = async () => {
    if (!idea.trim()) return;
    setLoading(true);
    setError(null);
    setVariants([]);
    try {
      const settings = await api.ollamaGetSettings();
      if (!settings.model) {
        setError("No Ollama model is set up yet — add one in Settings → Prompt Assistant.");
        return;
      }
      const system = buildAssistSystemPrompt(kind, worldBible, scene, model, shotCharacters, styleStack);
      const raw = await api.ollamaGenerate(settings.serverUrl, settings.model, system, idea.trim());
      const parsed = parseAssistVariants(raw);
      if (parsed.length === 0) {
        setError("Ollama responded, but no usable prompt drafts could be parsed out of it. Try rephrasing your idea.");
        return;
      }
      setVariants(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const use = (variant: string) => {
    onUse(variant);
    setOpen(false);
    setIdea("");
    setVariants([]);
    setError(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-base-600 text-slate-400 hover:text-accent-400 hover:border-accent-500 transition shrink-0"
        title="Describe your idea and get prompt drafts"
      >
        <Sparkles size={11} /> Assist
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-accent-500/40 bg-base-900 p-3 mt-2 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-white flex items-center gap-1.5">
          <Sparkles size={12} className="text-accent-400" /> Prompt Assist
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setVariants([]);
          }}
          className="text-slate-500 hover:text-white"
        >
          <X size={13} />
        </button>
      </div>

      <textarea
        value={idea}
        onChange={(event) => setIdea(event.target.value)}
        placeholder="Describe your idea in plain language — e.g. 'the old lighthouse keeper checking his lamp on a stormy night'"
        rows={2}
        className="w-full bg-base-800 border border-base-600 rounded-md px-2.5 py-2 text-xs text-white outline-none focus:border-accent-500 resize-none"
      />

      <button
        type="button"
        disabled={!idea.trim() || loading}
        onClick={() => void generate()}
        className="flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText font-medium transition"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {loading ? "Thinking…" : "Generate drafts"}
      </button>

      {error && <p className="text-[11px] text-yellow-500">{error}</p>}

      {variants.length > 0 && (
        <div className="space-y-2 pt-1">
          {variants.map((variant, index) => (
            <div key={index} className="rounded-md border border-base-700 bg-base-800 p-2.5">
              <p className="text-xs text-slate-300 leading-relaxed">{variant}</p>
              <button
                type="button"
                onClick={() => use(variant)}
                className="mt-2 text-[11px] px-2.5 py-1 rounded-md bg-accent-500 hover:bg-accent-400 text-accentText font-medium transition"
              >
                Use this
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
