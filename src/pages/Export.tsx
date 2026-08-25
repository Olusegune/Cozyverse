import { CheckCircle2, Clapperboard, FileAudio, Film, ImageIcon, Package } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { validateForExport } from "../lib/exportFormat";

export function ExportPage() {
  const project = useAppStore((state) => state.project);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const exporting = useAppStore((state) => state.exporting);
  const lastExportPath = useAppStore((state) => state.lastExportPath);
  const exportCozyverse = useAppStore((state) => state.exportCozyverse);

  if (!project) return null;

  const validation = validateForExport(project);
  const counts = {
    image: project.assets.filter((asset) => asset.type === "image").length,
    video: project.assets.filter((asset) => asset.type === "video").length,
    audio: project.assets.filter((asset) => ["audio", "music", "sfx", "dialogue"].includes(asset.type)).length,
  };
  const heroAsset = project.assets.find((asset) => asset.id === project.metadata.heroImageAssetId);

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Export</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">Package this Cozyverse into a single portable file — <code className="text-slate-300">cozyverse.json</code> plus every asset it references.</p>
      </div>

      <div className="rounded-xl border border-base-700 bg-base-900 p-5 mb-5">
        <div className="flex gap-4">
          <div className="w-32 aspect-video rounded-lg bg-base-800 overflow-hidden shrink-0 flex items-center justify-center">
            {heroAsset && assetUrl(heroAsset) ? (
              <img src={assetUrl(heroAsset)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Package className="text-slate-600" size={22} />
            )}
          </div>
          <div>
            <h2 className="text-white font-medium">{project.metadata.name}</h2>
            <p className="text-xs text-slate-400 mt-1">{project.metadata.shortConcept || "No short concept set."}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mt-5">
          <SummaryStat icon={ImageIcon} label="Images" value={counts.image} />
          <SummaryStat icon={Film} label="Motion Clips" value={counts.video} />
          <SummaryStat icon={FileAudio} label="Audio" value={counts.audio} />
          <SummaryStat icon={Clapperboard} label="Scenes" value={project.scenes.length} />
        </div>
      </div>

      {!validation.ok && (
        <div className="rounded-lg border border-yellow-700/50 bg-yellow-950/30 text-yellow-300 text-sm px-4 py-3 mb-5">{validation.reason}</div>
      )}

      <div className="rounded-xl border border-base-700 bg-base-900 p-5">
        <h3 className="text-sm font-medium text-white mb-2">Package contents</h3>
        <pre className="text-xs text-slate-400 bg-base-800 rounded-md p-3 leading-relaxed">
{`cozyverse.json      — world bible, asset graph, scenes
assets/images/...    assets/video/...    assets/audio/...
thumbnail.${heroAsset?.filePath.split(".").pop() || "png"}`}
        </pre>

        <button
          disabled={!validation.ok || exporting}
          onClick={() => void exportCozyverse()}
          className="w-full mt-4 flex items-center justify-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed text-accentText px-4 py-2.5 text-sm font-medium transition"
        >
          <Package size={16} /> {exporting ? "Packaging…" : "Export Portable Cozyverse"}
        </button>

        {lastExportPath && (
          <div className="flex items-center gap-2 text-xs text-green-400 mt-3">
            <CheckCircle2 size={14} /> Exported to {lastExportPath}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-base-800 border border-base-700 px-3 py-2.5 text-center">
      <Icon className="mx-auto text-slate-500 mb-1" size={15} />
      <div className="text-sm text-white font-medium">{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
