import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, Boxes, Clapperboard, Film, FolderOpen, HelpCircle, Sparkles, Wand2, LayoutGrid, Volume2, PlayCircle, Package, Settings as SettingsIcon, ListVideo, Users, Map } from "lucide-react";
import { useAppStore } from "./store/useAppStore";
import { ProjectsDashboard } from "./pages/ProjectsDashboard";
import { WorldMapPage } from "./pages/WorldMap";
import { WorldBiblePage } from "./pages/WorldBible";
import { CharactersPage } from "./pages/Characters";
import { ImageStudioPage } from "./pages/ImageStudio";
import { AssetLibraryPage } from "./pages/AssetLibrary";
import { Assets3DPage } from "./pages/Assets3D";
import { MotionStudioPage } from "./pages/MotionStudio";
import { AudioStudioPage } from "./pages/AudioStudio";
import { SceneComposerPage } from "./pages/SceneComposer";
import { StoryboardPage } from "./pages/Storyboard";
import { PreviewPage } from "./pages/Preview";
import { ExportPage } from "./pages/Export";
import { SettingsPage } from "./pages/Settings";
import { Toast } from "./components/Toast";
import { SplashScreen } from "./components/SplashScreen";
import { AboutDialog } from "./components/AboutDialog";
import { HelpDialog } from "./components/HelpDialog";
import { QueuePanel } from "./components/QueuePanel";
import { ProviderBalanceTicker } from "./components/ProviderBalanceTicker";

type View = "projects" | "map" | "world" | "characters" | "create" | "decompose3d" | "assets" | "motion" | "audio" | "scene" | "storyboard" | "preview" | "export" | "settings";

export function App() {
  const { project, dirName, closeProject, saveNow } = useAppStore();
  const setActiveScene = useAppStore((state) => state.setActiveScene);
  const [view, setView] = useState<View>("projects");
  const [previousView, setPreviousView] = useState<View>("scene");
  const [showSplash, setShowSplash] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (dirName) setView("map");
  }, [dirName]);

  // The native File/Help menu (see build_menu in lib.rs) has no app logic of its own — each item
  // just emits one of these events, which this is the single place that reacts to.
  useEffect(() => {
    const unlisten = Promise.all([
      listen("menu-new", () => setView("projects")),
      listen("menu-open", () => setView("projects")),
      listen("menu-save", () => void saveNow()),
      listen("menu-docs", () => setHelpOpen(true)),
      listen("menu-about", () => setAboutOpen(true)),
    ]);
    return () => {
      void unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, [saveNow]);

  if (showSplash) {
    return (
      <SplashScreen
        onDismiss={() => setShowSplash(false)}
        onHelp={() => {
          setShowSplash(false);
          setHelpOpen(true);
        }}
      />
    );
  }

  // The numbered "flow" is the actual golden path — land on the world map, fill
  // the world in, cast it, make an image, optionally turn pieces of it into 3D,
  // then motion/audio/scene/board it into something exportable. Each item gets
  // its own chip color (a deliberate multi-color treatment, like a real icon
  // set) rather than one accent tint repeated ten times.
  const flow: Array<{ key: View; step: number; label: string; icon: React.ElementType; chip: string; iconColor: string; optional?: boolean }> = [
    { key: "map", step: 1, label: "World Map", icon: Map, chip: "bg-amber-500/20", iconColor: "text-amber-400" },
    { key: "world", step: 2, label: "World Bible", icon: BookOpen, chip: "bg-violet-500/20", iconColor: "text-violet-400" },
    { key: "characters", step: 3, label: "Cast & Props", icon: Users, chip: "bg-pink-500/20", iconColor: "text-pink-400" },
    { key: "create", step: 4, label: "Image Studio", icon: Wand2, chip: "bg-accent-500/20", iconColor: "text-accent-400" },
    { key: "decompose3d", step: 5, label: "3D & Assets", icon: Boxes, chip: "bg-teal-500/20", iconColor: "text-teal-400", optional: true },
    { key: "motion", step: 6, label: "Motion Studio", icon: Film, chip: "bg-sky-500/20", iconColor: "text-sky-400" },
    { key: "audio", step: 7, label: "Audio Studio", icon: Volume2, chip: "bg-emerald-500/20", iconColor: "text-emerald-400" },
    { key: "scene", step: 8, label: "Scene Composer", icon: Clapperboard, chip: "bg-rose-500/20", iconColor: "text-rose-400" },
    { key: "storyboard", step: 9, label: "Storyboard", icon: ListVideo, chip: "bg-fuchsia-500/20", iconColor: "text-fuchsia-400" },
  ];
  // Everything else is a tool you dip into, not a step you pass through.
  const tools: Array<{ key: View; label: string; icon: React.ElementType; chip: string; iconColor: string }> = [
    { key: "assets", label: "Assets", icon: LayoutGrid, chip: "bg-cyan-500/20", iconColor: "text-cyan-400" },
    { key: "export", label: "Export", icon: Package, chip: "bg-orange-500/20", iconColor: "text-orange-400" },
  ];

  if (view === "preview" && project) {
    return <PreviewPage onExit={() => setView(previousView)} />;
  }

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-base-700 bg-base-900 flex flex-col">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-base-700">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent-500/15 border border-accent-500/30">
            <Sparkles size={14} className="text-accent-400" />
          </span>
          <span className="font-display font-semibold text-white text-[15px] tracking-wide">Cozyverse Studio</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <button
            onClick={() => setView("projects")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition mb-2 ${
              view === "projects" ? "bg-accent-500/15 text-accent-300" : "text-slate-400 hover:text-white hover:bg-base-800"
            }`}
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 bg-slate-500/20">
              <FolderOpen size={16} className="text-slate-300" />
            </span>
            Projects
          </button>

          <p className="px-2.5 mt-3 mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Your world</p>
          <div className="space-y-0.5">
            {flow.map(({ key, step, label, icon: Icon, chip, iconColor, optional }, index) => (
              <div key={key}>
                {index > 0 && <div className="ml-6 w-px h-1.5 bg-base-700" />}
                <button
                  disabled={!project}
                  onClick={() => setView(key)}
                  title={optional ? `${label} — optional: turn any generated image into 3D models or free assets` : undefined}
                  className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition ${
                    view === key ? "bg-accent-500/15 text-accent-300" : "text-slate-400 hover:text-white hover:bg-base-800"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {view === key && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-accent-500" />}
                  <span className={`relative flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${chip}`}>
                    <Icon size={16} className={iconColor} />
                    <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-base-900 border border-base-600 text-[8px] font-medium text-slate-400">
                      {step}
                    </span>
                  </span>
                  <span className="flex-1 text-left truncate">{label}</span>
                  {optional && <span className="w-1.5 h-1.5 rounded-full bg-teal-500/70 shrink-0" />}
                </button>
              </div>
            ))}
          </div>

          <p className="px-2.5 mt-4 mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Tools</p>
          <div className="space-y-0.5">
            {tools.map(({ key, label, icon: Icon, chip, iconColor }) => (
              <button
                key={key}
                disabled={!project}
                onClick={() => setView(key)}
                className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition ${
                  view === key ? "bg-accent-500/15 text-accent-300" : "text-slate-400 hover:text-white hover:bg-base-800"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {view === key && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-accent-500" />}
                <span className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${chip}`}>
                  <Icon size={16} className={iconColor} />
                </span>
                {label}
              </button>
            ))}
          </div>
        </nav>

        <div className="px-2 space-y-0.5 border-t border-base-700 pt-2">
          <button
            onClick={() => setView("settings")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition ${
              view === "settings" ? "bg-accent-500/15 text-accent-300" : "text-slate-400 hover:text-white hover:bg-base-800"
            }`}
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 bg-slate-500/20">
              <SettingsIcon size={16} className="text-slate-400" />
            </span>
            Settings
          </button>
          <button
            onClick={() => setHelpOpen(true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-base-800 transition"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 bg-accent-500/20">
              <HelpCircle size={16} className="text-accent-400" />
            </span>
            Help &amp; Docs
          </button>
        </div>

        <QueuePanel />
        {project && (
          <div className="px-2 pb-2 pt-2">
            <button
              onClick={() => {
                setPreviousView(view);
                setView("preview");
              }}
              className="w-full flex items-center justify-center gap-2 rounded-full bg-accent-500 hover:bg-accent-400 text-accentText px-3 py-2 text-sm font-medium transition"
            >
              <PlayCircle size={16} /> Preview
            </button>
          </div>
        )}
        {project && <ProviderBalanceTicker />}
        {project && dirName && (
          <div className="p-3 border-t border-base-700">
            <p className="text-xs text-slate-500 truncate mb-2">{project.metadata.name}</p>
            <button
              className="text-xs text-slate-400 hover:text-white"
              onClick={() => {
                closeProject();
                setView("projects");
              }}
            >
              ← Back to Projects
            </button>
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-auto">
        <Toast />
        {view === "settings" ? (
          <SettingsPage />
        ) : view === "projects" || !project ? (
          <ProjectsDashboard onOpened={() => setView("map")} />
        ) : view === "map" ? (
          <WorldMapPage
            onOpenScene={(sceneId) => {
              setActiveScene(sceneId);
              setView("scene");
            }}
          />
        ) : view === "characters" ? (
          <CharactersPage />
        ) : view === "create" ? (
          <ImageStudioPage />
        ) : view === "decompose3d" ? (
          <Assets3DPage />
        ) : view === "motion" ? (
          <MotionStudioPage />
        ) : view === "audio" ? (
          <AudioStudioPage />
        ) : view === "scene" ? (
          <SceneComposerPage />
        ) : view === "storyboard" ? (
          <StoryboardPage />
        ) : view === "assets" ? (
          <AssetLibraryPage />
        ) : view === "export" ? (
          <ExportPage />
        ) : (
          <WorldBiblePage />
        )}
      </main>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
