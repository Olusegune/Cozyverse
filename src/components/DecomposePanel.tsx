import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  decomposeProviderKeys,
  estimateGenerations,
  hideJob,
  hydrateDecompositions,
  isHidden,
  isJobActive,
  jobProgress,
  submitDecomposition,
  useDecompositions,
  type DecomposeJob,
  type ModelJob,
} from "../lib/decompose";

const PATH_LABEL: Record<string, string> = { fast: "Fast", quality: "Quality" };

function StatusDot({ status }: { status: ModelJob["status"] }) {
  if (status === "succeeded") return <CheckCircle2 size={13} className="text-emerald-400" />;
  if (status === "failed") return <XCircle size={13} className="text-red-400" />;
  if (status === "running") return <Loader2 size={13} className="text-accent-400 animate-spin" />;
  return <span className="inline-block w-[13px] h-[13px] rounded-full border border-base-600" />;
}

function stageLine(job: DecomposeJob): string {
  switch (job.status) {
    case "pending":
      return "Queued…";
    case "decomposing":
      return "Segmenting & generating views…";
    case "awaiting":
      return `${job.assets.length} object(s) found`;
    case "modeling": {
      const { done, total } = jobProgress(job);
      return `Modeling — ${done}/${total} done`;
    }
    case "done":
      return job.message || "Done";
    case "error":
      return job.error || job.message || "Failed";
  }
}

function ConfirmBlock({ job, providerCount }: { job: DecomposeJob; providerCount: number }) {
  const dirName = useAppStore((s) => s.dirName);
  const [quality, setQuality] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const estimate = estimateGenerations(job, Math.max(providerCount, 1), quality);

  const send = async () => {
    if (!dirName) return;
    setBusy(true);
    setErr(null);
    try {
      await submitDecomposition(dirName, job.id, { qualityPath: quality });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
        <div>
          Sends up to <b className="text-slate-200">{estimate}</b> paid 3D generation(s)
          {providerCount > 0 ? " across the connected provider(s)" : ""} — {job.assets.length}{" "}
          object(s), Fast{quality ? " + Quality" : ""} path{quality ? "s" : ""}.
        </div>
      </div>
      <label className="mt-2 flex items-center gap-1.5 text-slate-400 select-none">
        <input type="checkbox" checked={quality} onChange={(e) => setQuality(e.target.checked)} />
        Also run the 4-view Quality path (doubles the spend)
      </label>
      {err && <p className="mt-1.5 text-red-400">{err}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void send()}
          disabled={busy}
          className="px-3 py-1 rounded-md bg-accent-500 hover:bg-accent-400 text-accentText disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send to 3D"}
        </button>
        <button
          onClick={() => hideJob(job.id)}
          disabled={busy}
          className="px-3 py-1 rounded-md border border-base-600 text-slate-400 hover:text-white disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function JobCard({ job, providerCount }: { job: DecomposeJob; providerCount: number }) {
  const { done, total } = jobProgress(job);
  const pct =
    job.status === "done"
      ? 100
      : total
        ? Math.round((done / total) * 100)
        : isJobActive(job)
          ? 15
          : job.status === "awaiting"
            ? 50
            : 0;

  return (
    <div className="rounded-lg border border-base-700 bg-base-900/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isJobActive(job) ? (
            <Loader2 size={14} className="text-accent-400 animate-spin shrink-0" />
          ) : job.status === "done" ? (
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          ) : job.status === "error" ? (
            <XCircle size={14} className="text-red-400 shrink-0" />
          ) : (
            <Boxes size={14} className="text-amber-400 shrink-0" />
          )}
          <span className="text-xs text-slate-300 truncate">{job.imagePath}</span>
        </div>
        <span className="text-[11px] text-slate-500 shrink-0">{stageLine(job)}</span>
      </div>

      <div className="mt-2 h-1 rounded-full bg-base-800 overflow-hidden">
        <div
          className={`h-full transition-all ${job.status === "error" ? "bg-red-500" : "bg-accent-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {job.status === "awaiting" && !job.submitted && (
        <ConfirmBlock job={job} providerCount={providerCount} />
      )}

      {job.submitted && job.assets.some((a) => a.models.length > 0) && (
        <div className="mt-3 space-y-2">
          {job.assets.map((asset) => (
            <div key={asset.id} className="text-xs">
              <div className="text-slate-400 mb-1">
                {asset.class}
                {asset.orthoViews.front && asset.orthoViews.left ? (
                  <span className="ml-1.5 text-[10px] text-slate-600">4-view</span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {asset.models.map((m) => (
                  <div
                    key={m.key}
                    className="flex items-center gap-1.5 rounded bg-base-800/70 px-2 py-1"
                    title={m.error ?? undefined}
                  >
                    <StatusDot status={m.status} />
                    <span className="capitalize text-slate-300">{m.provider}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">{PATH_LABEL[m.pathKind] ?? m.pathKind}</span>
                    {m.glbPath && <span className="ml-auto text-[10px] text-emerald-500">GLB</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DecomposePanel() {
  const dirName = useAppStore((s) => s.dirName);
  const allJobs = useDecompositions();
  const [providerCount, setProviderCount] = useState(1);

  useEffect(() => {
    if (dirName) void hydrateDecompositions(dirName);
  }, [dirName]);

  useEffect(() => {
    void decomposeProviderKeys().then((keys) =>
      setProviderCount(Object.values(keys).filter(Boolean).length),
    );
  }, []);

  const jobs = useMemo(
    () => allJobs.filter((j) => !isHidden(j.id)).slice(0, 4),
    [allJobs],
  );
  if (jobs.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-base-700 bg-base-900 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Boxes size={15} className="text-accent-400" />
        <h3 className="text-sm font-medium text-slate-200">Decompose &amp; Send to 3D</h3>
      </div>
      <div className="space-y-2.5">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} providerCount={providerCount} />
        ))}
      </div>
    </div>
  );
}
