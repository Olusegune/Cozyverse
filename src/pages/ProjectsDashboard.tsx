import { useEffect, useState } from "react";
import { Copy, FolderOpen, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { formatRelativeTime } from "../lib/relativeTime";

type Props = { onOpened: () => void };

export function ProjectsDashboard({ onOpened }: Props) {
  const { summaries, loadingSummaries, refreshSummaries, createAndOpen, open, duplicate, remove } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    void refreshSummaries();
  }, [refreshSummaries]);

  // Navigate explicitly on success rather than relying on a `dirName` change effect elsewhere —
  // if a project is already open (e.g. you navigated to Image Studio, then back to this dashboard
  // via the sidebar, which doesn't close the project) reopening the SAME project leaves dirName
  // unchanged, so a change-triggered effect would never fire and the view would stay stuck here.
  const handleOpen = async (dirName: string) => {
    const ok = await open(dirName);
    if (ok) onOpened();
  };

  const submitCreate = async () => {
    const name = draftName.trim() || "Untitled Cozyverse";
    setCreating(false);
    setDraftName("");
    await createAndOpen(name);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Your Cozyverses</h1>
          <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
          <p className="text-sm text-slate-400 mt-1">Create, explore, and bring your private heavens to life.</p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg bg-accent-500 hover:bg-accent-400 text-accentText px-4 py-2 text-sm font-medium transition"
          onClick={() => setCreating(true)}
        >
          <Plus size={16} /> New Cozyverse
        </button>
      </div>

      {creating && (
        <div className="mb-6 rounded-xl border border-base-600 bg-base-900 p-4 flex items-center gap-3">
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitCreate();
              if (event.key === "Escape") setCreating(false);
            }}
            placeholder="Name your Cozyverse (e.g. Rainy Tokyo Loft)"
            className="flex-1 bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
          />
          <button className="rounded-md bg-accent-500 hover:bg-accent-400 text-accentText px-3 py-2 text-sm" onClick={() => void submitCreate()}>
            Create
          </button>
          <button className="rounded-md border border-base-600 px-3 py-2 text-sm text-slate-300" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      {loadingSummaries ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded-xl border border-base-700 bg-base-900 overflow-hidden animate-pulse">
              <div className="h-36 bg-base-800" />
              <div className="p-4 space-y-2">
                <div className="h-3.5 w-2/3 bg-base-800 rounded" />
                <div className="h-3 w-4/5 bg-base-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : summaries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <p className="text-slate-400">No Cozyverses yet.</p>
          <button className="mt-4 text-accent-400 hover:text-accent-500 text-sm" onClick={() => setCreating(true)}>
            Create your first Cozyverse →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {summaries.map((summary) => (
            <div key={summary.dirName} className="group rounded-xl border border-base-700 bg-base-900 overflow-hidden hover:border-accent-500/60 transition">
              <button className="block w-full text-left" onClick={() => void handleOpen(summary.dirName)}>
                <div className="h-36 bg-base-800 flex items-center justify-center overflow-hidden">
                  {summary.heroImagePath ? (
                    <img src={summary.heroImagePath} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <FolderOpen className="text-slate-600" size={28} />
                  )}
                </div>
                <div className="p-4">
                  <h3 className="text-white font-medium">{summary.name}</h3>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{summary.shortConcept || "No short concept yet."}</p>
                  {summary.updatedAt && <p className="text-[11px] text-slate-600 mt-2">Updated {formatRelativeTime(summary.updatedAt)}</p>}
                </div>
              </button>
              <div className="flex items-center justify-end gap-1 px-3 pb-3 opacity-0 group-hover:opacity-100 transition">
                <button title="Duplicate" className="p-1.5 rounded hover:bg-base-700 text-slate-400" onClick={() => void duplicate(summary.dirName)}>
                  <Copy size={14} />
                </button>
                <button
                  title="Delete"
                  className="p-1.5 rounded hover:bg-base-700 text-red-400"
                  onClick={() => {
                    if (confirm(`Move "${summary.name}" to trash?`)) void remove(summary.dirName);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
