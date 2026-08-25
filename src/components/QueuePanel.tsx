import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, X, XCircle } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

function formatElapsed(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${remainder.toString().padStart(2, "0")}` : `${remainder}s`;
}

export function QueuePanel() {
  const renderQueue = useAppStore((state) => state.renderQueue);
  const dismissRenderQueueItem = useAppStore((state) => state.dismissRenderQueueItem);
  const clearCompletedRenders = useAppStore((state) => state.clearCompletedRenders);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const hasRunning = renderQueue.some((item) => item.status === "running");
  // Only ticks while something is actually running — an idle queue shouldn't burn a timer.
  useEffect(() => {
    if (!hasRunning) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasRunning]);

  if (renderQueue.length === 0) return null;

  const active = renderQueue.filter((item) => item.status === "queued" || item.status === "running").length;
  const completed = renderQueue.length - active;

  return (
    <div className="mx-2 mb-2 border border-base-700 bg-base-800 overflow-hidden">
      <button onClick={() => setOpen((value) => !value)} className="w-full flex items-center justify-between px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-slate-300">
          {active > 0 && <Loader2 size={12} className="animate-spin text-accent-400" />}
          Queue{active > 0 ? ` — ${active} pending` : ""}
        </span>
        <ChevronDown size={13} className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-base-700 max-h-56 overflow-y-auto">
          {renderQueue.map((item) => (
            <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-base-700/60 last:border-b-0">
              {item.status === "queued" && <span className="w-3 h-3 rounded-full border border-slate-600 shrink-0" />}
              {item.status === "running" && <Loader2 size={12} className="animate-spin text-accent-400 shrink-0" />}
              {item.status === "done" && <CheckCircle2 size={12} className="text-green-400 shrink-0" />}
              {item.status === "failed" && <XCircle size={12} className="text-red-400 shrink-0" />}
              <span className="flex-1 truncate text-slate-300" title={item.error || item.label}>
                {item.label}
              </span>
              {item.status === "running" && item.startedAt && <span className="text-[10px] text-slate-500 tabular-nums shrink-0">{formatElapsed(item.startedAt, now)}</span>}
              {(item.status === "done" || item.status === "failed" || item.status === "queued") && (
                <button onClick={() => dismissRenderQueueItem(item.id)} className="text-slate-600 hover:text-white shrink-0">
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {completed > 0 && (
            <button onClick={clearCompletedRenders} className="w-full text-center text-[11px] text-slate-500 hover:text-white py-1.5 border-t border-base-700">
              Clear completed
            </button>
          )}
        </div>
      )}
    </div>
  );
}
