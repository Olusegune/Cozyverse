import { useMemo, useState } from "react";
import { Expand, FileAudio, FileVideo, Heart, ImageIcon, Mic2, Music, Sparkles, Star, Trash2, Waves, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { Lightbox } from "../components/Lightbox";
import type { Asset, AssetType } from "../types";

const TYPE_ICON: Record<AssetType, React.ElementType> = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  music: Music,
  sfx: Waves,
  dialogue: Mic2,
  "3d": Sparkles,
};

const TYPE_LABEL: Record<AssetType, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  music: "Music",
  sfx: "SFX",
  dialogue: "Dialogue",
  "3d": "3D",
};

type Filter = "all" | AssetType;

export function AssetLibraryPage() {
  const project = useAppStore((state) => state.project);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const setHeroImage = useAppStore((state) => state.setHeroImage);
  const togglePreferred = useAppStore((state) => state.togglePreferred);
  const removeAsset = useAppStore((state) => state.removeAsset);

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const assets = project?.assets || [];
  const typesPresent = useMemo(() => Array.from(new Set(assets.map((asset) => asset.type))), [assets]);
  const filtered = useMemo(
    () => assets.filter((asset) => filter === "all" || asset.type === filter).slice().reverse(),
    [assets, filter],
  );
  const selected = assets.find((asset) => asset.id === selectedId) || null;
  const children = selected ? assets.filter((asset) => asset.parentAssetId === selected.id) : [];
  const parent = selected?.parentAssetId ? assets.find((asset) => asset.id === selected.parentAssetId) : undefined;

  if (!project) return null;

  const handleDelete = async (asset: Asset) => {
    const childCount = assets.filter((existing) => existing.parentAssetId === asset.id).length;
    const warning = childCount > 0 ? `"${asset.name}" has ${childCount} derived asset${childCount === 1 ? "" : "s"} that will lose their link to it. ` : "";
    if (!confirm(`${warning}Move "${asset.name}" to trash? The file is recoverable from the project's assets/_trash folder.`)) return;
    await removeAsset(asset.id);
    if (selectedId === asset.id) setSelectedId(null);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Asset Library</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">Every image, video, and sound in this Cozyverse — generated or imported, with full lineage.</p>
      </div>

      <div className="flex items-center gap-1.5 mb-6 flex-wrap">
        <FilterTab label="All" active={filter === "all"} onClick={() => setFilter("all")} />
        {typesPresent.map((type) => (
          <FilterTab key={type} label={TYPE_LABEL[type]} active={filter === type} onClick={() => setFilter(type)} />
        ))}
      </div>

      {assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <Sparkles className="mx-auto text-slate-600 mb-3" size={28} />
          <p className="text-slate-400">No assets yet. Generate or import media from Image Studio to see it here.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm">No {TYPE_LABEL[filter as AssetType]} assets yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map((asset) => {
            const Icon = TYPE_ICON[asset.type];
            const isHero = project.metadata.heroImageAssetId === asset.id;
            const isPreferred = Boolean(asset.metadata.preferred);
            const childCount = assets.filter((existing) => existing.parentAssetId === asset.id).length;
            const url = asset.type === "image" || asset.type === "video" ? assetUrl(asset) : undefined;
            return (
              <button
                key={asset.id}
                onClick={() => setSelectedId(asset.id)}
                className={`group text-left rounded-xl border overflow-hidden bg-base-900 transition ${selectedId === asset.id ? "border-accent-500" : "border-base-700 hover:border-base-600"}`}
              >
                <div className="aspect-video bg-base-800 flex items-center justify-center relative overflow-hidden">
                  {url && asset.type === "image" ? (
                    <img src={url} alt={asset.name} className="w-full h-full object-cover" />
                  ) : url && asset.type === "video" ? (
                    <video src={url} className="w-full h-full object-cover" muted />
                  ) : (
                    <Icon className="text-slate-600" size={32} />
                  )}
                  {isHero && <span className="absolute top-1.5 left-1.5 bg-accent-500 text-accentText text-[10px] font-medium px-1.5 py-0.5 rounded">HERO</span>}
                  {childCount > 0 && (
                    <span className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">{childCount} derived</span>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm text-slate-300 truncate">{asset.name}</span>
                    {isPreferred && <Heart size={13} className="text-red-400 shrink-0" fill="currentColor" />}
                  </div>
                  <span className="text-[11px] text-slate-500 uppercase">{asset.role} · {asset.source}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-y-0 right-0 w-96 bg-base-900 border-l border-base-700 p-5 overflow-y-auto shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-medium truncate pr-2">{selected.name}</h2>
            <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-white shrink-0">
              <X size={18} />
            </button>
          </div>

          {selected.type === "image" && assetUrl(selected) && (
            <button onClick={() => setLightboxOpen(true)} className="relative block w-full group">
              <img src={assetUrl(selected)} alt={selected.name} className="w-full rounded-lg border border-base-700 mb-4" />
              <span className="absolute bottom-3 right-2 p-1.5 rounded-md bg-black/60 group-hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition">
                <Expand size={13} />
              </span>
            </button>
          )}

          <div className="flex items-center gap-2 mb-4">
            {selected.type === "image" && (
              <button
                onClick={() => void setHeroImage(selected.id)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border ${project.metadata.heroImageAssetId === selected.id ? "border-yellow-400 text-yellow-400" : "border-base-600 text-slate-300 hover:border-yellow-400 hover:text-yellow-400"}`}
              >
                <Star size={13} fill={project.metadata.heroImageAssetId === selected.id ? "currentColor" : "none"} /> Hero
              </button>
            )}
            <button
              onClick={() => void togglePreferred(selected.id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border ${selected.metadata.preferred ? "border-red-400 text-red-400" : "border-base-600 text-slate-300 hover:border-red-400 hover:text-red-400"}`}
            >
              <Heart size={13} fill={selected.metadata.preferred ? "currentColor" : "none"} /> Preferred
            </button>
            <button onClick={() => void handleDelete(selected)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:border-red-500 hover:text-red-400 ml-auto">
              <Trash2 size={13} /> Delete
            </button>
          </div>

          <dl className="text-xs space-y-2 mb-5">
            <Row label="Type" value={TYPE_LABEL[selected.type]} />
            <Row label="Role" value={selected.role} />
            <Row label="Source" value={selected.source} />
            {selected.provider && <Row label="Provider" value={selected.provider} />}
            {selected.model && <Row label="Model" value={selected.model} />}
            <Row label="Created" value={new Date(selected.createdAt).toLocaleString()} />
          </dl>

          <div className="border-t border-base-700 pt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Lineage</h3>
            {parent ? (
              <button onClick={() => setSelectedId(parent.id)} className="text-xs text-accent-400 hover:text-accent-500 block mb-2">
                ↑ Derived from "{parent.name}"
              </button>
            ) : (
              <p className="text-xs text-slate-500 mb-2">This is an original asset (no parent).</p>
            )}
            {children.length > 0 ? (
              <ul className="space-y-1">
                {children.map((child) => (
                  <li key={child.id}>
                    <button onClick={() => setSelectedId(child.id)} className="text-xs text-accent-400 hover:text-accent-500">
                      ↳ {child.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No derived assets yet.</p>
            )}
          </div>
        </div>
      )}

      {lightboxOpen && selected && assetUrl(selected) && (
        <Lightbox src={assetUrl(selected)!} alt={selected.name} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
}

function FilterTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition ${active ? "bg-accent-500 border-accent-500 text-accentText" : "border-base-600 text-slate-400 hover:text-white hover:border-base-500"}`}
    >
      {label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-300 truncate max-w-[60%] text-right">{value}</dd>
    </div>
  );
}
