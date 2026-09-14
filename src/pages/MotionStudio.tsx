import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, Film, Sparkles, Trash2, Volume2, Wand2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { connectedModelsFor, connectedProviders, connectedVideoModelsForShotMode } from "../lib/providers/realGeneration";
import { Slider } from "../components/Slider";
import { useRenderModePref } from "../lib/preferences";
import { PromptAssist } from "../components/PromptAssist";
import { ContinuityCheck } from "../components/ContinuityCheck";
import * as api from "../lib/api";
import type { RegisteredModel } from "../lib/providers/modelRegistry";
import type { StyleStackControls } from "../lib/styleStack";
import { entityKind, ENTITY_KIND_LABELS, projectCharacters } from "../types";

export function MotionStudioPage() {
  const project = useAppStore((state) => state.project);
  const dirName = useAppStore((state) => state.dirName);
  const activeSceneId = useAppStore((state) => state.activeSceneId);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const generateMotion = useAppStore((state) => state.generateMotion);
  const generateVideoShot = useAppStore((state) => state.generateVideoShot);
  const removeAsset = useAppStore((state) => state.removeAsset);
  const enqueueRender = useAppStore((state) => state.enqueueRender);

  const imageAssets = useMemo(() => project?.assets.filter((asset) => asset.type === "image") || [], [project?.assets]);
  const videoAssets = useMemo(() => (project?.assets.filter((asset) => asset.type === "video") || []).slice().reverse(), [project?.assets]);
  const audioAssets = useMemo(() => (project?.assets.filter((asset) => ["audio", "music", "sfx", "dialogue"].includes(asset.type)) || []).slice().reverse(), [project?.assets]);

  const [mode, setMode] = useState<"simple" | "shot">("simple");

  const [sourceAssetId, setSourceAssetId] = useState("");
  const [motionDescription, setMotionDescription] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(3);
  const [loop, setLoop] = useState(true);
  const [useReal, setUseReal] = useRenderModePref();
  const [hasConnectedProvider, setHasConnectedProvider] = useState(false);
  const [modelOverrideId, setModelOverrideId] = useState("");
  const [connectedModels, setConnectedModels] = useState<RegisteredModel[]>([]);

  // --- Shot Mode: full multi-model, multi-reference video generation ------------------------
  const [shotModels, setShotModels] = useState<RegisteredModel[]>([]);
  const [shotModelId, setShotModelId] = useState("");
  const [shotPrompt, setShotPrompt] = useState("");
  const [shotStartId, setShotStartId] = useState("");
  const [shotEndId, setShotEndId] = useState("");
  const [shotReferenceIds, setShotReferenceIds] = useState<string[]>([]);
  const [shotCharacterIds, setShotCharacterIds] = useState<string[]>([]);
  const [shotReferenceVideoId, setShotReferenceVideoId] = useState("");
  const [shotReferenceAudioIds, setShotReferenceAudioIds] = useState<string[]>([]);
  const [shotAspectRatio, setShotAspectRatio] = useState("");
  const [shotResolution, setShotResolution] = useState("");
  const shotPromptRef = useRef<HTMLTextAreaElement>(null);
  const [shotGenerateAudio, setShotGenerateAudio] = useState(true);
  const [shotDuration, setShotDuration] = useState(5);
  const shotModel = shotModels.find((model) => model.id === shotModelId);
  // Groups the (often 15-20+) Shot Mode models by family (Seedance, Wan, Kling, ...) so the
  // dropdown reads as a scannable menu instead of one long flat list — families appear in the
  // order their first model appears in the registry, not alphabetically, so higher-priority
  // families stay near the top.
  const shotModelFamilies = useMemo(() => {
    const groups = new Map<string, RegisteredModel[]>();
    for (const model of shotModels) {
      const existing = groups.get(model.family);
      if (existing) existing.push(model);
      else groups.set(model.family, [model]);
    }
    return [...groups.entries()];
  }, [shotModels]);

  useEffect(() => {
    void connectedProviders().then((set) => setHasConnectedProvider(set.size > 0));
    void connectedModelsFor("video", true).then(setConnectedModels);
    void connectedVideoModelsForShotMode().then((models) => {
      setShotModels(models);
      setShotModelId((current) => current || models[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    if (!shotModel) return;
    setShotAspectRatio(shotModel.aspectRatios[0] || "");
    setShotResolution(shotModel.supportsResolution?.[0] || "");
    setShotGenerateAudio(true);
    setShotDuration(Math.min(5, shotModel.maxDurationSeconds ?? 5));
    if (!shotModel.requiresStartFrame) setShotStartId("");
    if (!shotModel.supportsEndFrame) setShotEndId("");
    if (!shotModel.supportsReferenceImages) { setShotReferenceIds([]); setShotCharacterIds([]); }
    if (!shotModel.supportsReferenceVideo) setShotReferenceVideoId("");
    if (!shotModel.supportsReferenceAudio) setShotReferenceAudioIds([]);
  }, [shotModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;

  // The diorama type a video should carry lives on the source image's own generation record, not
  // as a separate picker here — Motion Studio animates an already-styled frame, so re-describing
  // style independently would risk contradicting it. Pull it so Prompt Assist and the real
  // generation prompt both stay consistent with whatever the source frame was actually made with.
  const styleStackFor = (assetId: string) => {
    const asset = project.assets.find((a) => a.id === assetId);
    const generation = asset?.generationId ? project.generations.find((job) => job.id === asset.generationId) : undefined;
    return (generation?.settings as { styleStack?: StyleStackControls } | undefined)?.styleStack;
  };

  const handleGenerate = () => {
    if (!sourceAssetId) return;
    const sourceName = imageAssets.find((asset) => asset.id === sourceAssetId)?.name || "image";
    enqueueRender(`Motion: ${sourceName}`.slice(0, 60), () => generateMotion(sourceAssetId, motionDescription, durationSeconds, loop, useReal, modelOverrideId || undefined));
  };

  const toggleShotReference = (assetId: string) => {
    setShotReferenceIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      const max = shotModel?.supportsReferenceImages ?? 0;
      if (current.length >= max) return current;
      return [...current, assetId];
    });
  };

  const toggleShotReferenceAudio = (assetId: string) => {
    setShotReferenceAudioIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      const max = shotModel?.supportsReferenceAudio ?? 0;
      if (current.length >= max) return current;
      return [...current, assetId];
    });
  };

  // Inserts a token like "@Image2" at the cursor position in the Prompt textarea (or appends it
  // if the textarea hasn't been focused yet) — makes it easy to actually use Seedance 2.0's
  // reference-to-video @mention syntax without hand-typing/miscounting reference indices.
  const insertMention = (token: string) => {
    const textarea = shotPromptRef.current;
    if (!textarea) {
      const needsLeadingSpace = shotPrompt.length > 0 && !shotPrompt.endsWith(" ");
      setShotPrompt((current) => `${current}${needsLeadingSpace ? " " : ""}@${token} `);
      return;
    }
    const start = textarea.selectionStart ?? shotPrompt.length;
    const end = textarea.selectionEnd ?? shotPrompt.length;
    const needsLeadingSpace = start > 0 && !/\s/.test(shotPrompt[start - 1] ?? "");
    const insert = `${needsLeadingSpace ? " " : ""}@${token} `;
    const next = shotPrompt.slice(0, start) + insert + shotPrompt.slice(end);
    setShotPrompt(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + insert.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const characters = project ? projectCharacters(project) : [];

  // Same pattern as Image Studio's Shot Mode: picking a character auto-attaches its first reference
  // image (respecting this model's own reference-image slot budget) and its style sheet always folds
  // into the prompt at generate time below, regardless of whether the image could be attached too.
  const toggleShotCharacter = (characterId: string) => {
    const alreadyOn = shotCharacterIds.includes(characterId);
    setShotCharacterIds((current) => (alreadyOn ? current.filter((id) => id !== characterId) : [...current, characterId]));
    const character = characters.find((existing) => existing.id === characterId);
    const referenceId = character?.referenceAssetIds[0];
    if (!referenceId) return;
    if (alreadyOn) {
      setShotReferenceIds((current) => current.filter((id) => id !== referenceId));
    } else {
      setShotReferenceIds((current) => {
        if (current.includes(referenceId)) return current;
        const max = shotModel?.supportsReferenceImages ?? 0;
        if (current.length >= max) return current;
        return [...current, referenceId];
      });
    }
  };

  const handleGenerateShot = () => {
    if (!shotModel || !shotPrompt.trim()) return;
    if (shotModel.requiresStartFrame && !shotStartId) return;
    const characterFragments = characters
      .filter((character) => shotCharacterIds.includes(character.id) && character.styleSheet.trim())
      .map((character) => `${character.name}: ${character.styleSheet.trim()}`);
    const prompt = [...characterFragments, shotPrompt].filter(Boolean).join(" ");
    enqueueRender(`Shot: ${shotPrompt}`.slice(0, 60), () =>
      generateVideoShot({
        prompt,
        modelId: shotModel.id,
        startAssetId: shotStartId || undefined,
        endAssetId: shotEndId || undefined,
        referenceAssetIds: shotReferenceIds,
        referenceVideoAssetId: shotReferenceVideoId || undefined,
        referenceAudioAssetIds: shotReferenceAudioIds,
        aspectRatio: shotAspectRatio || undefined,
        resolution: shotResolution || undefined,
        generateAudio: shotModel.supportsAudioToggle ? shotGenerateAudio : undefined,
        durationSeconds: shotDuration,
      }),
    );
  };

  const handleDelete = async (assetId: string) => {
    if (!confirm("Move this clip to trash? It's recoverable from the project's assets/_trash folder.")) return;
    await removeAsset(assetId);
  };

  const [savingClipId, setSavingClipId] = useState<string | null>(null);
  const handleSaveClip = async (assetId: string, filePath: string, name: string) => {
    if (!dirName) return;
    setSavingClipId(assetId);
    try {
      const absolutePath = await api.assetAbsolutePath(dirName, filePath);
      await api.saveVideoCopy(absolutePath, `${name || "clip"}.mp4`);
    } finally {
      setSavingClipId(null);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Motion Studio</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">
          {mode === "simple"
            ? "Turn a still image into a short looping motion layer. Every clip is stored as a child of its source image."
            : "Full video generation — text or image to video, start/end frames, and multiple reference images/video across every connected video model."}
        </p>
      </div>

      <div className="flex rounded-lg border border-base-600 overflow-hidden text-xs w-fit mb-6">
        <button className={`flex items-center gap-1.5 px-4 py-2 ${mode === "simple" ? "bg-accent-500 text-accentText" : "text-slate-400 hover:text-white"}`} onClick={() => setMode("simple")}>
          <Film size={13} /> Simple
        </button>
        <button className={`flex items-center gap-1.5 px-4 py-2 ${mode === "shot" ? "bg-accent-500 text-accentText" : "text-slate-400 hover:text-white"}`} onClick={() => setMode("shot")}>
          <Clapperboard size={13} /> Shot Mode
        </button>
      </div>

      {mode === "shot" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          <div className="rounded-xl border border-base-700 bg-base-900 p-4 h-fit space-y-4">
            {shotModels.length === 0 ? (
              <p className="text-xs text-slate-500">
                No connected provider supports video generation yet — add a fal.ai (or ComfyUI local model) key in Settings to use Shot Mode.
              </p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Model</label>
                  <select
                    value={shotModelId}
                    onChange={(event) => setShotModelId(event.target.value)}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                  >
                    {shotModelFamilies.map(([family, models]) => (
                      <optgroup key={family} label={family}>
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {shotModel && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {shotModel.requiresStartFrame ? "Requires a start image. " : "Text-to-video — no image required. "}
                      {shotModel.supportsEndFrame && "Supports an end frame. "}
                      {Boolean(shotModel.supportsReferenceImages) && `Up to ${shotModel.supportsReferenceImages} reference images. `}
                      {shotModel.supportsReferenceVideo && "Supports a reference video. "}
                      {Boolean(shotModel.supportsReferenceAudio) && `Up to ${shotModel.supportsReferenceAudio} reference audio clips.`}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Prompt</label>
                  <textarea
                    ref={shotPromptRef}
                    rows={3}
                    value={shotPrompt}
                    onChange={(event) => setShotPrompt(event.target.value)}
                    placeholder="Describe the shot — action, camera movement, mood…"
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
                  />
                  <PromptAssist
                    kind="video"
                    worldBible={project?.worldBible}
                    scene={project?.scenes.find((scene) => scene.id === activeSceneId)}
                    model={shotModel}
                    shotCharacters={characters.filter((character) => shotCharacterIds.includes(character.id))}
                    styleStack={shotStartId ? styleStackFor(shotStartId) : undefined}
                    onUse={setShotPrompt}
                  />
                </div>

                {shotModel?.requiresStartFrame && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Start Image</label>
                    <select
                      value={shotStartId}
                      onChange={(event) => setShotStartId(event.target.value)}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                    >
                      <option value="">Select an image…</option>
                      {imageAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {shotModel?.supportsEndFrame && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">End Image (optional)</label>
                    <select
                      value={shotEndId}
                      onChange={(event) => setShotEndId(event.target.value)}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                    >
                      <option value="">None</option>
                      {imageAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {characters.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Cast &amp; Props in this Shot</label>
                    <div className="flex flex-wrap gap-1.5">
                      {characters.map((character) => {
                        const selected = shotCharacterIds.includes(character.id);
                        return (
                          <button
                            key={character.id}
                            type="button"
                            title={ENTITY_KIND_LABELS[entityKind(character)]}
                            onClick={() => toggleShotCharacter(character.id)}
                            className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                              selected ? "border-accent-500 bg-accent-500/10 text-accent-400" : "border-base-600 text-slate-400 hover:text-white hover:border-base-500"
                            }`}
                          >
                            {character.name}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Auto-attaches each one's reference image (if this model supports one) and folds its style sheet into the prompt either way.
                    </p>
                    <div className="mt-2">
                      <ContinuityCheck
                        prompt={shotPrompt}
                        characters={characters.filter((character) => shotCharacterIds.includes(character.id))}
                        worldBible={project?.worldBible}
                        onAppend={(addition) => setShotPrompt((current) => [current, addition].filter(Boolean).join(", "))}
                      />
                    </div>
                  </div>
                )}

                {Boolean(shotModel?.supportsReferenceImages) && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">
                      Reference Images ({shotReferenceIds.length}/{shotModel?.supportsReferenceImages})
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {imageAssets.map((asset) => {
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

                {shotModel?.supportsReferenceVideo && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Reference Video (optional)</label>
                    <select
                      value={shotReferenceVideoId}
                      onChange={(event) => setShotReferenceVideoId(event.target.value)}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                    >
                      <option value="">None</option>
                      {videoAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {Boolean(shotModel?.supportsReferenceAudio) && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">
                      Reference Audio ({shotReferenceAudioIds.length}/{shotModel?.supportsReferenceAudio})
                    </label>
                    {audioAssets.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No audio clips in this project yet — generate one in Audio Studio first.</p>
                    ) : (
                      <div className="space-y-1">
                        {audioAssets.map((asset) => {
                          const selected = shotReferenceAudioIds.includes(asset.id);
                          return (
                            <button
                              key={asset.id}
                              onClick={() => toggleShotReferenceAudio(asset.id)}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs text-left truncate ${
                                selected ? "border-accent-500 bg-accent-500/10 text-white" : "border-base-700 text-slate-400 hover:text-white"
                              }`}
                            >
                              <Volume2 size={12} className="shrink-0" /> {asset.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {(() => {
                  const mentions = shotModel?.mentionSyntax;
                  const showImages = Boolean(mentions?.images) && shotReferenceIds.length > 0;
                  const showVideo = Boolean(mentions?.video) && shotReferenceVideoId;
                  const showAudio = Boolean(mentions?.audio) && shotReferenceAudioIds.length > 0;
                  if (!showImages && !showVideo && !showAudio) return null;
                  // The model's actual @mention syntax is fixed (@Image1, @Image2, ... — a real API
                  // contract, not something Cozyverse can rename), so the inserted token always stays
                  // positional. But a chip that just says "@Image2" gives no way to tell which named
                  // Cast & Props entity that position actually is — label it with the entity's name
                  // whenever this reference image IS one, so picking the right mention doesn't mean
                  // counting positions by hand.
                  const entityNameForAsset = (assetId: string) => characters.find((character) => character.referenceAssetIds[0] === assetId)?.name;
                  return (
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Insert Reference in Prompt</label>
                      <p className="text-[11px] text-slate-500 mb-1.5">
                        {shotModel!.label} reads these tags in the prompt to know which reference does what — click one to insert it where your cursor is.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {showImages &&
                          shotReferenceIds.map((assetId, index) => {
                            const entityName = entityNameForAsset(assetId);
                            return (
                              <button
                                key={`image-${index}`}
                                onClick={() => insertMention(`Image${index + 1}`)}
                                title={entityName ? `${entityName}'s reference image` : undefined}
                                className="text-[11px] px-2 py-1 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 transition"
                              >
                                @Image{index + 1}
                                {entityName && <span className="text-accent-400"> ({entityName})</span>}
                              </button>
                            );
                          })}
                        {showVideo && (
                          <button
                            onClick={() => insertMention("Video1")}
                            className="text-[11px] px-2 py-1 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 transition"
                          >
                            @Video1
                          </button>
                        )}
                        {showAudio &&
                          shotReferenceAudioIds.map((_, index) => (
                            <button
                              key={`audio-${index}`}
                              onClick={() => insertMention(`Audio${index + 1}`)}
                              className="text-[11px] px-2 py-1 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 transition"
                            >
                              @Audio{index + 1}
                            </button>
                          ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Aspect Ratio</label>
                    <select
                      value={shotAspectRatio}
                      onChange={(event) => setShotAspectRatio(event.target.value)}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                    >
                      {(shotModel?.aspectRatios || []).map((ratio) => (
                        <option key={ratio} value={ratio}>
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Duration: {shotDuration}s</label>
                    <Slider min={2} max={shotModel?.maxDurationSeconds ?? 10} value={shotDuration} onChange={setShotDuration} className="w-full mt-2.5" />
                  </div>
                </div>

                {Boolean(shotModel?.supportsResolution) && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Resolution</label>
                    <select
                      value={shotResolution}
                      onChange={(event) => setShotResolution(event.target.value)}
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                    >
                      {(shotModel?.supportsResolution || []).map((resolution) => (
                        <option key={resolution} value={resolution}>
                          {resolution}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {shotModel?.supportsAudioToggle && (
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input type="checkbox" checked={shotGenerateAudio} onChange={(event) => setShotGenerateAudio(event.target.checked)} />
                    Generate synchronized audio
                  </label>
                )}

                <button
                  disabled={!shotModel || !shotPrompt.trim() || (shotModel.requiresStartFrame && !shotStartId)}
                  onClick={handleGenerateShot}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
                >
                  <Clapperboard size={16} /> Queue Shot
                </button>
              </>
            )}
          </div>

          <div>
            {videoAssets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
                <Film className="mx-auto text-slate-600 mb-3" size={28} />
                <p className="text-slate-400">No clips yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {videoAssets.map((asset) => {
                  const url = assetUrl(asset);
                  return (
                    <div key={asset.id} className="rounded-xl border border-base-700 bg-base-900 overflow-hidden">
                      {url ? (
                        <video src={url} controls className="w-full aspect-video bg-black" />
                      ) : (
                        <div className="w-full aspect-video bg-base-800 flex items-center justify-center">
                          <Film className="text-slate-600" size={24} />
                        </div>
                      )}
                      <div className="p-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{asset.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{asset.model}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            title="Download"
                            disabled={!url || savingClipId === asset.id}
                            onClick={() => void handleSaveClip(asset.id, asset.filePath, asset.name)}
                            className="text-slate-500 hover:text-accent-400 disabled:opacity-40"
                          >
                            <Download size={14} />
                          </button>
                          <button title="Delete" onClick={() => void handleDelete(asset.id)} className="text-slate-500 hover:text-red-400">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : imageAssets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <Sparkles className="mx-auto text-slate-600 mb-3" size={28} />
          <p className="text-slate-400">Generate a master image in Image Studio first — motion needs a source frame.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
          <div className="rounded-xl border border-base-700 bg-base-900 p-4 h-fit space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Source Image</label>
              <select
                value={sourceAssetId}
                onChange={(event) => setSourceAssetId(event.target.value)}
                className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
              >
                <option value="">Select an image…</option>
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
              {sourceAssetId && assetUrl(imageAssets.find((asset) => asset.id === sourceAssetId)!) && (
                <img src={assetUrl(imageAssets.find((asset) => asset.id === sourceAssetId)!)} alt="" className="w-full rounded-lg border border-base-700 mt-2" />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Motion Description</label>
              <textarea
                rows={3}
                value={motionDescription}
                onChange={(event) => setMotionDescription(event.target.value)}
                placeholder="e.g. rain falling steadily, slow camera drift across the skyline"
                className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
              />
              <PromptAssist
                kind="video"
                worldBible={project?.worldBible}
                scene={project?.scenes.find((scene) => scene.id === activeSceneId)}
                styleStack={sourceAssetId ? styleStackFor(sourceAssetId) : undefined}
                onUse={setMotionDescription}
              />
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Duration: {durationSeconds}s</label>
              <Slider min={2} max={useReal ? 15 : 8} value={durationSeconds} onChange={setDurationSeconds} className="w-full" />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
              Loop this clip in playback
            </label>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Rendering</label>
              <div className="flex rounded-lg border border-base-600 overflow-hidden text-xs">
                <button className={`flex-1 py-1.5 ${!useReal ? "bg-accent-500 text-accentText" : "text-slate-400"}`} onClick={() => setUseReal(false)}>
                  Mock (local, free)
                </button>
                <button
                  className={`flex-1 py-1.5 ${useReal ? "bg-accent-500 text-accentText" : "text-slate-400"} ${!hasConnectedProvider ? "opacity-50" : ""}`}
                  onClick={() => setUseReal(true)}
                  title={hasConnectedProvider ? undefined : "Add a fal.ai API key in Settings first"}
                >
                  Auto (connected provider)
                </button>
              </div>
              {useReal && !hasConnectedProvider && <p className="text-[11px] text-yellow-500 mt-1">No provider connected — add a fal.ai key in Settings.</p>}
              {useReal && <p className="text-[11px] text-slate-500 mt-1">Real video generation is slow — often 1-3+ minutes per clip.</p>}
            </div>

            {useReal && connectedModels.length > 0 && (
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

            <button
              disabled={!sourceAssetId || (useReal && !hasConnectedProvider)}
              onClick={handleGenerate}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
            >
              <Wand2 size={16} /> Queue Motion
            </button>
          </div>

          <div>
            {videoAssets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
                <Film className="mx-auto text-slate-600 mb-3" size={28} />
                <p className="text-slate-400">No motion clips yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {videoAssets.map((asset) => {
                  const parent = project.assets.find((existing) => existing.id === asset.parentAssetId);
                  const url = assetUrl(asset);
                  return (
                    <div key={asset.id} className="rounded-xl border border-base-700 bg-base-900 overflow-hidden">
                      {url ? (
                        <video src={url} controls loop={Boolean(asset.metadata.loop)} className="w-full aspect-video bg-black" />
                      ) : (
                        <div className="w-full aspect-video bg-base-800 flex items-center justify-center">
                          <Film className="text-slate-600" size={24} />
                        </div>
                      )}
                      <div className="p-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{asset.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {String(asset.metadata.durationSeconds ?? "?")}s · {asset.metadata.loop ? "loops" : "no loop"}
                            {parent && ` · from "${parent.name}"`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            title="Download"
                            disabled={!url || savingClipId === asset.id}
                            onClick={() => void handleSaveClip(asset.id, asset.filePath, asset.name)}
                            className="text-slate-500 hover:text-accent-400 disabled:opacity-40"
                          >
                            <Download size={14} />
                          </button>
                          <button title="Delete" onClick={() => void handleDelete(asset.id)} className="text-slate-500 hover:text-red-400">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
