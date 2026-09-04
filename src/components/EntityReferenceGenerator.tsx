import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RotateCw, Sparkles, UploadCloud } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { connectedModelsFor, connectedProviders } from "../lib/providers/realGeneration";
import { activeStackCount, defaultStyleStack, STYLE_STACK_AXES, type StyleStackControls } from "../lib/styleStack";
import type { RegisteredModel } from "../lib/providers/modelRegistry";
import type { EntityKind } from "../types";

const KIND_HINT: Record<EntityKind, string> = {
  character: "front-facing reference sheet, neutral pose, plain neutral background, even lighting, full body visible",
  prop: "clean product-style reference shot, plain neutral background, even lighting, the whole object visible",
  vehicle: "three-quarter view reference shot, plain neutral background, even lighting, the whole vehicle visible",
  set: "wide establishing view, even lighting, the whole space visible",
};

/** The angles a turnaround generates, in order — the same front/back/left/right coverage a real
 * production model sheet uses, and deliberately the same shape as the multi-angle image sets an
 * image-to-3D reconstruction pipeline wants later (front/back/left/right/perspective), so this
 * doubles as prep work for that goal without having to guess at it now. Each angle's instruction is
 * appended to whatever the user already typed, with an explicit "identical subject" reminder since
 * nothing here guarantees cross-call consistency on its own — the model only has the text prompt to
 * go on for each separate call. */
const TURNAROUND_ANGLES: { label: string; instruction: string }[] = [
  { label: "Front", instruction: "front view, facing directly toward camera" },
  { label: "Back", instruction: "back view, facing directly away from camera" },
  { label: "Left", instruction: "left side profile view" },
  { label: "Right", instruction: "right side profile view" },
];

/** Lets a Cast & Props entry design its own reference image directly — a prompt, a choice of image
 * model, real or mock rendering — instead of requiring a detour through Image Studio and back. Also
 * offers importing an existing image file from disk. Either path ends the same way: the resulting
 * asset is handed to onAdded, which the caller (Characters.tsx) attaches as a reference exactly like
 * a manually picked one — this component never touches the entity's reference list itself. */
export function EntityReferenceGenerator({ kind, styleSheet, onAdded }: { kind: EntityKind; styleSheet: string; onAdded: (assetId: string) => void }) {
  const project = useAppStore((state) => state.project);
  const generateImage = useAppStore((state) => state.generateImage);
  const importImage = useAppStore((state) => state.importImage);

  const [prompt, setPrompt] = useState("");
  const [useReal, setUseReal] = useState(false);
  const [hasConnectedProvider, setHasConnectedProvider] = useState(false);
  const [models, setModels] = useState<RegisteredModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState<"generate" | "import" | "turnaround" | null>(null);
  const [turnaroundProgress, setTurnaroundProgress] = useState<{ step: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [styleStack, setStyleStack] = useState<StyleStackControls>(defaultStyleStack());
  const [styleOpen, setStyleOpen] = useState(false);
  const [styleSeeded, setStyleSeeded] = useState(false);

  useEffect(() => {
    void connectedProviders().then((set) => setHasConnectedProvider(set.size > 0));
    void connectedModelsFor("image").then(setModels);
  }, []);

  // Inherit the project's own established visual style by default, so a character/prop/vehicle/set
  // reference doesn't come out looking like a different project — Image Studio's own generations
  // already record their Style Stack selections on each job (buildImageIntent's settings.styleStack),
  // so the most recent one IS the project's current look, not a guess. Still fully editable below;
  // only seeds once per mount so it never fights the user's own picks mid-session.
  useEffect(() => {
    if (styleSeeded) return;
    const generations = useAppStore.getState().project?.generations ?? [];
    const lastStyled = generations.find(
      (job) => job.type === "image" && (job.settings as { styleStack?: StyleStackControls })?.styleStack?.artStyle,
    );
    const inherited = (lastStyled?.settings as { styleStack?: StyleStackControls } | undefined)?.styleStack;
    if (inherited) {
      // Merge over a fresh default rather than using the stored object directly — an older saved
      // generation can predate a Style Stack axis that's since been added (confirmed live: an old
      // record missing customStyleDescription crashed activeStackCount's .trim() call on undefined).
      // The default's "" for every axis is a safe fallback for anything the old record doesn't have.
      setStyleStack({ ...defaultStyleStack(), ...inherited });
      setStyleOpen(true);
    }
    setStyleSeeded(true);
  }, [styleSeeded]);

  const patchStyleStack = (patch: Partial<StyleStackControls>) => setStyleStack((current) => ({ ...current, ...patch }));

  // Keeps the prompt live-mirrored to the style sheet + a kind-appropriate framing hint as long as
  // the user hasn't typed anything of their own into the prompt field yet — NOT a one-time seed.
  // A one-time "if prompt is empty, seed it" effect fires on every keystroke of styleSheet (it's a
  // live-typed prop from the parent, not a value that arrives whole), so it would seed from
  // whatever partial text existed after the very first character and then lock in — confirmed live:
  // a style sheet of "a black mid 30s woman in silvery sci-fi set" produced a prompt starting "a,"
  // because the effect fired and got "stuck" the moment a single "a" existed. Tracking the last
  // auto-derived value and only overwriting when the current prompt still equals it (or is empty)
  // means the prompt stays in sync while styleSheet is being typed, and stops syncing the instant
  // the user edits the prompt field directly instead.
  const autoPromptRef = useRef("");
  useEffect(() => {
    const derived = styleSheet.trim() ? `${styleSheet.trim()}, ${KIND_HINT[kind]}` : "";
    if (prompt === "" || prompt === autoPromptRef.current) setPrompt(derived);
    autoPromptRef.current = derived;
  }, [styleSheet, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One generation call, resolved down to "did a new image asset land." Shared by the single
   * Generate button and the Turnaround loop below so both stay byte-for-byte consistent with
   * exactly what Image Studio's own generation call shape looks like. */
  const generateOne = async (promptText: string): Promise<boolean> => {
    const ok = await generateImage(
      {
        weather: "Clear",
        timeOfDay: "Day",
        lighting: "Natural",
        season: "Any",
        mood: "",
        customInstruction: "",
        variantStrength: 0.6,
        aspectRatio: "1:1",
        styleStack,
        rawPromptOverride: promptText,
      },
      undefined,
      useReal,
      modelId || undefined,
    );
    if (!ok) return false;
    const assets = useAppStore.getState().project?.assets ?? [];
    const newest = [...assets].reverse().find((asset) => asset.type === "image");
    if (newest) onAdded(newest.id);
    return Boolean(newest);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setBusy("generate");
    setError(null);
    try {
      await generateOne(prompt.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  /** Fires one generation per turnaround angle, sequentially (not in parallel) — each call reads
   * the "newest image asset" off the end of project.assets right after it resolves, so overlapping
   * calls could race and grab the wrong one; sequencing avoids that entirely at the cost of some
   * wall-clock time, which is the right trade for a background reference-building action. Keeps
   * going even if one angle fails, rather than aborting the whole set over a single bad call. */
  const handleTurnaround = async () => {
    if (!prompt.trim()) return;
    setBusy("turnaround");
    setError(null);
    const base = prompt.trim();
    let failures = 0;
    try {
      for (const [index, angle] of TURNAROUND_ANGLES.entries()) {
        setTurnaroundProgress({ step: index + 1, total: TURNAROUND_ANGLES.length });
        try {
          const ok = await generateOne(`${base}, ${angle.instruction}, identical subject and design as the other turnaround views`);
          if (!ok) failures += 1;
        } catch {
          failures += 1;
        }
      }
      if (failures === TURNAROUND_ANGLES.length) setError("Turnaround generation failed for every angle.");
      else if (failures > 0) setError(`${failures} of ${TURNAROUND_ANGLES.length} turnaround angles failed — the rest were added.`);
    } finally {
      setBusy(null);
      setTurnaroundProgress(null);
    }
  };

  const handleImport = async () => {
    setBusy("import");
    setError(null);
    try {
      await importImage("image");
      const assets = useAppStore.getState().project?.assets ?? [];
      const newest = [...assets].reverse().find((asset) => asset.type === "image");
      if (newest) onAdded(newest.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!project) return null;

  return (
    <div className="rounded-md border border-base-700 bg-base-950/40 p-2.5 space-y-2">
      <textarea
        rows={2}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Describe the reference image to generate — starts from the style sheet above, edit as needed."
        className="w-full bg-base-800 border border-base-600 rounded-md px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-accent-500 resize-none"
      />

      <div className="rounded-md border border-base-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setStyleOpen((open) => !open)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 hover:text-white transition"
        >
          <span className="flex items-center gap-1.5 normal-case tracking-normal">
            Match project style
            {activeStackCount(styleStack) > 0 && (
              <span className="bg-accent-500 text-accentText text-[10px] px-1.5 py-0.5 rounded-full">{activeStackCount(styleStack)}</span>
            )}
          </span>
          <ChevronDown size={12} className={`transition-transform ${styleOpen ? "rotate-180" : ""}`} />
        </button>
        {styleOpen && (
          <div className="px-2.5 pb-2.5 grid grid-cols-2 gap-1.5 border-t border-base-700 pt-2">
            {STYLE_STACK_AXES.map(({ key, label, presets }) => (
              <div key={key}>
                <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
                <select
                  value={styleStack[key]}
                  onChange={(event) => patchStyleStack({ [key]: event.target.value } as Partial<StyleStackControls>)}
                  className="w-full bg-base-800 border border-base-600 rounded-md px-1.5 py-1 text-[11px] text-white outline-none focus:border-accent-500"
                >
                  {presets.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {models.length > 0 && (
          <select
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            className="bg-base-800 border border-base-600 rounded-md px-2 py-1 text-[11px] text-white outline-none focus:border-accent-500"
          >
            <option value="">Auto (best match)</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex rounded-md border border-base-600 overflow-hidden">
          <button
            type="button"
            onClick={() => setUseReal(false)}
            className={`px-2 py-1 text-[11px] ${!useReal ? "bg-accent-500 text-accentText" : "text-slate-400"}`}
          >
            Mock
          </button>
          <button
            type="button"
            onClick={() => setUseReal(true)}
            disabled={!hasConnectedProvider}
            title={hasConnectedProvider ? undefined : "Add an API key in Settings first"}
            className={`px-2 py-1 text-[11px] ${useReal ? "bg-accent-500 text-accentText" : "text-slate-400"} ${!hasConnectedProvider ? "opacity-50" : ""}`}
          >
            Auto
          </button>
        </div>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={!prompt.trim() || busy !== null}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-accentText font-medium transition ml-auto"
        >
          {busy === "generate" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Generate
        </button>
        <button
          type="button"
          onClick={() => void handleTurnaround()}
          disabled={!prompt.trim() || busy !== null}
          title="Generate front, back, left, and right reference views in one go"
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-accent-500/50 text-accent-400 hover:bg-accent-500/10 disabled:opacity-50 transition"
        >
          {busy === "turnaround" ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
          {busy === "turnaround" && turnaroundProgress ? `Turnaround ${turnaroundProgress.step}/${turnaroundProgress.total}…` : "Turnaround"}
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={busy !== null}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 disabled:opacity-50 transition"
        >
          {busy === "import" ? <Loader2 size={11} className="animate-spin" /> : <UploadCloud size={11} />} Import File…
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
