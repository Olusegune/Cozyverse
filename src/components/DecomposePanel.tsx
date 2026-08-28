import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, FolderOpen, Loader2, X, XCircle } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  decomposeProviderKeys,
  estimateGenerations,
  hideJob,
  hydrateDecompositions,
  isHidden,
  isJobActive,
  jobProgress,
  clearFinishedJobs,
  decomposeScenePath,
  exportDecomposePack,
  revealDecomposeOutput,
  setStubMode,
  submitDecomposition,
  useDecompositions,
  useStubMode,
  decomposeRuntimeStatus,
  setupDecomposeRuntime,
  useSetupProgress,
  type DecomposeJob,
  type ModelJob,
  type RuntimeStatus,
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
    case "error": {
      const msg = job.error || job.message || "Failed";
      return msg.length > 100 ? msg.slice(0, 100) + "…" : msg;
    }
  }
}

const ALL_PROVIDERS = ["tripo", "meshy"] as const;

function ConfirmBlock({
  job,
  providerKeys,
}: {
  job: DecomposeJob;
  providerKeys: Record<string, boolean>;
}) {
  const dirName = useAppStore((s) => s.dirName);
  const keyed = ALL_PROVIDERS.filter((p) => providerKeys[p]);
  const [quality, setQuality] = useState(false);
  const [chosen, setChosen] = useState<string[]>(keyed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep the selection in step with which providers actually have a key.
  useEffect(() => {
    setChosen((cur) => {
      const next = cur.filter((p) => keyed.includes(p as (typeof ALL_PROVIDERS)[number]));
      return next.length ? next : keyed;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKeys]);

  const toggle = (p: string) =>
    setChosen((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const estimate = estimateGenerations(job, Math.max(chosen.length, 1), quality);

  const send = async () => {
    if (!dirName || chosen.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await submitDecomposition(dirName, job.id, { qualityPath: quality, providers: chosen });
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
          Sends up to <b className="text-slate-200">{estimate}</b> paid 3D generation(s) —{" "}
          {job.assets.length} object(s), Fast{quality ? " + Quality" : ""} path{quality ? "s" : ""}.
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-slate-400">
        <span className="text-slate-500">Generate with:</span>
        {keyed.map((p) => (
          <label key={p} className="flex items-center gap-1.5 select-none capitalize">
            <input type="checkbox" checked={chosen.includes(p)} onChange={() => toggle(p)} />
            {p}
          </label>
        ))}
        {keyed.length === 0 && (
          <span className="text-red-400">No Tripo or Meshy key — add one in Settings.</span>
        )}
      </div>

      <label
        className="mt-1.5 flex items-center gap-1.5 text-slate-500 select-none"
        title="Experimental: synthesizes 4 views per object and feeds the multi-view endpoints. Currently the synthesized side/back views are rough for objects lifted from a busy scene — the Fast path usually gives better 3D."
      >
        <input type="checkbox" checked={quality} onChange={(e) => setQuality(e.target.checked)} />
        Also run the 4-view Quality path — experimental (doubles the spend)
      </label>

      {err && <p className="mt-1.5 text-red-400">{err}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void send()}
          disabled={busy || chosen.length === 0}
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
      <div className="mt-2 pt-2 border-t border-base-700 text-slate-500">
        Prefer your own 3D tool?{" "}
        <button
          onClick={() => dirName && void exportDecomposePack(dirName, job.id).catch(() => {})}
          disabled={busy}
          className="text-accent-400 hover:text-accent-300 disabled:opacity-50"
        >
          Download image pack (.zip)
        </button>{" "}
        — perspective + 4 views per object, no providers, no spend.
      </div>
    </div>
  );
}

function JobCard({
  job,
  providerKeys,
}: {
  job: DecomposeJob;
  providerKeys: Record<string, boolean>;
}) {
  const dirName = useAppStore((s) => s.dirName);
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
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[11px] text-slate-500 max-w-[280px] truncate"
            title={job.error ?? undefined}
          >
            {stageLine(job)}
          </span>
          {!isJobActive(job) && (
            <button
              onClick={() => hideJob(job.id)}
              title="Dismiss"
              className="text-slate-600 hover:text-slate-300"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 h-1 rounded-full bg-base-800 overflow-hidden">
        <div
          className={`h-full transition-all ${job.status === "error" ? "bg-red-500" : "bg-accent-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {job.status === "awaiting" && !job.submitted && (
        <ConfirmBlock job={job} providerKeys={providerKeys} />
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

      {job.assets.some((a) => a.models.some((m) => m.glbPath)) && (
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={() => dirName && void revealDecomposeOutput(dirName)}
            className="flex items-center gap-1.5 text-[11px] text-accent-400 hover:text-accent-300"
          >
            <FolderOpen size={12} /> Open the models folder
          </button>
          {job.status === "done" && (
            <button
              onClick={() => dirName && void decomposeScenePath(dirName, job.id).catch(() => {})}
              className="flex items-center gap-1.5 text-[11px] text-accent-400 hover:text-accent-300"
              title="Reveal scene.json — import it in Blender via the Cozyverse Bridge add-on (integrations/blender/)"
            >
              <FolderOpen size={12} /> Blender scene file
            </button>
          )}
          <button
            onClick={() => dirName && void exportDecomposePack(dirName, job.id).catch(() => {})}
            className="flex items-center gap-1.5 text-[11px] text-accent-400 hover:text-accent-300"
            title="Save a .zip of the decomposition images (perspective + front/back/left/right per object) for any image-to-3D tool"
          >
            <FolderOpen size={12} /> Image pack (.zip)
          </button>
        </div>
      )}
    </div>
  );
}

function RuntimeCard() {
  const setup = useSetupProgress();
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState<"lite" | "full" | null>(null);

  const refresh = () => void decomposeRuntimeStatus().then(setStatus);
  useEffect(refresh, []);
  useEffect(() => {
    if (setup?.done) {
      setBusy(null);
      refresh();
    }
  }, [setup?.done]);

  const run = (mode: "lite" | "full") => {
    setBusy(mode);
    void setupDecomposeRuntime(mode).catch(() => setBusy(null));
  };

  const installing = busy != null || status?.installing || (setup != null && !setup.done);

  if (installing) {
    const pct = setup?.percent ?? 3;
    return (
      <div className="mb-3 rounded-md border border-accent-500/30 bg-accent-500/5 p-2.5 text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <Loader2 size={13} className="animate-spin text-accent-400" />
          Setting up the {busy === "lite" ? "quick" : "full"} pipeline… {pct}%
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-base-800 overflow-hidden">
          <div className="h-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {setup?.message && (
          <p className="mt-1 text-[10px] text-slate-500 truncate">{setup.message}</p>
        )}
      </div>
    );
  }

  if (setup?.error) {
    return (
      <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 p-2.5 text-xs text-red-400">
        Setup failed: {setup.error}{" "}
        <button onClick={() => run("lite")} className="underline hover:text-red-300">
          Retry quick
        </button>
      </div>
    );
  }

  if (status?.fullReady) {
    return (
      <p className="mb-3 flex items-center gap-1.5 text-[11px] text-emerald-500">
        <CheckCircle2 size={12} /> Full pipeline ready — {status.detail}
      </p>
    );
  }

  if (status?.liteReady) {
    return (
      <p className="mb-3 flex items-center gap-1.5 text-[11px] text-emerald-500">
        <CheckCircle2 size={12} /> Quick pipeline ready ({status.detail}) ·{" "}
        <button onClick={() => run("full")} className="text-accent-400 hover:text-accent-300">
          add the full pipeline (~3 GB)
        </button>
      </p>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-accent-500/30 bg-accent-500/5 p-2.5 text-xs">
      <p className="text-slate-300">
        Real object detection needs a one-time setup, into an isolated environment
        Cozyverse manages.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => run("lite")}
          className="px-3 py-1 rounded-md bg-accent-500 hover:bg-accent-400 text-accentText"
        >
          Quick setup · ~400 MB (CPU)
        </button>
        <button
          onClick={() => run("full")}
          className="px-3 py-1 rounded-md border border-accent-500/40 text-accent-300 hover:bg-accent-500/10"
        >
          Full setup · ~3 GB (GPU + 4-view)
        </button>
        <span className="text-slate-500">or tick Stub mode.</span>
      </div>
    </div>
  );
}

export function DecomposePanel() {
  const dirName = useAppStore((s) => s.dirName);
  const allJobs = useDecompositions();
  const stub = useStubMode();
  const [providerKeys, setProviderKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (dirName) void hydrateDecompositions(dirName);
  }, [dirName]);

  useEffect(() => {
    void decomposeProviderKeys().then(setProviderKeys);
  }, []);

  // Show every running/awaiting job, plus just the most recent finished one —
  // old confirms and failed runs shouldn't pile up.
  const { jobs, dismissible } = useMemo(() => {
    const visible = allJobs.filter((j) => !isHidden(j.id));
    const active = visible.filter(
      (j) => j.status === "pending" || j.status === "decomposing" || j.status === "modeling",
    );
    const awaiting = visible.filter((j) => j.status === "awaiting");
    const finished = visible.filter((j) => j.status === "done" || j.status === "error");
    return {
      jobs: [...active, ...awaiting.slice(0, 2), ...finished.slice(0, 1)],
      dismissible: awaiting.length + finished.length,
    };
  }, [allJobs]);

  return (
    <div className="mt-6 rounded-xl border border-base-700 bg-base-900 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Boxes size={15} className="text-accent-400" />
          <h3 className="text-sm font-medium text-slate-200">Decompose &amp; Send to 3D</h3>
        </div>
        {dismissible > 1 && (
          <button
            onClick={clearFinishedJobs}
            className="text-[11px] text-slate-500 hover:text-slate-300"
          >
            Clear finished
          </button>
        )}
        <label
          className="flex items-center gap-1.5 text-[11px] text-slate-400 select-none"
          title="Skip the GPU pipeline — Pillow-only crop, one asset, no ortho views. For shaking out the command/event wiring before spending on the real pipeline. The 3D providers are still called."
        >
          <input type="checkbox" checked={stub} onChange={(e) => setStubMode(e.target.checked)} />
          Stub mode
        </label>
      </div>

      {!stub && <RuntimeCard />}

      {jobs.length === 0 ? (
        <p className="text-xs text-slate-500">
          Click the <span className="text-slate-400">cube</span> icon on any image above to
          decompose it. {stub ? "Stub mode is on — no GPU pipeline, one placeholder asset." : null}
        </p>
      ) : (
        <div className="space-y-2.5">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} providerKeys={providerKeys} />
          ))}
        </div>
      )}
    </div>
  );
}
