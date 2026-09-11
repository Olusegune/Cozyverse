import { useEffect, useState } from "react";
import { FileText, Loader2, Sparkles, Wand2, X } from "lucide-react";
import type { WorldBible } from "../types";
import { useAppStore } from "../store/useAppStore";
import { connectedProviders } from "../lib/providers/realGeneration";
import * as api from "../lib/api";
import { buildDraftPrompt, buildExtractionPrompt, parseExtractedWorldBible } from "../lib/worldBibleImport";

const FIELDS: Array<{ key: keyof WorldBible; label: string; multiline?: boolean }> = [
  { key: "name", label: "Name" },
  { key: "shortConcept", label: "Short Concept" },
  { key: "description", label: "Description", multiline: true },
  { key: "mood", label: "Mood" },
  { key: "artStyle", label: "Art Style" },
  { key: "locationEnvironment", label: "Location / Environment" },
  { key: "architecture", label: "Architecture" },
  { key: "importantObjects", label: "Important Objects", multiline: true },
  { key: "characters", label: "Characters", multiline: true },
  { key: "cameraComposition", label: "Camera / Composition" },
  { key: "lighting", label: "Lighting" },
  { key: "weather", label: "Weather" },
  { key: "timeOfDay", label: "Time of Day" },
  { key: "thingsToAvoid", label: "Things to Avoid", multiline: true },
  { key: "additionalNotes", label: "Additional Creative Notes", multiline: true },
];

const FIELD_LABELS: Partial<Record<keyof WorldBible, string>> = Object.fromEntries(FIELDS.map(({ key, label }) => [key, label]));

export function WorldBiblePage() {
  const project = useAppStore((state) => state.project);
  const saveStatus = useAppStore((state) => state.saveStatus);
  const updateWorldBible = useAppStore((state) => state.updateWorldBible);

  const [hasGemini, setHasGemini] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);

  useEffect(() => {
    void connectedProviders().then((set) => setHasGemini(set.has("gemini")));
  }, []);

  if (!project) return null;
  const bible = project.worldBible;
  const isBlank = !bible.shortConcept?.trim() && !bible.description?.trim();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">World Bible</h1>
          <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
          <p className="text-sm text-slate-400 mt-1">Define your Cozyverse's identity. This drives consistent results across all media.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={!hasGemini}
            title={hasGemini ? undefined : "Add a Gemini API key in Settings to draft or import"}
            onClick={() => setDraftOpen(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 text-accentText disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wand2 size={13} /> Draft with AI
          </button>
          <button
            disabled={!hasGemini}
            title={hasGemini ? undefined : "Add a Gemini API key in Settings to import from text"}
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileText size={13} /> Import from Text
          </button>
          <span className="text-xs text-slate-500">
            {saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : "Saved"}
          </span>
        </div>
      </div>

      {isBlank && hasGemini && (
        <button
          onClick={() => setDraftOpen(true)}
          className="mb-6 w-full flex items-center gap-4 rounded-xl border border-dashed border-accent-500/40 bg-accent-500/5 hover:bg-accent-500/10 hover:border-accent-500/70 p-5 text-left transition"
        >
          <span className="flex items-center justify-center w-11 h-11 rounded-full bg-accent-500/15 shrink-0">
            <Sparkles size={20} className="text-accent-400" />
          </span>
          <span>
            <span className="block text-sm font-medium text-white">Describe your world in one line — I'll draft the rest</span>
            <span className="block text-xs text-slate-400 mt-0.5">
              "A rainy Tokyo noodle shop at midnight" is enough. Every field below is yours to edit after.
            </span>
          </span>
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {FIELDS.map(({ key, label, multiline }) => (
          <div key={key} className={multiline ? "sm:col-span-2" : ""}>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">{label}</label>
            {multiline ? (
              <textarea
                rows={3}
                value={(bible[key] as string) || ""}
                onChange={(event) => updateWorldBible({ [key]: event.target.value } as Partial<WorldBible>)}
                className="w-full bg-base-900 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
              />
            ) : (
              <input
                value={(bible[key] as string) || ""}
                onChange={(event) => updateWorldBible({ [key]: event.target.value } as Partial<WorldBible>)}
                className="w-full bg-base-900 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
              />
            )}
          </div>
        ))}

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Color Palette</label>
          <div className="flex items-center gap-2 flex-wrap">
            {bible.colorPalette.map((color, index) => (
              <input
                key={index}
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8b7bf6"}
                onChange={(event) => {
                  const next = [...bible.colorPalette];
                  next[index] = event.target.value;
                  updateWorldBible({ colorPalette: next });
                }}
                className="w-9 h-9 rounded border border-base-600 bg-transparent cursor-pointer"
              />
            ))}
            <button
              className="w-9 h-9 rounded border border-dashed border-base-600 text-slate-500 hover:text-accent-400 hover:border-accent-500"
              onClick={() => updateWorldBible({ colorPalette: [...bible.colorPalette, "#8b7bf6"] })}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {importOpen && (
        <ImportFromTextModal
          bible={bible}
          onClose={() => setImportOpen(false)}
          onApply={(patch) => {
            updateWorldBible(patch);
            setImportOpen(false);
          }}
        />
      )}
      {draftOpen && (
        <DraftWorldModal
          bible={bible}
          onClose={() => setDraftOpen(false)}
          onApply={(patch) => {
            updateWorldBible(patch);
            setDraftOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** The golden-path entry point: turn one sentence into a full, editable World
 * Bible. Same extraction/review machinery as ImportFromTextModal, but the
 * model is explicitly asked to invent rich detail rather than only pull out
 * what's already stated. */
function DraftWorldModal({ bible, onClose, onApply }: { bible: WorldBible; onClose: () => void; onApply: (patch: Partial<WorldBible>) => void }) {
  const [step, setStep] = useState<"prompt" | "review">("prompt");
  const [oneLiner, setOneLiner] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Partial<WorldBible>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const draft = async () => {
    if (!oneLiner.trim()) return;
    setDrafting(true);
    setError(null);
    try {
      const raw = await api.geminiGenerateText(buildDraftPrompt(oneLiner, bible.name));
      const extracted = parseExtractedWorldBible(raw);
      setProposed(extracted);
      setSelected(new Set(Object.keys(extracted)));
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  };

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apply = () => {
    const patch: Partial<WorldBible> = {};
    for (const key of Object.keys(proposed) as Array<keyof WorldBible>) {
      if (selected.has(key)) (patch as Record<string, unknown>)[key] = proposed[key];
    }
    onApply(patch);
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-8" onClick={onClose}>
      <div className="bg-base-900 border border-base-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-700">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <Wand2 size={15} className="text-accent-400" /> Draft World Bible with AI
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {step === "prompt" ? (
          <div className="p-5 space-y-3 overflow-y-auto">
            <p className="text-xs text-slate-400">
              One sentence is enough — Gemini invents a full, cohesive world from it. Review and edit everything
              on the next step before anything is applied.
            </p>
            <input
              autoFocus
              value={oneLiner}
              onChange={(event) => setOneLiner(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void draft();
              }}
              placeholder="e.g. A rainy Tokyo noodle shop at midnight, retro-futuristic and warm"
              className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2.5 text-sm text-white outline-none focus:border-accent-500"
            />
            {error && <p className="text-xs text-red-400 whitespace-pre-wrap">{error}</p>}
            <button
              disabled={drafting || !oneLiner.trim()}
              onClick={() => void draft()}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
            >
              {drafting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} {drafting ? "Drafting…" : "Draft the World Bible"}
            </button>
          </div>
        ) : (
          <div className="p-5 overflow-y-auto space-y-3">
            <p className="text-xs text-slate-400 mb-2">Review each field before applying. Unchecked fields are left as-is.</p>
            {Object.keys(proposed).length === 0 && <p className="text-xs text-slate-500">Nothing came back — try a more specific line.</p>}
            {(Object.keys(proposed) as Array<keyof WorldBible>).map((key) => {
              const newValue = proposed[key];
              const displayNew = Array.isArray(newValue) ? newValue.join(", ") : String(newValue ?? "");
              return (
                <label key={key} className="flex items-start gap-3 rounded-lg border border-base-700 p-3 cursor-pointer">
                  <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-300 mb-1">{FIELD_LABELS[key] || key}</p>
                    <p className="text-xs text-white break-words">{displayNew || "(empty)"}</p>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {step === "review" && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-base-700">
            <button onClick={() => setStep("prompt")} className="text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white">
              Back
            </button>
            <button
              disabled={selected.size === 0}
              onClick={apply}
              className="text-xs px-4 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText"
            >
              Apply {selected.size} field{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportFromTextModal({ bible, onClose, onApply }: { bible: WorldBible; onClose: () => void; onApply: (patch: Partial<WorldBible>) => void }) {
  const [step, setStep] = useState<"paste" | "review">("paste");
  const [sourceText, setSourceText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Partial<WorldBible>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const extract = async () => {
    if (!sourceText.trim()) return;
    setExtracting(true);
    setError(null);
    try {
      const raw = await api.geminiGenerateText(buildExtractionPrompt(sourceText));
      const extracted = parseExtractedWorldBible(raw);
      setProposed(extracted);
      setSelected(new Set(Object.keys(extracted)));
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  };

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apply = () => {
    const patch: Partial<WorldBible> = {};
    for (const key of Object.keys(proposed) as Array<keyof WorldBible>) {
      if (selected.has(key)) (patch as Record<string, unknown>)[key] = proposed[key];
    }
    onApply(patch);
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-8" onClick={onClose}>
      <div className="bg-base-900 border border-base-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-700">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <Sparkles size={15} className="text-accent-400" /> Import World Bible from Text
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {step === "paste" ? (
          <div className="p-5 space-y-3 overflow-y-auto">
            <p className="text-xs text-slate-400">
              Paste a script outline, style notes, or any description of the world — Gemini will extract World Bible fields from it. Nothing is applied until you
              review and confirm on the next step.
            </p>
            <textarea
              autoFocus
              rows={12}
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Paste your document here…"
              className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
            />
            {error && <p className="text-xs text-red-400 whitespace-pre-wrap">{error}</p>}
            <button
              disabled={extracting || !sourceText.trim()}
              onClick={() => void extract()}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
            >
              {extracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {extracting ? "Extracting…" : "Extract Fields"}
            </button>
          </div>
        ) : (
          <div className="p-5 overflow-y-auto space-y-3">
            <p className="text-xs text-slate-400 mb-2">Review each field before applying. Unchecked fields are left as-is.</p>
            {Object.keys(proposed).length === 0 && <p className="text-xs text-slate-500">No fields were extracted.</p>}
            {(Object.keys(proposed) as Array<keyof WorldBible>).map((key) => {
              const newValue = proposed[key];
              const oldValue = bible[key];
              const displayNew = Array.isArray(newValue) ? newValue.join(", ") : String(newValue ?? "");
              const displayOld = Array.isArray(oldValue) ? oldValue.join(", ") : String(oldValue ?? "");
              const unchanged = displayNew === displayOld;
              return (
                <label key={key} className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${unchanged ? "border-base-800 opacity-50" : "border-base-700"}`}>
                  <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-300 mb-1">{FIELD_LABELS[key] || key}</p>
                    {displayOld && <p className="text-xs text-slate-500 line-through truncate">{displayOld}</p>}
                    <p className="text-xs text-white break-words">{displayNew || "(empty)"}</p>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {step === "review" && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-base-700">
            <button onClick={() => setStep("paste")} className="text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white">
              Back
            </button>
            <button
              disabled={selected.size === 0}
              onClick={apply}
              className="text-xs px-4 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText"
            >
              Apply {selected.size} field{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
