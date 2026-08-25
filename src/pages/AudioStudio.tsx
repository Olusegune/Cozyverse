import { useEffect, useMemo, useState } from "react";
import { FileAudio, ImagePlus, Mic2, Music, Settings2, Volume2, VolumeX, Waves, Wand2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import type { AudioKind } from "../lib/continuity";
import { connectedModelsFor, connectedProviders } from "../lib/providers/realGeneration";
import { MUSIC_GENRE_PRESETS, musicGenreById } from "../lib/musicalCozies";
import { modelById, type RegisteredModel } from "../lib/providers/modelRegistry";
import type { Asset, AssetType } from "../types";
import * as api from "../lib/api";
import { Slider } from "../components/Slider";

const MUSIC_MODEL_IDS = ["suno/v5", "cassetteai/music-generator"];
const DIALOGUE_MODEL_IDS = ["elevenlabs/tts", "minimax/speech-2.8-turbo"];

type Tab = "ambience" | "music" | "sfx" | "dialogue";

const TAB_META: Record<Tab, { label: string; icon: React.ElementType; assetType: AssetType; generatable: boolean; defaultDuration: number; maxDuration: number }> = {
  ambience: { label: "Ambience", icon: Waves, assetType: "audio", generatable: true, defaultDuration: 6, maxDuration: 15 },
  music: { label: "Music", icon: Music, assetType: "music", generatable: true, defaultDuration: 10, maxDuration: 20 },
  sfx: { label: "SFX", icon: FileAudio, assetType: "sfx", generatable: true, defaultDuration: 1.2, maxDuration: 2.5 },
  dialogue: { label: "Dialogue", icon: Mic2, assetType: "dialogue", generatable: false, defaultDuration: 0, maxDuration: 0 },
};

export function AudioStudioPage() {
  const project = useAppStore((state) => state.project);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const generateAudio = useAppStore((state) => state.generateAudio);
  const generateAudioAdvanced = useAppStore((state) => state.generateAudioAdvanced);
  const generateDialogue = useAppStore((state) => state.generateDialogue);
  const importImage = useAppStore((state) => state.importImage);
  const setAssetMetadata = useAppStore((state) => state.setAssetMetadata);
  const removeAsset = useAppStore((state) => state.removeAsset);
  const enqueueRender = useAppStore((state) => state.enqueueRender);

  const [tab, setTab] = useState<Tab>("ambience");
  const [customInstruction, setCustomInstruction] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(TAB_META.ambience.defaultDuration);
  const [loop, setLoop] = useState(true);
  const [dialogueText, setDialogueText] = useState("");
  const [genreId, setGenreId] = useState("");
  const [hasConnectedProvider, setHasConnectedProvider] = useState(false);
  const [hasFalProvider, setHasFalProvider] = useState(false);
  const [hasKieProvider, setHasKieProvider] = useState(false);
  const [useReal, setUseReal] = useState(false);
  const [modelOverrideId, setModelOverrideId] = useState("");
  const [audioModels, setAudioModels] = useState<RegisteredModel[]>([]);

  // --- Advanced Mode: full manual model pick + every provider-specific parameter ------------
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [advModelId, setAdvModelId] = useState("");
  const [advPrompt, setAdvPrompt] = useState("");
  const [advVoiceId, setAdvVoiceId] = useState("");
  const [advVoices, setAdvVoices] = useState<Array<{ voiceId: string; name: string }>>([]);
  const [advStability, setAdvStability] = useState(0.5);
  const [advSimilarity, setAdvSimilarity] = useState(0.75);
  const [advStyle, setAdvStyle] = useState(0);
  const [advLyrics, setAdvLyrics] = useState("");
  const [advCustomMode, setAdvCustomMode] = useState(false);
  const [advStyleTag, setAdvStyleTag] = useState("");
  const [advTitle, setAdvTitle] = useState("");
  const [advInstrumental, setAdvInstrumental] = useState(false);
  const [advDuration, setAdvDuration] = useState(10);
  const advModel = audioModels.find((model) => model.id === advModelId);

  useEffect(() => {
    void connectedProviders().then((set) => {
      setHasConnectedProvider(set.size > 0);
      setHasFalProvider(set.has("fal"));
      setHasKieProvider(set.has("kie"));
    });
    void Promise.all([connectedModelsFor("audio", false), connectedProviders()]).then(([models, providers]) => {
      // Suno v5 is deliberately kept OFF the "audio" capability in the registry so generic
      // auto-routing never picks it (Music always wants a full real song, not a short loop, which
      // audioModelForKind already handles explicitly) — but that same exclusion would otherwise
      // hide it from this manual picker too, where a user might explicitly want to select it.
      const suno = providers.has("kie") ? modelById("suno/v5") : undefined;
      const full = suno ? [...models, suno] : models;
      setAudioModels(full);
      setAdvModelId((current) => current || full[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    setModelOverrideId("");
  }, [tab]);

  useEffect(() => {
    if (advModel?.provider === "elevenlabs" && advVoices.length === 0) {
      void api.elevenLabsListVoices().then(setAdvVoices).catch(() => {});
    }
  }, [advModel?.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const musicModelOptions = audioModels.filter((model) => MUSIC_MODEL_IDS.includes(model.id));
  const dialogueModelOptions = audioModels.filter((model) => DIALOGUE_MODEL_IDS.includes(model.id));

  const meta = TAB_META[tab];
  const assets = useMemo(
    () => (project?.assets.filter((asset) => asset.type === meta.assetType) || []).slice().reverse(),
    [project?.assets, meta.assetType],
  );

  if (!project) return null;

  const changeTab = (next: Tab) => {
    setTab(next);
    setCustomInstruction("");
    setDurationSeconds(TAB_META[next].defaultDuration);
  };

  const handleGenerate = () => {
    const genre = tab === "music" ? musicGenreById(genreId) : undefined;
    enqueueRender(genre ? `${meta.label}: ${genre.label}` : meta.label, () =>
      generateAudio(tab as AudioKind, customInstruction, durationSeconds, loop, useReal, genre?.genreDescription, modelOverrideId || undefined),
    );
  };

  const advAssetType: AssetType = advModel?.provider === "elevenlabs" ? "dialogue" : advModel?.id === "suno/v5" ? "music" : advModel?.family === "CassetteAI" && advModel.id.includes("sound-effects") ? "sfx" : advModel?.family === "CassetteAI" ? "music" : "audio";

  const handleGenerateAdvanced = () => {
    if (!advModel) return;
    enqueueRender(`${advModel.label}: ${(advTitle || advPrompt || advLyrics).slice(0, 40)}`, () =>
      generateAudioAdvanced({
        modelId: advModel.id,
        assetType: advAssetType,
        prompt: advPrompt,
        voiceId: advModel.provider === "elevenlabs" ? advVoiceId || undefined : undefined,
        stability: advModel.provider === "elevenlabs" ? advStability : undefined,
        similarityBoost: advModel.provider === "elevenlabs" ? advSimilarity : undefined,
        style: advModel.provider === "elevenlabs" ? advStyle : undefined,
        lyrics: advModel.id === "suno/v5" && advCustomMode ? advLyrics : undefined,
        styleTag: advModel.id === "suno/v5" && advCustomMode ? advStyleTag : undefined,
        title: advModel.id === "suno/v5" && advCustomMode ? advTitle : undefined,
        instrumental: advModel.id === "suno/v5" ? advInstrumental : undefined,
        durationSeconds: advModel.id !== "suno/v5" ? advDuration : undefined,
      }),
    );
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Audio Studio</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">Ambience, music, and SFX generated from your World Bible's mood and weather — locally by default, or via a real provider. Dialogue is generated via a connected speech provider (ElevenLabs or WaveSpeed), or imported.</p>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1.5">
          {(Object.keys(TAB_META) as Tab[]).map((key) => {
            const Icon = TAB_META[key].icon;
            return (
              <button
                key={key}
                onClick={() => changeTab(key)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition ${tab === key ? "bg-accent-500 border-accent-500 text-accentText" : "border-base-600 text-slate-400 hover:text-white hover:border-base-500"}`}
              >
                <Icon size={13} /> {TAB_META[key].label}
              </button>
            );
          })}
        </div>
        <div className="flex rounded-lg border border-base-600 overflow-hidden text-xs">
          <button className={`flex items-center gap-1.5 px-4 py-2 ${mode === "simple" ? "bg-accent-500 text-accentText" : "text-slate-400 hover:text-white"}`} onClick={() => setMode("simple")}>
            <Wand2 size={13} /> Simple
          </button>
          <button className={`flex items-center gap-1.5 px-4 py-2 ${mode === "advanced" ? "bg-accent-500 text-accentText" : "text-slate-400 hover:text-white"}`} onClick={() => setMode("advanced")}>
            <Settings2 size={13} /> Advanced
          </button>
        </div>
      </div>

      {mode === "advanced" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
          <div className="rounded-xl border border-base-700 bg-base-900 p-4 h-fit space-y-4">
            {audioModels.length === 0 ? (
              <p className="text-xs text-slate-500">No connected provider supports audio generation yet — add an API key in Settings to use Advanced Mode.</p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Model</label>
                  <select
                    value={advModelId}
                    onChange={(event) => setAdvModelId(event.target.value)}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                  >
                    {audioModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>

                {!(advModel?.id === "suno/v5" && advCustomMode) && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">{advModel?.provider === "elevenlabs" ? "Line to speak" : "Prompt"}</label>
                    <textarea
                      rows={3}
                      value={advPrompt}
                      onChange={(event) => setAdvPrompt(event.target.value)}
                      placeholder="Describe the audio, or the line to speak…"
                      className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
                    />
                  </div>
                )}

                {advModel?.provider === "elevenlabs" && (
                  <>
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Voice</label>
                      <select
                        value={advVoiceId}
                        onChange={(event) => setAdvVoiceId(event.target.value)}
                        className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                      >
                        <option value="">Auto (first available)</option>
                        {advVoices.map((voice) => (
                          <option key={voice.voiceId} value={voice.voiceId}>
                            {voice.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Stability: {advStability.toFixed(2)}</label>
                      <Slider min={0} max={1} step={0.05} value={advStability} onChange={setAdvStability} className="w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Similarity Boost: {advSimilarity.toFixed(2)}</label>
                      <Slider min={0} max={1} step={0.05} value={advSimilarity} onChange={setAdvSimilarity} className="w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Style Exaggeration: {advStyle.toFixed(2)}</label>
                      <Slider min={0} max={1} step={0.05} value={advStyle} onChange={setAdvStyle} className="w-full" />
                    </div>
                  </>
                )}

                {advModel?.id === "suno/v5" && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input type="checkbox" checked={advCustomMode} onChange={(event) => setAdvCustomMode(event.target.checked)} />
                      Custom Mode (write your own lyrics)
                    </label>
                    {advCustomMode && (
                      <>
                        <div>
                          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Title</label>
                          <input
                            value={advTitle}
                            onChange={(event) => setAdvTitle(event.target.value)}
                            placeholder="Track title"
                            className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Style</label>
                          <input
                            value={advStyleTag}
                            onChange={(event) => setAdvStyleTag(event.target.value)}
                            placeholder="e.g. dreamy lofi hip-hop, female vocals"
                            className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Lyrics</label>
                          <textarea
                            rows={6}
                            value={advLyrics}
                            onChange={(event) => setAdvLyrics(event.target.value)}
                            placeholder={"[Verse 1]\n..."}
                            className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none font-mono"
                          />
                        </div>
                      </>
                    )}
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input type="checkbox" checked={advInstrumental} onChange={(event) => setAdvInstrumental(event.target.checked)} />
                      Instrumental (no vocals)
                    </label>
                  </>
                )}

                {advModel && advModel.id !== "suno/v5" && (
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Duration: {advDuration}s</label>
                    <Slider min={1} max={advModel.maxDurationSeconds ?? 30} value={advDuration} onChange={setAdvDuration} className="w-full" />
                  </div>
                )}

                <button
                  disabled={!advModel || (!advPrompt.trim() && !(advCustomMode && advLyrics.trim()))}
                  onClick={handleGenerateAdvanced}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
                >
                  <Wand2 size={16} /> Queue {advModel?.label || "Audio"}
                </button>
              </>
            )}
          </div>
          <div>
            {project.assets.filter((asset) => ["audio", "music", "sfx", "dialogue"].includes(asset.type)).length === 0 ? (
              <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
                <Waves className="mx-auto text-slate-600 mb-3" size={26} />
                <p className="text-slate-400">No audio yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {project.assets
                  .filter((asset) => ["audio", "music", "sfx", "dialogue"].includes(asset.type))
                  .slice()
                  .reverse()
                  .map((asset) => (
                    <AudioAssetRow key={asset.id} asset={asset} url={assetUrl(asset)} onMetadata={(patch) => void setAssetMetadata(asset.id, patch)} onDelete={() => void removeAsset(asset.id)} />
                  ))}
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <div className="rounded-xl border border-base-700 bg-base-900 p-4 h-fit space-y-4">
          {meta.generatable ? (
            <>
              {tab === "music" && (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Musical Cozy Genre</label>
                  <select
                    value={genreId}
                    onChange={(event) => setGenreId(event.target.value)}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                  >
                    <option value="">None (World Bible mood)</option>
                    {MUSIC_GENRE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  {genreId && <p className="text-[11px] text-slate-500 mt-1.5">{musicGenreById(genreId)?.genreDescription}</p>}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">
                  {tab === "sfx" ? "Describe the sound" : "Additional Instructions"}
                </label>
                <textarea
                  rows={3}
                  value={customInstruction}
                  onChange={(event) => setCustomInstruction(event.target.value)}
                  placeholder={tab === "ambience" ? "e.g. distant traffic, wind chimes" : tab === "music" ? "e.g. slow piano, warm strings" : "e.g. a soft door creak"}
                  className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Duration: {durationSeconds}s</label>
                <Slider
                  min={tab === "sfx" ? 0.4 : tab === "music" ? 10 : 2}
                  max={meta.maxDuration}
                  step={tab === "sfx" ? 0.1 : 1}
                  value={durationSeconds}
                  onChange={setDurationSeconds}
                  className="w-full"
                />
                {tab === "music" && useReal && hasKieProvider && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    A KIE AI (Suno) key is connected — Music will generate a full real song at Suno's own length, ignoring this slider.
                  </p>
                )}
              </div>
              {tab !== "sfx" && (
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
                  Loop this clip in playback
                </label>
              )}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Rendering</label>
                <div className="flex rounded-lg border border-base-600 overflow-hidden text-xs">
                  <button className={`flex-1 py-1.5 ${!useReal ? "bg-accent-500 text-accentText" : "text-slate-400"}`} onClick={() => setUseReal(false)}>
                    Mock (local, free)
                  </button>
                  <button
                    className={`flex-1 py-1.5 ${useReal ? "bg-accent-500 text-accentText" : "text-slate-400"} ${!(hasFalProvider || (tab === "music" && hasKieProvider)) ? "opacity-50" : ""}`}
                    onClick={() => setUseReal(true)}
                    title={hasFalProvider || (tab === "music" && hasKieProvider) ? undefined : "Add a fal.ai API key in Settings first"}
                  >
                    Auto (connected provider)
                  </button>
                </div>
                {useReal && !(hasFalProvider || (tab === "music" && hasKieProvider)) && (
                  <p className="text-[11px] text-yellow-500 mt-1">
                    No provider connected — add a fal.ai key{tab === "music" ? ", or a KIE AI key for Suno," : ""} in Settings.
                  </p>
                )}
              </div>
              {tab === "music" && useReal && musicModelOptions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Model</label>
                  <select
                    value={modelOverrideId}
                    onChange={(event) => setModelOverrideId(event.target.value)}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                  >
                    <option value="">Auto (best match)</option>
                    {musicModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                disabled={useReal && !(hasFalProvider || (tab === "music" && hasKieProvider))}
                onClick={handleGenerate}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
              >
                <Wand2 size={16} /> Queue {meta.label}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Line to speak</label>
                <textarea
                  rows={3}
                  value={dialogueText}
                  onChange={(event) => setDialogueText(event.target.value)}
                  placeholder="The rain finally stopped."
                  className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500 resize-none"
                />
                <p className="text-[11px] text-slate-500 mt-1.5">
                  For multiple speakers, one line each: <code className="text-slate-400">Speaker 1 (Female): "line"</code> — each
                  gets its own clip in a distinct voice.
                </p>
              </div>
              {!hasConnectedProvider && (
                <p className="text-[11px] text-yellow-500">No speech provider connected — add an ElevenLabs (best voices) or WaveSpeed API key in Settings to generate dialogue.</p>
              )}
              {dialogueModelOptions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Model</label>
                  <select
                    value={modelOverrideId}
                    onChange={(event) => setModelOverrideId(event.target.value)}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                  >
                    <option value="">Auto (best match)</option>
                    {dialogueModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                disabled={!dialogueText.trim() || !hasConnectedProvider}
                onClick={() => {
                  const line = dialogueText;
                  const model = modelOverrideId || undefined;
                  enqueueRender(`Dialogue: ${line.slice(0, 40)}`, () => generateDialogue(line, model));
                }}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
              >
                <Wand2 size={16} /> Queue Dialogue
              </button>
            </div>
          )}
          <button
            onClick={() => void importImage(meta.assetType)}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-base-600 hover:border-accent-500 text-slate-300 hover:text-white px-4 py-2.5 text-sm transition"
          >
            <ImagePlus size={16} /> Import {meta.label}
          </button>
        </div>

        <div>
          {assets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
              <meta.icon className="mx-auto text-slate-600 mb-3" size={26} />
              <p className="text-slate-400">No {meta.label.toLowerCase()} yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assets.map((asset) => (
                <AudioAssetRow key={asset.id} asset={asset} url={assetUrl(asset)} onMetadata={(patch) => void setAssetMetadata(asset.id, patch)} onDelete={() => void removeAsset(asset.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function AudioAssetRow({ asset, url, onMetadata, onDelete }: { asset: Asset; url: string | undefined; onMetadata: (patch: Record<string, unknown>) => void; onDelete: () => void }) {
  const volume = typeof asset.metadata.volume === "number" ? asset.metadata.volume : 0.8;
  const muted = Boolean(asset.metadata.muted);
  const loop = Boolean(asset.metadata.loop);

  return (
    <div className="rounded-xl border border-base-700 bg-base-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-white truncate pr-4">{asset.name}</p>
        <button onClick={onDelete} className="text-xs text-slate-500 hover:text-red-400 shrink-0">
          Delete
        </button>
      </div>
      {url ? (
        <audio src={url} controls loop={loop} muted={muted} className="w-full h-9" ref={(element) => { if (element) element.volume = volume; }} />
      ) : (
        <p className="text-xs text-slate-500">Loading…</p>
      )}
      <div className="flex items-center gap-4 mt-3">
        <button onClick={() => onMetadata({ muted: !muted })} className="text-slate-400 hover:text-white">
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <Slider min={0} max={1} step={0.05} value={volume} onChange={(value) => onMetadata({ volume: value })} className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
          <input type="checkbox" checked={loop} onChange={(event) => onMetadata({ loop: event.target.checked })} />
          Loop
        </label>
      </div>
    </div>
  );
}
