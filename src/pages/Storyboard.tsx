import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Clapperboard, Download, Film, Plus, Trash2, Video } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { pickBackgroundForControls } from "../lib/sceneMatching";
import * as api from "../lib/api";
import type { TimelineShotRenderInput } from "../lib/api";
import { RenderErrorMessage } from "../components/RenderErrorMessage";
import { Slider } from "../components/Slider";
import { ReelContinuityCheck } from "../components/ReelContinuityCheck";
import { projectCharacters, type Scene } from "../types";

export function StoryboardPage() {
  const project = useAppStore((state) => state.project);
  const dirName = useAppStore((state) => state.dirName);
  const addTimelineShot = useAppStore((state) => state.addTimelineShot);
  const removeTimelineShot = useAppStore((state) => state.removeTimelineShot);
  const moveTimelineShot = useAppStore((state) => state.moveTimelineShot);
  const setTimelineShotDuration = useAppStore((state) => state.setTimelineShotDuration);
  const assetUrl = useAppStore((state) => state.assetUrl);

  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedPath, setRenderedPath] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<{ step: number; totalSteps: number; label: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.ffmpegAvailable().then(setFfmpegOk);
  }, []);

  if (!project) return null;

  const totalDuration = project.timeline.reduce((sum, shot) => sum + shot.durationSeconds, 0);

  // Same resolution logic as Scene Composer's own Live Preview — a scene's "current" background
  // is whatever pickBackgroundForControls picks for its own default controls, not necessarily the
  // literal backgroundAssetId (which pickBackgroundForControls still honors as its fallback).
  const sceneBackground = (scene: Scene | undefined) => {
    if (!scene) return undefined;
    const controls: Record<string, string> = { weather: "Clear", timeOfDay: "Day", lighting: "Natural" };
    for (const control of scene.controls) {
      if (control.target === "weather" || control.target === "time" || control.target === "lighting") {
        controls[control.target === "time" ? "timeOfDay" : control.target] = String(control.value);
      }
    }
    return pickBackgroundForControls(project.assets, project.generations, { weather: controls.weather, timeOfDay: controls.timeOfDay, lighting: controls.lighting }, scene.backgroundAssetId);
  };

  // Each timeline shot's scene, resolved down to "what prompt actually produced its background" —
  // the input the reel-wide continuity check compares across scenes. A scene with no background yet
  // (or one imported rather than generated, with no generationId to trace back to) simply
  // contributes an empty prompt, which the check itself filters out rather than guessing at one.
  const reelScenes = project.timeline.map((shot) => {
    const scene = project.scenes.find((existing) => existing.id === shot.sceneId);
    const background = sceneBackground(scene);
    const generation = background?.generationId ? project.generations.find((job) => job.id === background.generationId) : undefined;
    return { sceneName: scene?.name || "Deleted scene", prompt: generation?.prompt || "" };
  });

  const handleRender = async () => {
    if (!dirName || project.timeline.length === 0) return;
    setRendering(true);
    setRenderError(null);
    setRenderedPath(null);
    const totalSteps = project.timeline.length + 1; // one step per shot, plus the final stitch
    try {
      const shots: TimelineShotRenderInput[] = project.timeline.map((shot) => {
        const scene = project.scenes.find((existing) => existing.id === shot.sceneId);
        const background = sceneBackground(scene);
        const motion = scene?.motionAssetId ? project.assets.find((asset) => asset.id === scene.motionAssetId) : undefined;
        const ambience = scene?.ambienceAssetId ? project.assets.find((asset) => asset.id === scene.ambienceAssetId) : undefined;
        const music = scene?.musicAssetId ? project.assets.find((asset) => asset.id === scene.musicAssetId) : undefined;
        const ambienceVolume = Number(scene?.controls.find((control) => control.target === "ambienceVolume")?.value ?? 70);
        const musicVolume = Number(scene?.controls.find((control) => control.target === "musicVolume")?.value ?? 50);
        return {
          backgroundRelPath: background?.filePath,
          motionRelPath: motion?.filePath,
          ambienceRelPath: ambience?.filePath,
          ambienceVolume: ambienceVolume / 100,
          musicRelPath: music?.filePath,
          musicVolume: musicVolume / 100,
          durationSeconds: shot.durationSeconds,
        };
      });

      const session = crypto.randomUUID();
      for (const [index, shot] of shots.entries()) {
        const sceneName = project.scenes.find((existing) => existing.id === project.timeline[index]?.sceneId)?.name || `Shot ${index + 1}`;
        setRenderProgress({ step: index + 1, totalSteps, label: `Rendering "${sceneName}" (shot ${index + 1} of ${shots.length})` });
        await api.renderTimelineShot(dirName, session, index, shot);
      }
      setRenderProgress({ step: totalSteps, totalSteps, label: "Stitching shots together…" });
      const path = await api.finishTimelineRender(dirName, session, shots.length);
      setRenderedPath(path);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
    } finally {
      setRendering(false);
      setRenderProgress(null);
    }
  };

  const handleSaveCopy = async () => {
    if (!renderedPath) return;
    setSaving(true);
    try {
      await api.saveVideoCopy(renderedPath, `${project.metadata.name || "story-reel"}.mp4`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Storyboard</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">
          Order your scenes into a story reel. Each shot renders like Scene Composer's own video export, then gets cut together in order — no transitions yet, just clean cuts.
        </p>
      </div>

      {project.scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <Clapperboard className="mx-auto text-slate-600 mb-3" size={28} />
          <p className="text-slate-400">Build a scene in Scene Composer first — the storyboard is made of scenes.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <div className="space-y-3">
              {project.timeline.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-600 p-12 text-center">
                  <Film className="mx-auto text-slate-600 mb-3" size={26} />
                  <p className="text-slate-400">No shots yet — add a scene from the right to start your reel.</p>
                </div>
              ) : (
                project.timeline.map((shot, index) => {
                  const scene = project.scenes.find((existing) => existing.id === shot.sceneId);
                  const background = sceneBackground(scene);
                  const thumb = background ? assetUrl(background) : undefined;
                  return (
                    <div key={shot.id} className="flex items-center gap-3 rounded-xl border border-base-700 bg-base-900 p-3">
                      <span className="text-xs text-slate-500 w-5 text-center shrink-0">{index + 1}</span>
                      <div className="w-24 aspect-video rounded-md bg-base-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <Clapperboard className="text-slate-600" size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{scene?.name || "Deleted scene"}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Slider min={2} max={30} value={shot.durationSeconds} onChange={(value) => void setTimelineShotDuration(shot.id, value)} className="flex-1" />
                          <span className="text-xs text-slate-400 w-8 text-right shrink-0">{shot.durationSeconds}s</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          disabled={index === 0}
                          onClick={() => void moveTimelineShot(shot.id, "up")}
                          className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          disabled={index === project.timeline.length - 1}
                          onClick={() => void moveTimelineShot(shot.id, "down")}
                          className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                      <button onClick={() => void removeTimelineShot(shot.id)} className="text-slate-500 hover:text-red-400 shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-5">
              <div className="rounded-xl border border-base-700 bg-base-900 p-4">
                <h3 className="text-sm font-medium text-white mb-3">Add Scene</h3>
                <div className="space-y-1.5">
                  {project.scenes.map((scene) => (
                    <button
                      key={scene.id}
                      onClick={() => void addTimelineShot(scene.id)}
                      className="w-full flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 transition text-left"
                    >
                      <Plus size={13} className="shrink-0" /> {scene.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-base-700 bg-base-900 p-4">
                <h3 className="text-sm font-medium text-white mb-1">Render Story Reel</h3>
                <p className="text-xs text-slate-500 mb-3">
                  {project.timeline.length} shot{project.timeline.length === 1 ? "" : "s"} · {totalDuration}s total
                </p>
                {ffmpegOk === false ? (
                  <p className="text-[11px] text-yellow-500">
                    ffmpeg wasn't found on this system — install it (e.g. <code className="text-yellow-400">winget install ffmpeg</code>) to render.
                  </p>
                ) : (
                  <>
                    <button
                      disabled={rendering || ffmpegOk === null || project.timeline.length === 0}
                      onClick={() => void handleRender()}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
                    >
                      <Video size={16} /> {rendering ? "Rendering…" : "Render Story Reel"}
                    </button>
                    {rendering && renderProgress && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-full bg-base-700 overflow-hidden">
                          <div
                            className="h-full bg-accent-500 transition-all duration-300"
                            style={{ width: `${(renderProgress.step / renderProgress.totalSteps) * 100}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5">{renderProgress.label}</p>
                      </div>
                    )}
                    {renderError && <RenderErrorMessage message={renderError} />}
                  </>
                )}
              </div>

              <ReelContinuityCheck scenes={reelScenes} characters={projectCharacters(project)} worldBible={project.worldBible} />
            </div>
          </div>

          {renderedPath && (
            <div className="mt-6 rounded-xl border border-accent-500/40 bg-base-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white">Your Story Reel</h3>
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
        </>
      )}
    </div>
  );
}
