import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Clock, Download, Film, Music, Plus, Trash2, Video, Volume2, Waves } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { pickBackgroundForControls } from "../lib/sceneMatching";
import type { Scene } from "../types";
import * as api from "../lib/api";
import { RenderErrorMessage } from "../components/RenderErrorMessage";
import { Slider } from "../components/Slider";
import { LIGHTING_OPTIONS, TIME_OPTIONS, WEATHER_OPTIONS } from "../lib/sceneOptions";

export function SceneComposerPage() {
  const project = useAppStore((state) => state.project);
  const dirName = useAppStore((state) => state.dirName);
  const activeSceneId = useAppStore((state) => state.activeSceneId);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const ensureScene = useAppStore((state) => state.ensureScene);
  const setActiveScene = useAppStore((state) => state.setActiveScene);
  const addScene = useAppStore((state) => state.addScene);
  const removeScene = useAppStore((state) => state.removeScene);
  const updateScene = useAppStore((state) => state.updateScene);
  const setSceneControlValue = useAppStore((state) => state.setSceneControlValue);

  const [addingScene, setAddingScene] = useState(false);
  const [draftName, setDraftName] = useState("");

  // --- Tier 1 video export: render the active scene into a standalone .mp4 -------------------
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const [renderDuration, setRenderDuration] = useState(8);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedPath, setRenderedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void ensureScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.metadata.id]);

  useEffect(() => {
    void api.ffmpegAvailable().then(setFfmpegOk);
  }, []);

  const scene = project?.scenes.find((existing) => existing.id === activeSceneId);

  const imageAssets = useMemo(() => project?.assets.filter((asset) => asset.type === "image") || [], [project?.assets]);
  const videoAssets = useMemo(() => project?.assets.filter((asset) => asset.type === "video") || [], [project?.assets]);
  const ambienceAssets = useMemo(() => project?.assets.filter((asset) => asset.type === "audio") || [], [project?.assets]);
  const musicAssets = useMemo(() => project?.assets.filter((asset) => asset.type === "music") || [], [project?.assets]);
  const sfxAssets = useMemo(() => project?.assets.filter((asset) => asset.type === "sfx") || [], [project?.assets]);

  const controlValues = useMemo(() => {
    const values: Record<string, string> = { time: "Day", lighting: "Natural", weather: "Clear" };
    for (const control of scene?.controls || []) {
      if (control.target === "time" || control.target === "lighting" || control.target === "weather") values[control.target] = String(control.value);
    }
    return values;
  }, [scene?.controls]);

  const previewAsset = useMemo(() => {
    if (!project || !scene) return undefined;
    return pickBackgroundForControls(
      project.assets,
      project.generations,
      { weather: controlValues.weather, timeOfDay: controlValues.time, lighting: controlValues.lighting },
      scene.backgroundAssetId,
    );
  }, [project, scene, controlValues]);

  if (!project) return null;

  const submitAddScene = async () => {
    await addScene(draftName);
    setAddingScene(false);
    setDraftName("");
  };

  const patch = (fields: Partial<Scene>) => scene && void updateScene(scene.id, fields);

  const handleRenderVideo = async () => {
    if (!scene || !dirName) return;
    const motionAsset = scene.motionAssetId ? videoAssets.find((asset) => asset.id === scene.motionAssetId) : undefined;
    const ambienceAsset = scene.ambienceAssetId ? ambienceAssets.find((asset) => asset.id === scene.ambienceAssetId) : undefined;
    const musicAsset = scene.musicAssetId ? musicAssets.find((asset) => asset.id === scene.musicAssetId) : undefined;
    const ambienceVolumePercent = Number(scene.controls.find((control) => control.target === "ambienceVolume")?.value ?? 70);
    const musicVolumePercent = Number(scene.controls.find((control) => control.target === "musicVolume")?.value ?? 50);

    setRendering(true);
    setRenderError(null);
    setRenderedPath(null);
    try {
      const path = await api.renderSceneVideo({
        dirName,
        sceneName: scene.name,
        backgroundRelPath: previewAsset?.filePath,
        motionRelPath: motionAsset?.filePath,
        ambienceRelPath: ambienceAsset?.filePath,
        ambienceVolume: ambienceVolumePercent / 100,
        musicRelPath: musicAsset?.filePath,
        musicVolume: musicVolumePercent / 100,
        durationSeconds: renderDuration,
      });
      setRenderedPath(path);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
    } finally {
      setRendering(false);
    }
  };

  const handleSaveCopy = async () => {
    if (!renderedPath || !scene) return;
    setSaving(true);
    try {
      await api.saveVideoCopy(renderedPath, `${scene.name || "scene"}.mp4`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Scene Composer</h1>
          <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
          <p className="text-sm text-slate-400 mt-1">Attach layers and set the default environmental state. Controls swap between your own generated variants — nothing regenerates live.</p>
        </div>
        <button onClick={() => setAddingScene(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500">
          <Plus size={13} /> New Scene
        </button>
      </div>

      <div className="flex items-center gap-1.5 mb-6 flex-wrap">
        {project.scenes.map((existing) => (
          <button
            key={existing.id}
            onClick={() => setActiveScene(existing.id)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${existing.id === activeSceneId ? "bg-accent-500 border-accent-500 text-accentText" : "border-base-600 text-slate-400 hover:text-white hover:border-base-500"}`}
          >
            {existing.name}
          </button>
        ))}
        {addingScene && (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void submitAddScene()}
              placeholder="Scene name"
              className="bg-base-800 border border-base-600 rounded-md px-2 py-1 text-xs text-white outline-none focus:border-accent-500"
            />
            <button onClick={() => void submitAddScene()} className="text-xs text-accent-400 hover:text-accent-500">
              Add
            </button>
          </div>
        )}
      </div>

      {!scene ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <Clapperboard className="mx-auto text-slate-600 mb-3" size={28} />
          <p className="text-slate-400">Generate a master image first — a scene needs a background layer.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-5">
            <div className="rounded-xl border border-base-700 bg-base-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <input
                  value={scene.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  className="bg-transparent text-white font-medium text-sm outline-none border-b border-transparent focus:border-base-600"
                />
                {project.scenes.length > 1 && (
                  <button onClick={() => void removeScene(scene.id)} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1">
                    <Trash2 size={12} /> Delete Scene
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <LayerPicker
                  icon={Clapperboard}
                  label="Background"
                  value={scene.backgroundAssetId}
                  options={imageAssets}
                  onChange={(value) => patch({ backgroundAssetId: value || undefined })}
                  preview={scene.backgroundAssetId ? assetUrl(imageAssets.find((asset) => asset.id === scene.backgroundAssetId)!) : undefined}
                />
                <LayerPicker
                  icon={Film}
                  label="Motion Layer"
                  value={scene.motionAssetId}
                  options={videoAssets}
                  allowNone
                  onChange={(value) => patch({ motionAssetId: value || undefined })}
                />
                <LayerPicker
                  icon={Waves}
                  label="Ambience"
                  value={scene.ambienceAssetId}
                  options={ambienceAssets}
                  allowNone
                  onChange={(value) => patch({ ambienceAssetId: value || undefined })}
                />
                <LayerPicker
                  icon={Music}
                  label="Music"
                  value={scene.musicAssetId}
                  options={musicAssets}
                  allowNone
                  onChange={(value) => patch({ musicAssetId: value || undefined })}
                />
              </div>

              {sfxAssets.length > 0 && (
                <div className="mt-4">
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">SFX Available in Scene</label>
                  <div className="flex flex-wrap gap-2">
                    {sfxAssets.map((asset) => {
                      const checked = scene.sfxAssetIds.includes(asset.id);
                      return (
                        <label key={asset.id} className="flex items-center gap-1.5 text-xs text-slate-300 bg-base-800 border border-base-600 rounded-full px-2.5 py-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              patch({ sfxAssetIds: event.target.checked ? [...scene.sfxAssetIds, asset.id] : scene.sfxAssetIds.filter((id) => id !== asset.id) })
                            }
                          />
                          {asset.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-base-700 bg-base-900 p-4">
              <h3 className="text-sm font-medium text-white mb-3">Environmental Controls</h3>
              <div className="grid grid-cols-2 gap-4">
                {scene.controls.map((control) => (
                  <div key={control.id}>
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">{control.label}</label>
                    {control.kind === "select" ? (
                      <select
                        value={String(control.value)}
                        onChange={(event) => void setSceneControlValue(scene.id, control.id, event.target.value)}
                        className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
                      >
                        {(control.target === "time" ? TIME_OPTIONS : control.target === "lighting" ? LIGHTING_OPTIONS : WEATHER_OPTIONS).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Slider
                          min={control.min ?? 0}
                          max={control.max ?? 100}
                          value={Number(control.value)}
                          onChange={(value) => void setSceneControlValue(scene.id, control.id, value)}
                          className="flex-1"
                        />
                        <span className="text-xs text-slate-400 w-8 text-right">{String(control.value)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-base-700 bg-base-900 p-4 h-fit sticky top-4">
            <h3 className="text-sm font-medium text-white mb-3">Live Preview</h3>
            <div className="aspect-video rounded-lg bg-base-800 overflow-hidden flex items-center justify-center">
              {previewAsset && assetUrl(previewAsset) ? (
                <img src={assetUrl(previewAsset)} alt="" className="w-full h-full object-cover" />
              ) : (
                <Clapperboard className="text-slate-600" size={28} />
              )}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {previewAsset ? `Showing "${previewAsset.name}"` : "No matching background yet"}
              {previewAsset && previewAsset.id !== scene.backgroundAssetId && " (auto-matched to current controls)"}
            </p>
            <div className="mt-3 space-y-1.5 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <Film size={12} /> {scene.motionAssetId ? videoAssets.find((a) => a.id === scene.motionAssetId)?.name : "No motion layer"}
              </div>
              <div className="flex items-center gap-1.5">
                <Waves size={12} /> {scene.ambienceAssetId ? ambienceAssets.find((a) => a.id === scene.ambienceAssetId)?.name : "No ambience"}
              </div>
              <div className="flex items-center gap-1.5">
                <Music size={12} /> {scene.musicAssetId ? musicAssets.find((a) => a.id === scene.musicAssetId)?.name : "No music"}
              </div>
              <div className="flex items-center gap-1.5">
                <Volume2 size={12} /> Ambience {controlValues.time && scene.controls.find((c) => c.target === "ambienceVolume")?.value}% · Music{" "}
                {scene.controls.find((c) => c.target === "musicVolume")?.value}%
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-base-700">
              <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Render Video</h4>
              {ffmpegOk === false ? (
                <p className="text-[11px] text-yellow-500">
                  ffmpeg wasn't found on this system — install it (e.g. <code className="text-yellow-400">winget install ffmpeg</code>) to render scenes to video.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2.5">
                    <Clock size={12} className="text-slate-500 shrink-0" />
                    <Slider min={2} max={30} value={renderDuration} onChange={setRenderDuration} className="flex-1" />
                    <span className="text-xs text-slate-400 w-8 text-right shrink-0">{renderDuration}s</span>
                  </div>
                  <button
                    disabled={rendering || ffmpegOk === null || (!previewAsset && !scene.motionAssetId)}
                    onClick={() => void handleRenderVideo()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
                  >
                    <Video size={16} /> {rendering ? "Rendering…" : "Render Video"}
                  </button>
                  {renderError && <RenderErrorMessage message={renderError} />}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {renderedPath && (
        <div className="mt-6 rounded-xl border border-accent-500/40 bg-base-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white">Rendered Video</h3>
            <div className="flex items-center gap-3">
              <button
                disabled={saving}
                onClick={() => void handleSaveCopy()}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-accentText font-medium transition"
              >
                <Download size={13} /> {saving ? "Saving…" : "Download"}
              </button>
              <button onClick={() => void api.revealInExplorer(renderedPath)} className="text-xs text-slate-400 hover:text-white underline">
                Show in folder
              </button>
            </div>
          </div>
          <video src={api.localFileUrl(renderedPath)} controls autoPlay className="w-full max-h-[70vh] rounded-lg border border-base-700 bg-black" />
        </div>
      )}
    </div>
  );
}

function LayerPicker({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  allowNone,
  preview,
}: {
  icon: React.ElementType;
  label: string;
  value: string | undefined;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
  allowNone?: boolean;
  preview?: string;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">
        <Icon size={12} /> {label}
      </label>
      <select
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
      >
        {(allowNone || options.length === 0) && <option value="">None</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {preview && <img src={preview} alt="" className="w-full rounded-md border border-base-700 mt-2 aspect-video object-cover" />}
    </div>
  );
}
