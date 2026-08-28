import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Images,
  Loader2,
  RotateCw,
  View,
  X,
  XCircle,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";

const ModelViewer = lazy(() => import("./ModelViewer"));
import {
  decomposeProviderKeys,
  estimateGenerations,
  hideJob,
  hydrateDecompositions,
  isHidden,
  isJobActive,
  jobProgress,
  clearFinishedJobs,
  cancelJob,
  retryFailed,
  providerBalance,
  decomposeAssetUrl,
  librarySearch,
  libraryAttach,
  libraryDetach,
  libraryFinalize,
  type LibraryCandidate,
  decomposeScenePath,
  exportDecomposePack,
  exportPackEstimate,
  useExportProgress,
  revealDecomposeOutput,
  setStubMode,
  setViewsMode,
  submitDecomposition,
  useDecompositions,
  useDecomposeIntent,
  useStubMode,
  useViewsMode,
  decomposeRuntimeStatus,
  setupDecomposeRuntime,
  useSetupProgress,
  type DecomposeJob,
  type DecomposedAsset,
  type ModelJob,
  type RuntimeStatus,
} from "../lib/decompose";

const PATH_LABEL: Record<string, string> = { fast: "Fast", quality: "Quality", library: "Library" };

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

/** The two image-path exports — free (pipeline outputs) and paid (AI turnaround)
 * — plus a live progress bar while the AI pack renders. Used in the confirm
 * block and on finished jobs. */
function ImagePackActions({ jobId, compact }: { jobId: string; compact?: boolean }) {
  const dirName = useAppStore((s) => s.dirName);
  const progress = useExportProgress();
  const [est, setEst] = useState<{ totalImages: number; provider: string | null } | null>(null);
  const [busy, setBusy] = useState<"free" | "ai" | null>(null);

  useEffect(() => {
    if (dirName) void exportPackEstimate(dirName, jobId).then(setEst).catch(() => {});
  }, [dirName, jobId]);

  const active = progress && progress.jobId === jobId && progress.done < progress.total;
  const run = (aiViews: boolean) => {
    if (!dirName) return;
    setBusy(aiViews ? "ai" : "free");
    void exportDecomposePack(dirName, jobId, aiViews)
      .catch(() => {})
      .finally(() => setBusy(null));
  };

  return (
    <div className={compact ? "" : "mt-1.5"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => run(false)}
          disabled={busy !== null}
          className={
            compact
              ? "flex items-center gap-1.5 text-[11px] text-accent-400 hover:text-accent-300 disabled:opacity-50"
              : "px-3 py-1 rounded-md border border-accent-500/50 text-accent-300 hover:bg-accent-500/10 disabled:opacity-50"
          }
        >
          {compact && <FolderOpen size={12} />}
          {busy === "free" ? "Saving…" : compact ? "Image pack (.zip)" : "Download image pack (.zip)"}
        </button>
        <button
          onClick={() => run(true)}
          disabled={busy !== null || !!active || est?.provider == null}
          title={
            est?.provider == null
              ? "Needs a Gemini or OpenAI API key (Settings)"
              : `Re-render all 5 views per object as clean white-background images via ${est.provider}. ~${est.totalImages} paid image generations.`
          }
          className={
            compact
              ? "flex items-center gap-1.5 text-[11px] text-accent-400 hover:text-accent-300 disabled:opacity-40"
              : "px-3 py-1 rounded-md border border-accent-500/50 text-accent-300 hover:bg-accent-500/10 disabled:opacity-40"
          }
        >
          {compact && <FolderOpen size={12} />}
          {busy === "ai"
            ? "Rendering…"
            : `AI turnaround${est ? ` · ~${est.totalImages} imgs` : ""} (paid)`}
        </button>
      </div>
      {active && (
        <div className="mt-1.5">
          <div className="h-1 rounded-full bg-base-800 overflow-hidden">
            <div
              className="h-full bg-accent-500 transition-all"
              style={{ width: `${Math.round((progress!.done / progress!.total) * 100)}%` }}
            />
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500 truncate">
            {progress!.done}/{progress!.total} — {progress!.message}
          </p>
        </div>
      )}
    </div>
  );
}

/** The pipeline's white-background cutout of one detected object, loaded through
 * the Tauri asset protocol. Falls back to a class-name chip if it can't load. */
function AssetCutout({ asset, className }: { asset: DecomposedAsset; className?: string }) {
  const dirName = useAppStore((s) => s.dirName);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    if (dirName) {
      void decomposeAssetUrl(dirName, asset.perspectiveImage).then((u) => ok && setUrl(u));
    }
    return () => {
      ok = false;
    };
  }, [dirName, asset.perspectiveImage]);
  return url ? (
    <img src={url} alt={asset.class} className={`object-contain bg-white ${className ?? ""}`} />
  ) : (
    <div className={`flex items-center justify-center bg-base-800 text-[9px] text-slate-500 ${className ?? ""}`}>
      {asset.class}
    </div>
  );
}

/** The third path: pull a ready-made CC0 model per object from Poly Haven. */
function LibrarySection({ job }: { job: DecomposeJob }) {
  const dirName = useAppStore((s) => s.dirName);
  const [cands, setCands] = useState<Record<string, LibraryCandidate[] | "loading">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const find = async (a: DecomposedAsset) => {
    setCands((c) => ({ ...c, [a.id]: "loading" }));
    try {
      const results = await librarySearch(a.class);
      setCands((c) => ({ ...c, [a.id]: results }));
    } catch {
      setCands((c) => ({ ...c, [a.id]: [] }));
    }
  };
  const attachedCount = job.assets.filter((a) =>
    a.models.some((m) => m.provider === "library"),
  ).length;

  const pick = async (a: DecomposedAsset, cand: LibraryCandidate) => {
    if (!dirName) return;
    setBusy(a.id);
    try {
      await libraryAttach(dirName, job.id, a.id, cand.id);
      setCands((c) => {
        const n = { ...c };
        delete n[a.id];
        return n;
      });
    } catch {
      /* leave the strip open so they can retry */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 rounded-md border-l-2 border-emerald-500/60 pl-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
        <Boxes size={12} /> Asset library — free (CC0)
      </div>
      <p className="mt-0.5 text-slate-400">
        Attach a ready-made model for an object instead of generating it — clean topology, authored
        materials, no spend. All CC0 (Poly Haven); a <b className="text-slate-300">CREDITS.txt</b> is
        written to the project automatically.
      </p>
      <div className="mt-1.5 space-y-1.5">
        {job.assets.map((a) => {
          const attached = a.models.find((m) => m.provider === "library");
          const list = cands[a.id];
          return (
            <div key={a.id} className="rounded border border-base-700 p-1.5">
              <div className="flex items-center gap-2">
                <AssetCutout asset={a} className="h-7 w-7 rounded shrink-0" />
                <span className="capitalize text-slate-300">{a.class}</span>
                {attached ? (
                  <span className="ml-auto flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 size={12} />
                    <span className="max-w-[120px] truncate" title={attached.author ?? undefined}>
                      {attached.author ?? attached.source ?? "attached"}
                    </span>
                    <button
                      onClick={() => dirName && void libraryDetach(dirName, job.id, a.id).catch(() => {})}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      remove
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => void find(a)}
                    disabled={list === "loading"}
                    className="ml-auto text-accent-400 hover:text-accent-300 disabled:opacity-50"
                  >
                    {list === "loading" ? "searching…" : "Find a free asset"}
                  </button>
                )}
              </div>
              {Array.isArray(list) && !attached && list.length > 0 && (
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                  {list.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => void pick(a, c)}
                      disabled={busy === a.id}
                      title={`${c.name} · ${c.author} · ${c.license}${
                        c.polycount ? ` · ${c.polycount.toLocaleString()} tris` : ""
                      }`}
                      className="w-16 shrink-0 rounded border border-base-700 hover:border-accent-500 disabled:opacity-50"
                    >
                      <img
                        src={c.thumbnailUrl}
                        alt={c.name}
                        className="h-16 w-16 rounded-t bg-white object-cover"
                      />
                      <div className="truncate px-1 py-0.5 text-[9px] text-slate-400">{c.name}</div>
                    </button>
                  ))}
                </div>
              )}
              {Array.isArray(list) && !attached && list.length === 0 && (
                <p className="mt-1 text-[10px] text-slate-500">No CC0 match for “{a.class}”.</p>
              )}
            </div>
          );
        })}
      </div>
      {attachedCount > 0 && (
        <button
          onClick={() => dirName && void libraryFinalize(dirName, job.id).catch(() => {})}
          className="mt-2 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          Use {attachedCount} library asset{attachedCount > 1 ? "s" : ""} &amp; finish
        </button>
      )}
    </div>
  );
}

function ConfirmBlock({
  job,
  providerKeys,
}: {
  job: DecomposeJob;
  providerKeys: Record<string, boolean>;
}) {
  const dirName = useAppStore((s) => s.dirName);
  const intent = useDecomposeIntent();
  const keyed = ALL_PROVIDERS.filter((p) => providerKeys[p]);
  const [quality, setQuality] = useState(false);
  const [chosen, setChosen] = useState<string[]>(keyed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(job.assets.map((a) => a.id)),
  );
  const [balances, setBalances] = useState<Record<string, number | null>>({});

  useEffect(() => {
    void providerBalance().then(setBalances).catch(() => {});
  }, []);
  // New assets showing up (a re-decompose) → select them too.
  useEffect(() => {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const a of job.assets) if (!cur.has(a.id)) next.add(a.id);
      return next;
    });
  }, [job.assets]);

  const toggleAsset = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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

  const estimate = estimateGenerations(job, Math.max(chosen.length, 1), quality, (id) =>
    selected.has(id),
  );
  const hasViews = job.assets.some(
    (a) => a.orthoViews.left || a.orthoViews.back || a.orthoViews.right,
  );
  const lowBalance = chosen.some(
    (p) => typeof balances[p] === "number" && (balances[p] as number) < estimate,
  );

  const send = async () => {
    if (!dirName || chosen.length === 0 || selected.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await submitDecomposition(dirName, job.id, {
        qualityPath: quality,
        providers: chosen,
        assetIds: [...selected],
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const lead3d = intent === "3d";

  return (
    <div className="mt-2 flex flex-col rounded-md border border-base-600 bg-base-800/40 p-2.5 text-xs">
      <div className="text-slate-300 font-medium" style={{ order: 0 }}>
        {job.assets.length} object(s) found —{" "}
        {lead3d ? "generate 3D models, or grab the images instead" : "grab the image cutouts, or send to 3D instead"}
      </div>

      {/* ---- Image path -------------------------------------------------- */}
      <div
        className={`mt-2.5 rounded-md border-l-2 pl-2 ${
          lead3d ? "border-transparent opacity-70" : "border-sky-500"
        }`}
        style={{ order: lead3d ? 2 : 1 }}
      >
        <div
          className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
            lead3d ? "text-slate-500" : "text-sky-400"
          }`}
        >
          <Images size={12} /> Image path
        </div>
        <p className="mt-0.5 text-slate-400">
          A .zip of every object for your own image-to-3D tool.{" "}
          <b className="text-slate-300">Free</b>: the pipeline's cutout
          {hasViews ? " + Zero123++ side views" : ""}, as-is.{" "}
          <b className="text-slate-300">AI turnaround</b>: all five views per object re-rendered
          large and clean on white by an image model — perspective/front are observed, back/sides
          are inferred. Paid.
        </p>
        <ImagePackActions jobId={job.id} />
      </div>

      {/* ---- 3D path --------------------------------------------------- */}
      <div
        className={`mt-3 rounded-md border-l-2 pl-2 ${
          lead3d ? "border-accent-500" : "border-transparent opacity-70"
        }`}
        style={{ order: lead3d ? 1 : 2 }}
      >
        <div
          className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
            lead3d ? "text-accent-400" : "text-slate-500"
          }`}
        >
          <Boxes size={12} /> 3D path — paid
        </div>
        <p className="mt-0.5 text-slate-400">
          Generate textured <b className="text-slate-300">.glb</b> models with Tripo / Meshy.
        </p>

        {/* object picker — don't pay for junk detections */}
        <div className="mt-2">
          <div className="flex items-center justify-between text-slate-500">
            <span>
              Objects to generate — <b className="text-slate-300">{selected.size}</b>/
              {job.assets.length}
            </span>
            <button
              className="hover:text-slate-300"
              onClick={() =>
                setSelected((cur) =>
                  cur.size === job.assets.length
                    ? new Set()
                    : new Set(job.assets.map((a) => a.id)),
                )
              }
            >
              {selected.size === job.assets.length ? "clear all" : "select all"}
            </button>
          </div>
          <div className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
            {job.assets.map((a) => {
              const on = selected.has(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => toggleAsset(a.id)}
                  title={a.class}
                  className={`relative rounded border text-left transition ${
                    on ? "border-accent-500" : "border-base-700 opacity-40 hover:opacity-70"
                  }`}
                >
                  <AssetCutout asset={a} className="h-14 w-full rounded-t" />
                  <div className="truncate px-1 py-0.5 text-[9px] text-slate-400">{a.class}</div>
                  {on && (
                    <CheckCircle2
                      size={12}
                      className="absolute right-0.5 top-0.5 text-accent-400 drop-shadow"
                    />
                  )}
                </button>
              );
            })}
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
          className={`mt-1.5 flex items-center gap-1.5 select-none ${
            hasViews ? "text-slate-500" : "text-slate-600"
          }`}
          title={
            hasViews
              ? "Experimental: feeds the synthesized left/back/right views to each provider's multi-view endpoint alongside the Fast path. Doubles the spend."
              : "This decomposition has no side views. Turn on “4 side views” above, then decompose again to enable the Quality path."
          }
        >
          <input
            type="checkbox"
            checked={quality && hasViews}
            disabled={!hasViews}
            onChange={(e) => setQuality(e.target.checked)}
          />
          {hasViews
            ? "Also run the 4-view Quality path — experimental (doubles the spend)"
            : "Quality path needs side views (decompose again with “4 side views” on)"}
        </label>

        <div className="mt-1.5 flex items-start gap-1.5 text-amber-300/90">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Starts up to <b>{estimate}</b> paid generation(s) — {selected.size} object(s), Fast
            {quality ? " + Quality" : ""} path{quality ? "s" : ""}.
          </span>
        </div>

        {(typeof balances.tripo === "number" || typeof balances.meshy === "number") && (
          <p className={`mt-1 ${lowBalance ? "text-amber-400" : "text-slate-500"}`}>
            Balance:{" "}
            {ALL_PROVIDERS.filter((p) => chosen.includes(p) && typeof balances[p] === "number")
              .map((p) => `${p} ${Math.round(balances[p] as number)}`)
              .join(" · ") || "—"}
            {lowBalance && " — may not cover this run"}
          </p>
        )}

        {err && <p className="mt-1.5 text-red-400">{err}</p>}
        <button
          onClick={() => void send()}
          disabled={busy || chosen.length === 0 || selected.size === 0}
          className="mt-1.5 px-3 py-1 rounded-md bg-accent-500 hover:bg-accent-400 text-accentText disabled:opacity-50"
        >
          {busy ? "Sending…" : `Send ${selected.size} to 3D`}
        </button>
      </div>

      <div style={{ order: 3 }}>
        <LibrarySection job={job} />
      </div>

      <button
        onClick={() => hideJob(job.id, dirName ?? undefined)}
        disabled={busy}
        className="mt-3 text-left text-slate-500 hover:text-slate-300 disabled:opacity-50"
        style={{ order: 4 }}
      >
        Discard this decomposition
      </button>
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
  const [showUsage, setShowUsage] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const { done, total } = jobProgress(job);

  const failedCount = useMemo(
    () => job.assets.flatMap((a) => a.models).filter((m) => m.status === "failed").length,
    [job.assets],
  );

  const openPreview = (m: ModelJob) => {
    if (!m.glbPath || !dirName) return;
    if (previewKey === m.key) {
      setPreviewKey(null);
      setPreviewUrl(null);
      return;
    }
    setPreviewKey(m.key);
    setPreviewUrl(null);
    void decomposeAssetUrl(dirName, m.glbPath).then(setPreviewUrl);
  };
  const previewModel = job.assets
    .flatMap((a) => a.models)
    .find((m) => m.key === previewKey);
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
          {job.status === "modeling" && (
            <button
              onClick={() => dirName && void cancelJob(dirName, job.id).catch(() => {})}
              className="text-[11px] text-slate-500 hover:text-red-400"
              title="Stop this fan-out. Models already finished are kept; the rest are cancelled."
            >
              Stop
            </button>
          )}
          {!isJobActive(job) && (
            <button
              onClick={() => hideJob(job.id, dirName ?? undefined)}
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
                {asset.models.map((m) => {
                  const cell = (
                    <>
                      <StatusDot status={m.status} />
                      <span className="capitalize text-slate-300">{m.provider}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-500">
                        {PATH_LABEL[m.pathKind] ?? m.pathKind}
                      </span>
                      {m.glbPath &&
                        (previewKey === m.key ? (
                          <View size={11} className="ml-auto text-accent-400" />
                        ) : (
                          <span className="ml-auto text-[10px] text-emerald-500">GLB</span>
                        ))}
                    </>
                  );
                  return m.glbPath ? (
                    <button
                      key={m.key}
                      onClick={() => openPreview(m)}
                      title="Preview this model"
                      className={`flex items-center gap-1.5 rounded px-2 py-1 text-left ${
                        previewKey === m.key
                          ? "bg-accent-500/15 ring-1 ring-accent-500/50"
                          : "bg-base-800/70 hover:bg-base-800"
                      }`}
                    >
                      {cell}
                    </button>
                  ) : (
                    <div
                      key={m.key}
                      className="flex items-center gap-1.5 rounded bg-base-800/70 px-2 py-1"
                      title={m.error ?? undefined}
                    >
                      {cell}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {(() => {
            const lib = job.assets
              .flatMap((a) => a.models)
              .filter((m) => m.provider === "library");
            return lib.length > 0 ? (
              <p className="text-[10px] text-slate-500">
                CC0 assets ({lib.length}) — attribution in the project's{" "}
                <span className="text-slate-400">CREDITS.txt</span>:{" "}
                {lib
                  .map((m) => m.author)
                  .filter((v, i, arr) => v && arr.indexOf(v) === i)
                  .join(", ")}
              </p>
            ) : null;
          })()}

          {previewKey && (
            <div className="rounded-md border border-base-700 bg-base-950 p-1.5">
              <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                <span className="capitalize">
                  {previewModel?.provider} · {PATH_LABEL[previewModel?.pathKind ?? ""] ?? previewModel?.pathKind}{" "}
                  — drag to rotate
                </span>
                <button
                  onClick={() => {
                    setPreviewKey(null);
                    setPreviewUrl(null);
                  }}
                  className="hover:text-slate-300"
                >
                  <X size={12} />
                </button>
              </div>
              {previewUrl ? (
                <Suspense
                  fallback={
                    <div className="flex h-56 items-center justify-center text-[11px] text-slate-500">
                      <Loader2 size={12} className="mr-1.5 animate-spin" /> loading viewer…
                    </div>
                  }
                >
                  <ModelViewer src={previewUrl} className="h-56 w-full" />
                </Suspense>
              ) : (
                <div className="flex h-56 items-center justify-center text-[11px] text-slate-500">
                  <Loader2 size={12} className="mr-1.5 animate-spin" /> opening…
                </div>
              )}
            </div>
          )}

          {failedCount > 0 && !isJobActive(job) && (
            <button
              onClick={() => {
                if (!dirName) return;
                setRetrying(true);
                void retryFailed(dirName, job.id)
                  .catch(() => {})
                  .finally(() => setRetrying(false));
              }}
              disabled={retrying}
              className="flex items-center gap-1.5 rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
            >
              <RotateCw size={12} className={retrying ? "animate-spin" : ""} />
              {retrying ? "Resubmitting…" : `Retry failed (${failedCount})`}
            </button>
          )}
        </div>
      )}

      {job.assets.some((a) => a.models.some((m) => m.glbPath)) && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
                title="Reveal scene.json — the layout manifest the Blender add-on reads and any Unity/Unreal importer can use"
              >
                <FolderOpen size={12} /> Scene file (Blender / Unity / Unreal)
              </button>
            )}
            <button
              onClick={() => setShowUsage((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300"
            >
              {showUsage ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              How to use these files
            </button>
          </div>

          <div className="mt-1.5">
            <ImagePackActions jobId={job.id} compact />
          </div>

          {showUsage && (
            <div className="mt-2 rounded-md border border-base-700 bg-base-800/40 p-2.5 text-[11px] text-slate-400 leading-relaxed space-y-2">
              <p>
                Every model is a standard textured <b className="text-slate-300">.glb</b> in{" "}
                <span className="text-slate-300">assets/models/</span>, named{" "}
                <span className="text-slate-300">&lt;object&gt;_&lt;provider&gt;_&lt;path&gt;.glb</span>.
                <span className="text-slate-300"> scene.json</span> (next to the job) lists every
                object with its source-image bounding box, so an importer can lay the pieces back
                out.
              </p>
              <p>
                <b className="text-slate-300">Blender</b> — install{" "}
                <span className="text-slate-300">integrations/blender/cozyverse_bridge.py</span> via
                Edit ▸ Preferences ▸ Add-ons ▸ Install, then Sidebar (N) ▸ Cozyverse ▸ point at
                scene.json ▸ Import Decomposed Scene. Or just File ▸ Import ▸ glTF 2.0 a single
                model.
              </p>
              <p>
                <b className="text-slate-300">Unity</b> — drop the .glb files into{" "}
                <span className="text-slate-300">Assets/</span> (needs the glTFast or UnityGLTF
                package), drag each into the scene. <b className="text-slate-300">Unreal</b> — File
                ▸ Import Into Level, or drag the .glb into the Content Browser (Interchange glTF is
                on by default in UE 5.x).
              </p>
              <p className="text-slate-500">
                Full walkthrough: <span className="text-slate-400">docs/decompose-to-3d-tutorial/</span>{" "}
                and <span className="text-slate-400">integrations/blender/README.md</span>.
              </p>
            </div>
          )}
        </>
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
  const views = useViewsMode();
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
    <div id="decompose-panel" className="mt-6 rounded-xl border border-base-700 bg-base-900 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Boxes size={15} className="text-accent-400" />
          <h3 className="text-sm font-medium text-slate-200">Decompose to 3D or images</h3>
        </div>
        <div className="flex items-center gap-3">
          {dismissible > 1 && (
            <button
              onClick={() => clearFinishedJobs(dirName ?? undefined)}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              Clear finished
            </button>
          )}
          <label
            className={`flex items-center gap-1.5 text-[11px] select-none ${
              stub ? "text-slate-600" : "text-slate-400"
            }`}
            title="Full GPU pipeline only: also synthesize left/back/right views per object (Zero123++, ~90 s extra). Needed for the Quality path and a richer image pack. Off = perspective crops only, much faster."
          >
            <input
              type="checkbox"
              checked={views}
              disabled={stub}
              onChange={(e) => setViewsMode(e.target.checked)}
            />
            4 side views
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] text-slate-400 select-none"
            title="Skip the GPU pipeline — Pillow-only crop, one asset, no ortho views. For shaking out the command/event wiring before spending on the real pipeline. The 3D providers are still called."
          >
            <input type="checkbox" checked={stub} onChange={(e) => setStubMode(e.target.checked)} />
            Stub mode
          </label>
        </div>
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
