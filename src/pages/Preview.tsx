import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX, X, ChevronUp, ChevronDown } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { pickBackgroundForControls } from "../lib/sceneMatching";
import { Slider } from "../components/Slider";

const TIME_OPTIONS = ["Morning", "Day", "Sunset", "Night"];
const LIGHTING_OPTIONS = ["Natural", "Warm", "Cool", "Dramatic", "Soft"];
const WEATHER_OPTIONS = ["Clear", "Rain", "Snow", "Fog", "Overcast", "Storm"];

export function PreviewPage({ onExit }: { onExit: () => void }) {
  const project = useAppStore((state) => state.project);
  const activeSceneId = useAppStore((state) => state.activeSceneId);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const ensureScene = useAppStore((state) => state.ensureScene);

  useEffect(() => {
    void ensureScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.metadata.id]);

  const scene = project?.scenes.find((existing) => existing.id === activeSceneId);

  const [time, setTime] = useState("Day");
  const [lighting, setLighting] = useState("Natural");
  const [weather, setWeather] = useState("Clear");
  const [ambienceVolume, setAmbienceVolume] = useState(70);
  const [musicVolume, setMusicVolume] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!scene) return;
    for (const control of scene.controls) {
      if (control.target === "time") setTime(String(control.value));
      if (control.target === "lighting") setLighting(String(control.value));
      if (control.target === "weather") setWeather(String(control.value));
      if (control.target === "ambienceVolume") setAmbienceVolume(Number(control.value));
      if (control.target === "musicVolume") setMusicVolume(Number(control.value));
    }
  }, [scene?.id]);

  const containerRef = useRef<HTMLDivElement>(null);
  const ambienceRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);

  const backgroundAsset = useMemo(() => {
    if (!project || !scene) return undefined;
    return pickBackgroundForControls(project.assets, project.generations, { weather, timeOfDay: time, lighting }, scene.backgroundAssetId);
  }, [project, scene, weather, time, lighting]);

  const motionAsset = scene?.motionAssetId ? project?.assets.find((asset) => asset.id === scene.motionAssetId) : undefined;
  const ambienceAsset = scene?.ambienceAssetId ? project?.assets.find((asset) => asset.id === scene.ambienceAssetId) : undefined;
  const musicAsset = scene?.musicAssetId ? project?.assets.find((asset) => asset.id === scene.musicAssetId) : undefined;
  const sfxAssets = useMemo(() => project?.assets.filter((asset) => scene?.sfxAssetIds.includes(asset.id)) || [], [project?.assets, scene?.sfxAssetIds]);

  useEffect(() => {
    if (ambienceRef.current) ambienceRef.current.volume = ambienceVolume / 100;
  }, [ambienceVolume]);
  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = musicVolume / 100;
  }, [musicVolume]);

  const togglePlaying = () => {
    if (playing) {
      ambienceRef.current?.pause();
      musicRef.current?.pause();
      setPlaying(false);
    } else {
      void ambienceRef.current?.play();
      void musicRef.current?.play();
      setPlaying(true);
    }
  };

  const playSfx = (url: string | undefined) => {
    if (!url) return;
    const clip = new Audio(url);
    void clip.play();
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  if (!project || !scene) {
    return (
      <div className="fixed inset-0 bg-base-950 flex items-center justify-center text-slate-400">
        <p>Nothing to preview yet — generate a master image and build a scene first.</p>
      </div>
    );
  }

  const backgroundUrl = backgroundAsset ? assetUrl(backgroundAsset) : undefined;
  const motionUrl = motionAsset ? assetUrl(motionAsset) : undefined;
  const ambienceUrl = ambienceAsset ? assetUrl(ambienceAsset) : undefined;
  const musicUrl = musicAsset ? assetUrl(musicAsset) : undefined;

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black overflow-hidden select-none">
      {ambienceUrl && <audio ref={ambienceRef} src={ambienceUrl} loop muted={Boolean(ambienceAsset?.metadata.muted)} className="hidden" />}
      {musicUrl && <audio ref={musicRef} src={musicUrl} loop muted={Boolean(musicAsset?.metadata.muted)} className="hidden" />}

      <div className="absolute inset-0">
        {motionUrl ? (
          <video src={motionUrl} autoPlay loop muted className="w-full h-full object-cover" />
        ) : backgroundUrl ? (
          <img src={backgroundUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-500">No background set for this scene.</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />
      </div>

      <button onClick={onExit} className="absolute top-4 right-4 flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-black/40 rounded-full px-3 py-1.5">
        <X size={14} /> Exit Preview
      </button>

      {!controlsHidden ? (
        <div className="absolute bottom-0 left-0 right-0 p-6">
          <div className="max-w-2xl mx-auto rounded-2xl bg-black/50 backdrop-blur-sm border border-white/10 p-5 text-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">{project.metadata.name}</h3>
              <div className="flex items-center gap-2">
                <button onClick={togglePlaying} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button onClick={() => void toggleFullscreen()} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                  {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                </button>
                <button onClick={() => setControlsHidden(true)} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                  <ChevronDown size={15} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <SelectField label="Time" value={time} options={TIME_OPTIONS} onChange={setTime} />
              <SelectField label="Lighting" value={lighting} options={LIGHTING_OPTIONS} onChange={setLighting} />
              <SelectField label="Weather" value={weather} options={WEATHER_OPTIONS} onChange={setWeather} />
            </div>

            <div className="space-y-2.5">
              <SliderField label="Ambience" value={ambienceVolume} onChange={setAmbienceVolume} icon={ambienceVolume === 0 ? VolumeX : Volume2} />
              <SliderField label="Music" value={musicVolume} onChange={setMusicVolume} icon={musicVolume === 0 ? VolumeX : Volume2} />
            </div>

            {sfxAssets.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {sfxAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => playSfx(assetUrl(asset))}
                    className="text-xs bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5"
                  >
                    ▶ {asset.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <button onClick={() => setControlsHidden(false)} className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-black/40 rounded-full px-3 py-1.5">
          <ChevronUp size={14} /> Show Controls
        </button>
      )}
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-white/50 mb-1">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-white/10 border border-white/20 rounded-md px-2 py-1.5 text-xs text-white outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-base-900">
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function SliderField({ label, value, onChange, icon: Icon }: { label: string; value: number; onChange: (value: number) => void; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-white/60 shrink-0" />
      <span className="text-xs text-white/70 w-16 shrink-0">{label}</span>
      <Slider min={0} max={100} value={value} onChange={onChange} className="flex-1" />
      <span className="text-xs text-white/50 w-8 text-right">{value}%</span>
    </div>
  );
}
