import { useEffect, useState } from "react";
import { Loader2, Sparkles, UploadCloud } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { connectedModelsFor, connectedProviders } from "../lib/providers/realGeneration";
import { defaultStyleStack } from "../lib/styleStack";
import type { RegisteredModel } from "../lib/providers/modelRegistry";
import type { EntityKind } from "../types";

const KIND_HINT: Record<EntityKind, string> = {
  character: "front-facing reference sheet, neutral pose, plain neutral background, even lighting, full body visible",
  prop: "clean product-style reference shot, plain neutral background, even lighting, the whole object visible",
  vehicle: "three-quarter view reference shot, plain neutral background, even lighting, the whole vehicle visible",
  set: "wide establishing view, even lighting, the whole space visible",
};

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
  const [busy, setBusy] = useState<"generate" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void connectedProviders().then((set) => setHasConnectedProvider(set.size > 0));
    void connectedModelsFor("image").then(setModels);
  }, []);

  // Pre-fill with the style sheet + a kind-appropriate framing hint the first time there's
  // something to seed from, but never overwrite text the user has already started editing.
  useEffect(() => {
    if (prompt.trim()) return;
    if (styleSheet.trim()) setPrompt(`${styleSheet.trim()}, ${KIND_HINT[kind]}`);
  }, [styleSheet, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setBusy("generate");
    setError(null);
    try {
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
          styleStack: defaultStyleStack(),
          rawPromptOverride: prompt.trim(),
        },
        undefined,
        useReal,
        modelId || undefined,
      );
      if (ok) {
        const assets = useAppStore.getState().project?.assets ?? [];
        const newest = [...assets].reverse().find((asset) => asset.type === "image");
        if (newest) onAdded(newest.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
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
