import { useEffect, useMemo, useState } from "react";
import { Boxes, ChevronDown, Download, Expand, Heart, ImagePlus, Loader2, Sparkles, Star, Trash2, Wand2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { DecomposePanel } from "../components/DecomposePanel";
import { startDecompose } from "../lib/decompose";
import { buildEditInstruction, buildImageIntent, defaultVariantControls, type ImageVariantControls, type ShotControls } from "../lib/continuity";
import { connectedModelsFor, connectedProviders } from "../lib/providers/realGeneration";
import type { RegisteredModel } from "../lib/providers/modelRegistry";
import { Lightbox } from "../components/Lightbox";
import { emptyWorldBible, type Asset } from "../types";
import { MUSIC_GENRE_PRESETS } from "../lib/musicalCozies";
import {
  activeStackCount,
  ART_STYLE_PRESETS,
  ATMOSPHERE_PRESETS,
  CAMERA_PRESETS,
  COLOR_PRESETS,
  CONSTRUCTION_PRESETS,
  EDGE_STYLE_PRESETS,
  LIGHTING_PRESETS,
  MATERIAL_PRESETS,
  REALISM_PRESETS,
  type StyleStackControls,
} from "../lib/styleStack";

const WEATHER_OPTIONS = ["Clear", "Rain", "Snow", "Fog", "Overcast", "Storm"];
const TIME_OPTIONS = ["Morning", "Day", "Sunset", "Night"];
const LIGHTING_OPTIONS = ["Natural", "Warm", "Cool", "Dramatic", "Soft", "Cinematic", "Noir"];
const SEASON_OPTIONS = ["Any", "Spring", "Summer", "Autumn", "Winter"];
const ASPECT_RATIO_OPTIONS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];

const STYLE_STACK_AXES: Array<{ key: keyof StyleStackControls; label: string; presets: typeof ART_STYLE_PRESETS }> = [
  { key: "artStyle", label: "Art Style", presets: ART_STYLE_PRESETS },
  { key: "edgeStyle", label: "Edge Style", presets: EDGE_STYLE_PRESETS },
  { key: "construction", label: "Diorama Construction", presets: CONSTRUCTION_PRESETS },
  { key: "material", label: "Material", presets: MATERIAL_PRESETS },
  { key: "realism", label: "Realism Level", presets: REALISM_PRESETS },
  { key: "lightingPreset", label: "Lighting Preset", presets: LIGHTING_PRESETS },
  { key: "colorPreset", label: "Color Preset", presets: COLOR_PRESETS },
  { key: "atmospherePreset", label: "Atmosphere", presets: ATMOSPHERE_PRESETS },
  { key: "cameraPreset", label: "Camera / Composition", presets: CAMERA_PRESETS },
];

export function ImageStudioPage() {
  const project = useAppStore((state) => state.project);
  const generateImage = useAppStore((state) => state.generateImage);
  const importImage = useAppStore((state) => state.importImage);
  const setHeroImage = useAppStore((state) => state.setHeroImage);
  const togglePreferred = useAppStore((state) => state.togglePreferred);
  const removeAsset = useAppStore((state) => state.removeAsset);
  const renameAsset = useAppStore((state) => state.renameAsset);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const downloadAsset = useAppStore((state) => state.downloadAsset);
  const upscaleImage = useAppStore((state) => state.upscaleImage);
  const upscalingAssetId = useAppStore((state) => state.upscalingAssetId);
  const generateShot = useAppStore((state) => state.generateShot);
  const enqueueRender = useAppStore((state) => state.enqueueRender);

  const [mode, setMode] = useState<"master" | "variant" | "shot">("master");
  const [sourceAssetId, setSourceAssetId] = useState<string>("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [useReal, setUseReal] = useState(false);
  const [hasConnectedProvider, setHasConnectedProvider] = useState(false);
  const [lightboxAsset, setLightboxAsset] = useState<Asset | null>(null);
  const dirName = useAppStore((state) => state.dirName);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);
  const [decomposingAssetId, setDecomposingAssetId] = useState<string | null>(null);

  const handleDecompose = async (asset: Asset) => {
    if (!dirName) return;
    setDecomposeError(null);
    setDecomposingAssetId(asset.id);
    try {
      // submit:false → segment now, then the panel shows the object count and
      // cost estimate and the user confirms the (paid) 3D fan-out.
      await startDecompose(dirName, asset.filePath, { submit: false, qualityPath: true });
    } catch (error) {
      setDecomposeError(error instanceof Error ? error.message : String(error));
    } finally {
      setDecomposingAssetId(null);
    }
  };
  const [styleStackOpen, setStyleStackOpen] = useState(false);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [rawPromptEnabled, setRawPromptEnabled] = useState(false);
  const [shotSubject, setShotSubject] = useState("");
  const [shotFraming, setShotFraming] = useState(CAMERA_PRESETS[1]?.value || "");
  const [shotInstruction, setShotInstruction] = useState("");
  const [shotAspectRatio, setShotAspectRatio] = useState("1:1");
  const [modelOverrideId, setModelOverrideId] = useState("");
  const [connectedModels, setConnectedModels] = useState<RegisteredModel[]>([]);
  const [shotReferenceIds, setShotReferenceIds] = useState<string[]>([]);

  useEffect(() => {
    void connectedProviders().then((set) => setHasConnectedProvider(set.size > 0));
  }, []);

  const requiresStartFrame = mode === "variant" || mode === "shot";
  useEffect(() => {
    setModelOverrideId("");
    void connectedModelsFor("image", requiresStartFrame).then(setConnectedModels);
  }, [requiresStartFrame]);

  const shotModel = connectedModels.find((model) => model.id === modelOverrideId);
  useEffect(() => {
    setShotReferenceIds([]);
  }, [modelOverrideId, sourceAssetId]);

  const imageAssets = useMemo(() => (project?.assets.filter((asset) => asset.type === "image") || []).slice().reverse(), [project?.assets]);
  const [controls, setControls] = useState<ImageVariantControls>(() => defaultVariantControls(project?.worldBible || emptyWorldBible()));

  if (!project) return null;

  const patchControls = (patch: Partial<ImageVariantControls>) => setControls((current) => ({ ...current, ...patch }));
  const patchStyleStack = (patch: Partial<StyleStackControls>) =>
    setControls((current) => ({ ...current, styleStack: { ...current.styleStack, ...patch } }));

  const handleGenerate = () => {
    if (mode === "shot") {
      if (!sourceAssetId || !shotSubject.trim()) return;
      const shotControls: ShotControls = { subjectDescription: shotSubject.trim(), framing: shotFraming, customInstruction: shotInstruction, aspectRatio: shotAspectRatio };
      enqueueRender(`Shot: ${shotSubject.trim()}`.slice(0, 60), () => generateShot(sourceAssetId, shotControls, modelOverrideId || undefined, shotReferenceIds));
      return;
    }
    const label = mode === "variant" ? "Variant" : "Master Image";
    enqueueRender(label, () => generateImage(controls, mode === "variant" ? sourceAssetId || undefined : undefined, useReal, modelOverrideId || undefined));
  };

  // Read-only preview of the exact prompt that will be sent — mirrors the store's own choice between
  // buildImageIntent (master / mock) and buildEditInstruction (real variant edit), so this is never a
  // second source of truth, just a view into the same functions the actual generation call uses.
  const promptPreview =
    mode === "shot"
      ? null
      : mode === "variant" && useReal
        ? buildEditInstruction(controls)
        : buildImageIntent(project.worldBible, controls, mode === "variant").prompt;

  const toggleCompare = (assetId: string) => {
    setCompareIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      if (current.length >= 2) return [current[1], assetId];
      return [...current, assetId];
    });
  };

  const compareAssets = compareIds.map((id) => imageAssets.find((asset) => asset.id === id)).filter(Boolean) as Asset[];

  const toggleShotReference = (assetId: string) => {
    setShotReferenceIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      const max = (shotModel?.supportsReferenceImages ?? 1) - 1; // one slot is always the primary Source Image
      if (current.length >= max) return current;
      return [...current, assetId];
    });
  };

  const handleDelete = async (asset: Asset) => {
    const childCount = imageAssets.filter((existing) => existing.parentAssetId === asset.id).length;
    const warning = childCount > 0 ? `"${asset.name}" has ${childCount} variant${childCount === 1 ? "" : "s"} derived from it that will lose their link to it. ` : "";
    if (!confirm(`${warning}Move "${asset.name}" to trash? The file is recoverable from the project's assets/_trash folder.`)) return;
    setCompareIds((current) => current.filter((id) => id !== asset.id));
    if (lightboxAsset?.id === asset.id) setLightboxAsset(null);
    await removeAsset(asset.id);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Image Studio</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">Generate the master image, then create controlled variants. Every generation is kept in history — nothing is overwritten.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        <div className="rounded-xl border border-base-700 bg-base-900 p-4 h-fit space-y-4">
          <div className="flex rounded-lg border border-base-600 overflow-hidden text-sm">
            <button className={`flex-1 py-2 ${mode === "master" ? "bg-accent-500 text-accentText" : "text-slate-400"}`} onClick={() => setMode("master")}>
              Master Image
            </button>
            <button
              className={`flex-1 py-2 ${mode === "variant" ? "bg-accent-500 text-accentText" : "text-slate-400"}`}
              onClick={() => {
                setMode("variant");
                if (rawPromptEnabled) {
                  setRawPromptEnabled(false);
                  patchControls({ rawPromptOverride: "" });
                }
              }}
            >
              Variant
            </button>
            <button
              className={`flex-1 py-2 ${mode === "shot" ? "bg-accent-500 text-accentText" : "text-slate-400"}`}
              onClick={() => {
                setMode("shot");
                if (rawPromptEnabled) {
                  setRawPromptEnabled(false);
                  patchControls({ rawPromptOverride: "" });
                }
              }}
            >
              Shot
            </button>
          </div>

          {(mode === "variant" || mode === "shot") && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Source Image</label>
              <select
                value={sourceAssetId}
                onChange={(event) => setSourceAssetId(event.target.value)}
                className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
              >
                <option value="">Select a source image…</option>
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
              {mode === "shot" && (
                <img src={sourceAssetId ? assetUrl(imageAssets.find((asset) => asset.id === sourceAssetId)!) : undefined} alt="" className={sourceAssetId ? "w-full rounded-lg border border-base-700 mt-2" : "hidden"} />
              )}
              {mode === "variant" && (
                <p className="text-[11px] text-slate-500 mt-2">
                  Real variants use an instruction-based edit model: it keeps the subject and applies the Weather/Time/Lighting/Season/Mood fields below as an edit
                  instruction, rather than blending pixels — so the building should stay recognizable while conditions change.
                </p>
              )}
              {mode === "shot" && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">
                      What to focus on <span className="text-accent-400 normal-case">(required)</span>
                    </label>
                    <input
                      value={shotSubject}
                      onChange={(event) => setShotSubject(event.target.value)}
                      placeholder="e.g. the red car, Maya's face, the front door"
                      className={`w-full bg-base-800 border rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 ${!shotSubject.trim() ? "border-yellow-600/50" : "border-base-600"}`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Framing</label>
                    <select
                      value={shotFraming}
                      onChange={(event) => setShotFraming(event.target.value)}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                    >
                      {CAMERA_PRESETS.filter((preset) => preset.value).map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Aspect Ratio</label>
                    <select
                      value={shotAspectRatio}
                      onChange={(event) => setShotAspectRatio(event.target.value)}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                    >
                      {ASPECT_RATIO_OPTIONS.map((ratio) => (
                        <option key={ratio} value={ratio}>
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Additional Camera Notes (optional)</label>
                    <textarea
                      rows={2}
                      value={shotInstruction}
                      onChange={(event) => setShotInstruction(event.target.value)}
                      placeholder="e.g. slightly from below, warm rim light"
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
                    />
                  </div>
                  {Boolean(shotModel?.supportsReferenceImages && shotModel.supportsReferenceImages > 1) && (
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">
                        Additional Reference Images ({shotReferenceIds.length}/{(shotModel?.supportsReferenceImages ?? 1) - 1})
                      </label>
                      <p className="text-[11px] text-slate-500 mb-1.5">
                        {shotModel?.label} accepts multiple images in one edit — pick others to compose alongside the Source Image above (e.g. a character + a background).
                      </p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {imageAssets
                          .filter((asset) => asset.id !== sourceAssetId)
                          .map((asset) => {
                            const selected = shotReferenceIds.includes(asset.id);
                            const url = assetUrl(asset);
                            return (
                              <button
                                key={asset.id}
                                title={asset.name}
                                onClick={() => toggleShotReference(asset.id)}
                                className={`aspect-square rounded-md overflow-hidden border-2 ${selected ? "border-accent-500" : "border-base-700"}`}
                              >
                                {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-base-800" />}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500">
                    Shots always use a real edit model to reframe the existing image — there's no mock renderer for this, since it needs to actually look at the
                    source image. Add a connected provider in Settings to use it.
                  </p>
                </div>
              )}
            </div>
          )}

          {mode !== "shot" && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Musical Cozy Preset</label>
              <div className="flex flex-wrap gap-1.5">
                {MUSIC_GENRE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    title={preset.settingDescription}
                    onClick={() => {
                      patchStyleStack(preset.styleStack);
                      patchControls({ customInstruction: preset.settingDescription, mood: preset.mood });
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 transition"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                One click sets Style Stack, Mood, and Additional Instructions to match a music genre from the Cozies deck — refine any field after.
              </p>
            </div>
          )}

          {mode !== "shot" && (
          <div className="rounded-lg border border-base-700 overflow-hidden">
            <label className="flex items-center justify-between px-3 py-2.5 cursor-pointer">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Raw Prompt Override</span>
              <input
                type="checkbox"
                checked={rawPromptEnabled}
                onChange={(event) => {
                  setRawPromptEnabled(event.target.checked);
                  if (!event.target.checked) patchControls({ rawPromptOverride: "" });
                }}
              />
            </label>
            {rawPromptEnabled && (
              <div className="px-3 pb-3 border-t border-base-700 pt-3">
                <textarea
                  rows={4}
                  value={controls.rawPromptOverride}
                  onChange={(event) => patchControls({ rawPromptOverride: event.target.value })}
                  placeholder="Paste a complete prompt. This replaces the World Bible, mood/weather/lighting fields, and the Style Stack entirely — used exactly as typed."
                  className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
                />
                {mode === "variant" && (
                  <p className="text-[11px] text-yellow-500 mt-1.5">
                    In Variant mode this replaces the whole edit instruction too — Weather/Time/Lighting/Season below won't apply. Turn this off to go back to
                    weather-driven variants.
                  </p>
                )}
                <p className="text-[11px] text-slate-500 mt-1.5">Weather/Lighting/Style Stack below are ignored while this has text in it — Aspect Ratio still applies, since that's a real generation parameter, not part of the prompt.</p>
              </div>
            )}
          </div>
          )}

          {mode !== "shot" && (
          <Field label="Aspect Ratio" value={controls.aspectRatio} options={ASPECT_RATIO_OPTIONS} onChange={(value) => patchControls({ aspectRatio: value })} />
          )}

          {mode !== "shot" && (
          <div className={rawPromptEnabled && controls.rawPromptOverride.trim() ? "space-y-4 opacity-40 pointer-events-none" : "space-y-4"}>
          <Field label="Weather" value={controls.weather} options={WEATHER_OPTIONS} onChange={(value) => patchControls({ weather: value })} />
          <Field label="Time of Day" value={controls.timeOfDay} options={TIME_OPTIONS} onChange={(value) => patchControls({ timeOfDay: value })} />
          <Field label="Lighting" value={controls.lighting} options={LIGHTING_OPTIONS} onChange={(value) => patchControls({ lighting: value })} />
          <Field label="Season" value={controls.season} options={SEASON_OPTIONS} onChange={(value) => patchControls({ season: value })} />

          <div className="rounded-lg border border-base-700 overflow-hidden">
            <button
              onClick={() => setStyleStackOpen((open) => !open)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-white transition"
            >
              <span className="flex items-center gap-2">
                Style Stack
                {activeStackCount(controls.styleStack) > 0 && (
                  <span className="bg-accent-500 text-accentText text-[10px] px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                    {activeStackCount(controls.styleStack)}
                  </span>
                )}
              </span>
              <ChevronDown size={14} className={`transition-transform ${styleStackOpen ? "rotate-180" : ""}`} />
            </button>
            {styleStackOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-base-700 pt-3">
                <p className="text-[11px] text-slate-500 -mt-1">
                  Independent art-direction layers — leave any at "None" to fall back to the World Bible's own art style.
                </p>
                {STYLE_STACK_AXES.map(({ key, label, presets }) => (
                  <div key={key}>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">{label}</label>
                    <select
                      value={controls.styleStack[key]}
                      onChange={(event) => patchStyleStack({ [key]: event.target.value })}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-2.5 py-1.5 text-xs text-white outline-none focus:border-accent-500"
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

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Mood</label>
            <input
              value={controls.mood}
              onChange={(event) => patchControls({ mood: event.target.value })}
              className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Additional Instructions</label>
            <textarea
              rows={2}
              value={controls.customInstruction}
              onChange={(event) => patchControls({ customInstruction: event.target.value })}
              placeholder="e.g. more plants, warmer lamp glow…"
              className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
            />
          </div>
          </div>
          )}

          {mode !== "shot" && (
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Rendering</label>
            <div className="flex rounded-lg border border-base-600 overflow-hidden text-xs">
              <button className={`flex-1 py-1.5 ${!useReal ? "bg-accent-500 text-accentText" : "text-slate-400"}`} onClick={() => setUseReal(false)}>
                Mock (local, free)
              </button>
              <button
                className={`flex-1 py-1.5 ${useReal ? "bg-accent-500 text-accentText" : "text-slate-400"} ${!hasConnectedProvider ? "opacity-50" : ""}`}
                onClick={() => setUseReal(true)}
                title={hasConnectedProvider ? undefined : "Add an API key in Settings first"}
              >
                Auto (connected provider)
              </button>
            </div>
            {useReal && !hasConnectedProvider && <p className="text-[11px] text-yellow-500 mt-1">No provider connected — add a key in Settings.</p>}
          </div>
          )}

          {mode !== "shot" && useReal && connectedModels.length > 0 && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Model</label>
              <select
                value={modelOverrideId}
                onChange={(event) => setModelOverrideId(event.target.value)}
                className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
              >
                <option value="">Auto (best match)</option>
                {connectedModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === "shot" && connectedModels.length > 0 && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Model</label>
              <select
                value={modelOverrideId}
                onChange={(event) => setModelOverrideId(event.target.value)}
                className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
              >
                <option value="">Auto (best match)</option>
                {connectedModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {promptPreview && (
            <div className="rounded-lg border border-base-700 overflow-hidden">
              <button
                onClick={() => setPromptPreviewOpen((open) => !open)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-white transition"
              >
                Prompt Preview
                <ChevronDown size={14} className={`transition-transform ${promptPreviewOpen ? "rotate-180" : ""}`} />
              </button>
              {promptPreviewOpen && (
                <div className="px-3 pb-3 border-t border-base-700 pt-3">
                  <p className="text-[11px] text-slate-500 mb-1.5">Exactly what will be sent — read-only. To change it, use Raw Prompt Override above.</p>
                  <textarea
                    readOnly
                    rows={6}
                    value={promptPreview}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-xs text-slate-300 outline-none resize-none"
                  />
                </div>
              )}
            </div>
          )}

          <button
            disabled={
              (mode === "variant" && !sourceAssetId) ||
              (mode === "shot" && (!sourceAssetId || !shotSubject.trim() || !hasConnectedProvider)) ||
              (mode !== "shot" && useReal && !hasConnectedProvider)
            }
            onClick={handleGenerate}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
          >
            <Wand2 size={16} /> {mode === "shot" ? "Queue Shot" : mode === "variant" ? "Queue Variant" : "Queue Master Image"}
          </button>
          {mode === "shot" && !sourceAssetId && <p className="text-[11px] text-yellow-500 -mt-2">Select a source image above.</p>}
          {mode === "shot" && sourceAssetId && !shotSubject.trim() && <p className="text-[11px] text-yellow-500 -mt-2">Fill in "What to focus on" above.</p>}
          {mode === "shot" && sourceAssetId && shotSubject.trim() && !hasConnectedProvider && <p className="text-[11px] text-yellow-500 -mt-2">No provider connected — add a key in Settings.</p>}
          <button
            onClick={() => void importImage("image")}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-base-600 hover:border-accent-500 text-slate-300 hover:text-white px-4 py-2.5 text-sm transition"
          >
            <ImagePlus size={16} /> Import Existing Image
          </button>
        </div>

        <div>
          {compareAssets.length === 2 && (
            <div className="mb-6 rounded-xl border border-accent-500/50 bg-base-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white">Comparing 2 generations</h3>
                <button className="text-xs text-slate-400 hover:text-white" onClick={() => setCompareIds([])}>
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {compareAssets.map((asset) => (
                  <div key={asset.id}>
                    <img src={assetUrl(asset)} alt={asset.name} className="w-full rounded-lg border border-base-700" />
                    <p className="text-xs text-slate-400 mt-1.5">{asset.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {imageAssets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
              <Sparkles className="mx-auto text-slate-600 mb-3" size={28} />
              <p className="text-slate-400">No images yet. Generate your master image to begin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {imageAssets.map((asset) => {
                const isHero = project.metadata.heroImageAssetId === asset.id;
                const isPreferred = Boolean(asset.metadata.preferred);
                const isComparing = compareIds.includes(asset.id);
                return (
                  <div key={asset.id} className={`group rounded-xl border overflow-hidden bg-base-900 transition ${isComparing ? "border-accent-500" : "border-base-700"}`}>
                    <div className="relative">
                      <button className="block w-full" onClick={() => toggleCompare(asset.id)}>
                        <img src={assetUrl(asset)} alt={asset.name} className="w-full aspect-video object-cover" />
                      </button>
                      {isHero && (
                        <span className="absolute top-2 left-2 bg-accent-500 text-accentText text-[10px] font-medium px-1.5 py-0.5 rounded">HERO</span>
                      )}
                      <span className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded uppercase">{asset.role}</span>
                      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition">
                        <button
                          title="Download"
                          onClick={(event) => {
                            event.stopPropagation();
                            void downloadAsset(asset.id);
                          }}
                          className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          title="View full size"
                          onClick={(event) => {
                            event.stopPropagation();
                            setLightboxAsset(asset);
                          }}
                          className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white"
                        >
                          <Expand size={13} />
                        </button>
                        <button
                          title="Decompose & Send to 3D"
                          disabled={decomposingAssetId === asset.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDecompose(asset);
                          }}
                          className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white disabled:opacity-50"
                        >
                          {decomposingAssetId === asset.id ? <Loader2 size={13} className="animate-spin" /> : <Boxes size={13} />}
                        </button>
                      </div>
                    </div>
                    <div className="p-2.5 flex items-center justify-between gap-2">
                      <EditableAssetName name={asset.name} onSave={(name) => void renameAsset(asset.id, name)} />
                      <div className="flex items-center gap-1 shrink-0">
                        <button title="Prefer" onClick={() => void togglePreferred(asset.id)} className={isPreferred ? "text-red-400" : "text-slate-500 hover:text-red-400"}>
                          <Heart size={14} fill={isPreferred ? "currentColor" : "none"} />
                        </button>
                        <button title="Set as hero" onClick={() => void setHeroImage(asset.id)} className={isHero ? "text-yellow-400" : "text-slate-500 hover:text-yellow-400"}>
                          <Star size={14} fill={isHero ? "currentColor" : "none"} />
                        </button>
                        <button title="Delete" onClick={() => void handleDelete(asset)} className="text-slate-500 hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {decomposeError && (
            <p className="mt-4 text-xs text-red-400">{decomposeError}</p>
          )}
          <DecomposePanel />
        </div>
      </div>

      {lightboxAsset && assetUrl(lightboxAsset) && (
        <Lightbox
          src={assetUrl(lightboxAsset)!}
          alt={lightboxAsset.name}
          onClose={() => setLightboxAsset(null)}
          actions={
            <>
              <button
                onClick={() => void downloadAsset(lightboxAsset.id)}
                className="flex items-center gap-1.5 text-xs text-white/90 hover:text-white bg-black/50 hover:bg-black/70 rounded-full px-3 py-1.5 transition"
              >
                <Download size={13} /> Download
              </button>
              <button
                disabled={!hasConnectedProvider || upscalingAssetId === lightboxAsset.id}
                title={hasConnectedProvider ? undefined : "Add a fal.ai API key in Settings first"}
                onClick={() => void upscaleImage(lightboxAsset.id, 2)}
                className="flex items-center gap-1.5 text-xs text-white/90 hover:text-white bg-black/50 hover:bg-black/70 disabled:opacity-40 disabled:cursor-not-allowed rounded-full px-3 py-1.5 transition"
              >
                {upscalingAssetId === lightboxAsset.id ? <Loader2 size={13} className="animate-spin" /> : null} Upscale 2×
              </button>
              <button
                disabled={!hasConnectedProvider || upscalingAssetId === lightboxAsset.id}
                title={hasConnectedProvider ? undefined : "Add a fal.ai API key in Settings first"}
                onClick={() => void upscaleImage(lightboxAsset.id, 4)}
                className="flex items-center gap-1.5 text-xs text-white/90 hover:text-white bg-black/50 hover:bg-black/70 disabled:opacity-40 disabled:cursor-not-allowed rounded-full px-3 py-1.5 transition"
              >
                {upscalingAssetId === lightboxAsset.id ? <Loader2 size={13} className="animate-spin" /> : null} Upscale 4×
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

function EditableAssetName({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (!editing) {
    return (
      <button
        title="Click to rename"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="text-xs text-slate-400 hover:text-white truncate text-left min-w-0"
      >
        {name}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onSave(trimmed);
  };

  return (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          setDraft(name);
          setEditing(false);
        }
      }}
      onClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 bg-base-800 border border-accent-500 rounded px-1.5 py-0.5 text-xs text-white outline-none"
    />
  );
}

function Field({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
