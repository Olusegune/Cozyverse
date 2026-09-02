import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, Clapperboard, Film, FolderOpen, Sparkles, Wand2, LayoutGrid, Volume2, PlayCircle, Package, Settings as SettingsIcon, ListVideo, Users } from "lucide-react";
import { useAppStore } from "./store/useAppStore";
import { ProjectsDashboard } from "./pages/ProjectsDashboard";
import { WorldBiblePage } from "./pages/WorldBible";
import { CharactersPage } from "./pages/Characters";
import { ImageStudioPage } from "./pages/ImageStudio";
import { AssetLibraryPage } from "./pages/AssetLibrary";
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

type View = "projects" | "world" | "characters" | "create" | "assets" | "motion" | "audio" | "scene" | "storyboard" | "preview" | "export" | "settings";

export function App() {
  const { project, dirName, closeProject, saveNow } = useAppStore();
  const [view, setView] = useState<View>("projects");
  const [previousView, setPreviousView] = useState<View>("scene");
  const [showSplash, setShowSplash] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (dirName) setView("world");
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
    return <SplashScreen onDismiss={() => setShowSplash(false)} />;
  }

  // Each item gets its own chip color — a deliberate multi-color treatment (like a real icon set,
  // not one accent tint repeated) rather than every icon sharing the same muted gray/accent color.
  const nav: Array<{ key: View; label: string; icon: React.ElementType; chip: string; iconColor: string }> = [
    { key: "projects", label: "Projects", icon: FolderOpen, chip: "bg-slate-500/20", iconColor: "text-slate-300" },
    { key: "world", label: "World Bible", icon: BookOpen, chip: "bg-violet-500/20", iconColor: "text-violet-400" },
    { key: "characters", label: "Characters", icon: Users, chip: "bg-pink-500/20", iconColor: "text-pink-400" },
    { key: "create", label: "Image Studio", icon: Wand2, chip: "bg-accent-500/20", iconColor: "text-accent-400" },
    { key: "motion", label: "Motion Studio", icon: Film, chip: "bg-sky-500/20", iconColor: "text-sky-400" },
    { key: "audio", label: "Audio Studio", icon: Volume2, chip: "bg-emerald-500/20", iconColor: "text-emerald-400" },
    { key: "scene", label: "Scene Composer", icon: Clapperboard, chip: "bg-rose-500/20", iconColor: "text-rose-400" },
    { key: "storyboard", label: "Storyboard", icon: ListVideo, chip: "bg-fuchsia-500/20", iconColor: "text-fuchsia-400" },
    { key: "assets", label: "Assets", icon: LayoutGrid, chip: "bg-cyan-500/20", iconColor: "text-cyan-400" },
    { key: "export", label: "Export", icon: Package, chip: "bg-orange-500/20", iconColor: "text-orange-400" },
    { key: "settings", label: "Settings", icon: SettingsIcon, chip: "bg-slate-500/20", iconColor: "text-slate-400" },
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
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {nav.map(({ key, label, icon: Icon, chip, iconColor }) => (
            <button
              key={key}
              disabled={key !== "projects" && key !== "settings" && !project}
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
        </nav>
        <QueuePanel />
        {project && (
          <div className="px-2 pb-2">
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
          <ProjectsDashboard onOpened={() => setView("world")} />
        ) : view === "characters" ? (
          <CharactersPage />
        ) : view === "create" ? (
          <ImageStudioPage />
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
