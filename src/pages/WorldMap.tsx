import { useMemo } from "react";
import { ArrowRight, Clapperboard, Film, ListVideo, Music, Waves } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { pickBackgroundForControls } from "../lib/sceneMatching";
import type { Scene } from "../types";

/** A visual overview of the whole Cozyverse — every scene as a floating diorama tile you can see
 * at a glance, instead of clicking into Scene Composer one scene at a time. This is the "look at my
 * whole world" moment the app was missing: a project list and a single-scene editor, but nothing
 * that showed the world as a world. Reuses the exact same background-resolution logic every other
 * page already relies on (pickBackgroundForControls) so a tile's thumbnail always matches what
 * Scene Composer's own Live Preview would show for that scene right now. */
export function WorldMapPage({ onOpenScene }: { onOpenScene: (sceneId: string) => void }) {
  const project = useAppStore((state) => state.project);
  const assetUrl = useAppStore((state) => state.assetUrl);

  const sceneBackground = (scene: Scene) => {
    if (!project) return undefined;
    const controls: Record<string, string> = { weather: "Clear", timeOfDay: "Day", lighting: "Natural" };
    for (const control of scene.controls) {
      if (control.target === "weather" || control.target === "time" || control.target === "lighting") {
        controls[control.target === "time" ? "timeOfDay" : control.target] = String(control.value);
      }
    }
    return pickBackgroundForControls(project.assets, project.generations, { weather: controls.weather, timeOfDay: controls.timeOfDay, lighting: controls.lighting }, scene.backgroundAssetId);
  };

  const timelineScenes = useMemo(() => {
    if (!project) return [];
    return project.timeline.map((shot) => project.scenes.find((scene) => scene.id === shot.sceneId)).filter((scene): scene is Scene => Boolean(scene));
  }, [project]);

  if (!project) return null;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">World Map</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">Every scene in {project.metadata.name}, at a glance. Click one to open it in Scene Composer.</p>
      </div>

      {timelineScenes.length > 0 && (
        <div className="mb-8">
          <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">
            <ListVideo size={13} /> Story Order
          </h2>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {timelineScenes.map((scene, index) => {
              const background = sceneBackground(scene);
              const thumb = background ? assetUrl(background) : undefined;
              return (
                <div key={`${scene.id}-${index}`} className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onOpenScene(scene.id)}
                    className="group relative w-28 aspect-video rounded-lg overflow-hidden border border-base-700 hover:border-accent-500 transition shrink-0"
                    title={scene.name}
                  >
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-base-800 flex items-center justify-center">
                        <Clapperboard className="text-slate-600" size={16} />
                      </div>
                    )}
                    <span className="absolute top-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded-full font-medium">{index + 1}</span>
                  </button>
                  {index < timelineScenes.length - 1 && <ArrowRight size={14} className="text-slate-600 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {project.scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <Clapperboard className="mx-auto text-slate-600 mb-3" size={28} />
          <p className="text-slate-400">No scenes yet — build one in Scene Composer to see your world take shape here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-6">
          {project.scenes.map((scene) => {
            const background = sceneBackground(scene);
            const thumb = background ? assetUrl(background) : undefined;
            return (
              <button
                key={scene.id}
                onClick={() => onOpenScene(scene.id)}
                className="group relative rounded-2xl overflow-hidden border border-base-700 bg-base-900 text-left transition hover:-translate-y-1 hover:border-accent-500/60 hover:shadow-[0_12px_32px_-8px_rgba(224,160,52,0.25)]"
              >
                <div className="aspect-video bg-base-800 relative overflow-hidden">
                  {thumb ? (
                    <img src={thumb} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Clapperboard className="text-slate-600" size={24} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <p className="absolute bottom-2 left-3 right-3 text-sm font-medium text-white truncate">{scene.name}</p>
                </div>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <LayerDot icon={Film} filled={Boolean(scene.motionAssetId)} label="Motion" />
                  <LayerDot icon={Waves} filled={Boolean(scene.ambienceAssetId)} label="Ambience" />
                  <LayerDot icon={Music} filled={Boolean(scene.musicAssetId)} label="Music" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LayerDot({ icon: Icon, filled, label }: { icon: React.ElementType; filled: boolean; label: string }) {
  return (
    <span title={filled ? label : `No ${label.toLowerCase()} yet`} className={`flex items-center gap-1 text-[10px] ${filled ? "text-accent-400" : "text-slate-600"}`}>
      <Icon size={11} />
    </span>
  );
}
