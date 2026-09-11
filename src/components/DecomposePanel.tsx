import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
  Play,
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
  type ExportPackEstimate,
  exportTurnaround,
  type TurnaroundFrame,
  exportCombinedScene,
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

function stageLine(job: DecomposeJob): string {
  switch (job.status) {
    case "pending":
      return "Queued…";
    case "decomposing":
      return "Segmenting & generating views…";
    case "awaiting":
      return "choose a path below";
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
  const [est, setEst] = useState<ExportPackEstimate | null>(null);
  const [busy, setBusy] = useState<"free" | "ai" | null>(null);
  const [engine, setEngine] = useState<string>("");

  useEffect(() => {
    if (dirName)
      void exportPackEstimate(dirName, jobId)
        .then((e) => {
          setEst(e);
          if (e.engines[0] && !engine) setEngine(e.engines[0].id);
        })
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirName, jobId]);

  const active = progress && progress.jobId === jobId && progress.done < progress.total;
  const engines = est?.engines ?? [];
  const run = (aiViews: boolean) => {
    if (!dirName) return;
    setBusy(aiViews ? "ai" : "free");
    void exportDecomposePack(dirName, jobId, aiViews, aiViews ? engine : undefined)
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
          disabled={busy !== null || !!active || engines.length === 0}
          title={
            engines.length === 0
              ? "Needs a Gemini, fal, or OpenAI API key (Settings)"
              : `Re-render all 5 views per object (perspective + front/back/left/right) as clean white-background images. ~${est?.totalImages ?? "?"} paid generations.`
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
        {engines.length > 0 && (
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            disabled={busy !== null || !!active}
            title="Which image model renders the views"
            className="rounded-md border border-base-600 bg-base-800 px-1.5 py-1 text-[11px] text-slate-300 disabled:opacity-50"
          >
            {engines.map((en) => (
              <option key={en.id} value={en.id}>
                {en.label} — {en.note}
              </option>
            ))}
          </select>
        )}
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

/** A polished object card: the cutout on a soft light stage, a legible label,
 * and an overlay slot for a badge (checkbox / play / status). One look for the
 * confirm-block picker and the finished-job gallery. */
function ObjectThumb({
  asset,
  imgH = "h-24",
  active,
  dim,
  onClick,
  overlay,
  footer,
  title,
}: {
  asset: DecomposedAsset;
  imgH?: string;
  active?: boolean;
  dim?: boolean;
  onClick?: () => void;
  overlay?: ReactNode;
  footer?: ReactNode;
  title?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      title={title ?? asset.class}
      className={`group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all ${
        active
          ? "border-accent-500 ring-2 ring-accent-500/30"
          : "border-base-700 hover:border-base-600"
      } ${dim ? "opacity-55 grayscale hover:opacity-90 hover:grayscale-0" : ""}`}
    >
      <div
        className={`relative w-full ${imgH}`}
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, #fefefe 0%, #f1f0ee 55%, #d9d8d5 100%)",
        }}
      >
        <AssetCutout asset={asset} className="absolute inset-0 h-full w-full p-1.5" />
        {overlay && <div className="absolute inset-0">{overlay}</div>}
      </div>
      <div className="truncate border-t border-base-800 bg-base-900/90 px-1.5 py-1 text-[10px] capitalize text-slate-300">
        {asset.class}
      </div>
      {footer}
    </Tag>
  );
}

type PathTab = "3d" | "images" | "library";

const TAB_META: Record<PathTab, { label: string; sub: string; on: string }> = {
  "3d": {
    label: "3D models",
    sub: "paid",
    on: "bg-accent-500/15 text-accent-300 ring-1 ring-accent-500/40",
  },
  images: {
    label: "Images",
    sub: "free",
    on: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40",
  },
  library: {
    label: "Free Models",
    sub: "free",
    on: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40",
  },
};

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

  const [tab, setTab] = useState<PathTab>(intent === "images" ? "images" : "3d");
  const [quality, setQuality] = useState(false);
  const [chosen, setChosen] = useState<string[]>(keyed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(job.assets.map((a) => a.id)),
  );
  const [balances, setBalances] = useState<Record<string, number | null>>({});

  // --- asset library state ---
  const [cands, setCands] = useState<Record<string, LibraryCandidate[] | "loading">>({});
  const [libBusy, setLibBusy] = useState<string | null>(null);
  const [openLib, setOpenLib] = useState<string | null>(null);

  useEffect(() => {
    void providerBalance().then(setBalances).catch(() => {});
  }, []);
  useEffect(() => {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const a of job.assets) if (!cur.has(a.id)) next.add(a.id);
      return next;
    });
  }, [job.assets]);
  useEffect(() => {
    setChosen((cur) => {
      const next = cur.filter((p) => keyed.includes(p as (typeof ALL_PROVIDERS)[number]));
      return next.length ? next : keyed;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKeys]);

  const toggleAsset = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleProvider = (p: string) =>
    setChosen((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const estimate = estimateGenerations(job, Math.max(chosen.length, 1), quality, (id) =>
    selected.has(id),
  );
  const hasViews = job.assets.some(
    (a) => a.orthoViews.left || a.orthoViews.back || a.orthoViews.right,
  );
  const shortProviders = ALL_PROVIDERS.filter(
    (p) => chosen.includes(p) && typeof balances[p] === "number" && (balances[p] as number) < estimate,
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

  const findAssets = async (a: DecomposedAsset) => {
    setCands((c) => ({ ...c, [a.id]: "loading" }));
    try {
      const results = await librarySearch(a.class, dirName ?? undefined, job.id, a.id);
      setCands((c) => ({ ...c, [a.id]: results }));
    } catch {
      setCands((c) => ({ ...c, [a.id]: [] }));
    }
  };
  const pickAsset = async (a: DecomposedAsset, cand: LibraryCandidate) => {
    if (!dirName) return;
    setLibBusy(a.id);
    try {
      await libraryAttach(dirName, job.id, a.id, cand.id);
      setOpenLib(null);
    } catch {
      /* keep the strip open to retry */
    } finally {
      setLibBusy(null);
    }
  };
  const attachedCount = job.assets.filter((a) =>
    a.models.some((m) => m.provider === "library"),
  ).length;

  const allSelected = selected.size === job.assets.length;

  return (
    <div className="mt-2 rounded-lg border border-base-600 bg-base-800/40 text-xs">
      {/* header */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-base-700">
        <span className="font-medium text-slate-200">{job.assets.length} objects found</span>
        <button
          onClick={() => hideJob(job.id, dirName ?? undefined)}
          disabled={busy}
          className="text-slate-500 hover:text-slate-300 disabled:opacity-50"
          title="Discard this decomposition"
        >
          <X size={13} />
        </button>
      </div>

      {/* path tabs */}
      <div className="flex gap-1 px-2.5 pt-2">
        {(Object.keys(TAB_META) as PathTab[]).map((t) => {
          const m = TAB_META[t];
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-baseline gap-1.5 rounded-md px-2.5 py-1 transition ${
                tab === t ? m.on : "text-slate-400 hover:bg-base-700/50"
              }`}
            >
              {m.label}
              <span className="text-[9px] uppercase tracking-wide opacity-70">{m.sub}</span>
            </button>
          );
        })}
      </div>

      {/* shared object grid */}
      <div className="px-3 pt-2.5">
        <div className="flex items-center justify-between text-slate-500">
          <span>
            {tab === "library" ? (
              <>Tap an object to swap it for a ready-made model</>
            ) : (
              <>
                <b className="text-slate-200">{selected.size}</b> of {job.assets.length} objects
                selected
              </>
            )}
          </span>
          {tab !== "library" && (
            <button
              className="rounded px-1.5 py-0.5 hover:bg-base-700/60 hover:text-slate-200"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(job.assets.map((a) => a.id)))
              }
            >
              {allSelected ? "select none" : "select all"}
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
          {job.assets.map((a) => {
            const on = selected.has(a.id);
            const lib = a.models.find((m) => m.provider === "library");
            const libMode = tab === "library";
            const chosenHere = libMode ? openLib === a.id : on;
            return (
              <ObjectThumb
                key={a.id}
                asset={a}
                active={chosenHere || (libMode && !!lib)}
                dim={!libMode && !on}
                onClick={() => {
                  if (libMode) {
                    setOpenLib((cur) => (cur === a.id ? null : a.id));
                    if (!cands[a.id] && !lib) void findAssets(a);
                  } else {
                    toggleAsset(a.id);
                  }
                }}
                overlay={
                  <span className="absolute right-1.5 top-1.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                    {libMode ? (
                      lib ? (
                        <CheckCircle2 size={16} className="fill-emerald-500 text-white" />
                      ) : (
                        <span className="block rounded-full bg-black/25 px-1.5 py-px text-[9px] font-medium text-white">
                          swap
                        </span>
                      )
                    ) : on ? (
                      <CheckCircle2 size={16} className="fill-accent-500 text-white" />
                    ) : (
                      <span className="block h-3.5 w-3.5 rounded-full border-2 border-white/70 bg-black/20" />
                    )}
                  </span>
                }
              />
            );
          })}
        </div>
      </div>

      {/* per-tab controls */}
      <div className="px-2.5 pb-2.5 pt-2">
        {tab === "3d" && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-slate-400">
              <span className="text-slate-500">Generate with</span>
              {keyed.map((p) => (
                <label key={p} className="flex items-center gap-1.5 capitalize select-none">
                  <input
                    type="checkbox"
                    checked={chosen.includes(p)}
                    onChange={() => toggleProvider(p)}
                  />
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
                  ? "Feeds the synthesized left/back/right views to each provider's multi-view endpoint alongside the Fast path. Doubles the spend."
                  : "This decomposition has no side views. Turn on “4 side views” in the panel header, then decompose again."
              }
            >
              <input
                type="checkbox"
                checked={quality && hasViews}
                disabled={!hasViews}
                onChange={(e) => setQuality(e.target.checked)}
              />
              {hasViews
                ? "Also run the 4-view Quality path (doubles the spend)"
                : "Quality path needs side views"}
            </label>

            <div className="mt-2 rounded-md bg-base-900/60 px-2 py-1.5 text-slate-400">
              Up to <b className="text-slate-200">{estimate}</b> generations —{" "}
              {selected.size} object{selected.size === 1 ? "" : "s"}
              {quality ? ", Fast + Quality" : ", Fast path"}.
              {(typeof balances.tripo === "number" || typeof balances.meshy === "number") && (
                <span className="text-slate-500">
                  {"  ·  Balance "}
                  {ALL_PROVIDERS.filter((p) => chosen.includes(p) && typeof balances[p] === "number")
                    .map((p) => `${p} ${Math.round(balances[p] as number)}`)
                    .join(" · ")}
                </span>
              )}
            </div>
            {shortProviders.length > 0 && (
              <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-300">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  {shortProviders.map((p) => `${p} balance ${Math.round(balances[p] as number)}`).join(", ")}{" "}
                  won't cover {estimate} generations — those will fail partway. Deselect objects or
                  a provider.
                </span>
              </div>
            )}

            {err && <p className="mt-1.5 text-red-400">{err}</p>}
            <button
              onClick={() => void send()}
              disabled={busy || chosen.length === 0 || selected.size === 0}
              className="mt-2 rounded-md bg-accent-500 px-3 py-1.5 font-medium text-accentText hover:bg-accent-400 disabled:opacity-50"
            >
              {busy ? "Sending…" : `Send ${selected.size} to 3D`}
            </button>
          </>
        )}

        {tab === "images" && (
          <>
            <p className="text-slate-400">
              A .zip of the {selected.size} selected object{selected.size === 1 ? "" : "s"} for your
              own image-to-3D tool. <b className="text-slate-300">Free</b>: the pipeline's cutout
              {hasViews ? " + side views" : ""}, as-is. <b className="text-slate-300">AI turnaround</b>
              : all five views re-rendered clean on white by an image model (perspective/front
              observed, back/sides inferred) — paid.
            </p>
            <div className="mt-1.5">
              <ImagePackActions jobId={job.id} />
            </div>
          </>
        )}

        {tab === "library" && (
          <>
            <p className="text-slate-400">
              Swap an object for a ready-made <b className="text-slate-300">CC0</b> model (Poly
              Haven) — clean topology, authored materials, no spend. A{" "}
              <b className="text-slate-300">CREDITS.txt</b> is written automatically.
            </p>

            {openLib &&
              (() => {
                const a = job.assets.find((x) => x.id === openLib);
                if (!a) return null;
                const lib = a.models.find((m) => m.provider === "library");
                const list = cands[a.id];
                return (
                  <div className="mt-2 rounded-md border border-base-700 bg-base-900/50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="capitalize text-slate-300">{a.class}</span>
                      {lib && (
                        <span className="ml-auto flex items-center gap-2 text-emerald-400">
                          <CheckCircle2 size={12} />
                          <span className="max-w-[140px] truncate" title={lib.author ?? undefined}>
                            {lib.author ?? lib.source}
                          </span>
                          <button
                            onClick={() =>
                              dirName && void libraryDetach(dirName, job.id, a.id).catch(() => {})
                            }
                            className="text-slate-500 hover:text-slate-300"
                          >
                            remove
                          </button>
                        </span>
                      )}
                      {!lib && (
                        <button
                          onClick={() => void findAssets(a)}
                          disabled={list === "loading"}
                          className="ml-auto text-accent-400 hover:text-accent-300 disabled:opacity-50"
                        >
                          {list === "loading" ? "searching…" : "search again"}
                        </button>
                      )}
                    </div>
                    {list === "loading" && (
                      <p className="mt-2 flex items-center gap-1.5 text-slate-500">
                        <Loader2 size={12} className="animate-spin" /> searching Poly Haven…
                      </p>
                    )}
                    {Array.isArray(list) && !lib && list.length > 0 && (
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                        {list.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => void pickAsset(a, c)}
                            disabled={libBusy === a.id}
                            title={`${c.name} · ${c.author} · ${c.license}${
                              c.polycount ? ` · ${c.polycount.toLocaleString()} tris` : ""
                            }`}
                            className="group w-[92px] shrink-0 overflow-hidden rounded-lg border border-base-700 transition hover:border-emerald-500 hover:ring-2 hover:ring-emerald-500/25 disabled:opacity-50"
                          >
                            <img
                              src={c.thumbnailUrl}
                              alt={c.name}
                              className="h-[92px] w-[92px] bg-white object-cover"
                            />
                            <div className="truncate border-t border-base-800 bg-base-900/90 px-1 py-1 text-[9px] text-slate-300">
                              {c.name}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {libBusy === a.id && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-emerald-400/90">
                        <Loader2 size={11} className="animate-spin" /> downloading model + textures…
                      </p>
                    )}
                    {Array.isArray(list) && !lib && list.length === 0 && (
                      <p className="mt-2 text-[10px] text-slate-500">
                        No CC0 match for “{a.class}”. Try the 3D or Images path for this one.
                      </p>
                    )}
                  </div>
                );
              })()}

            {attachedCount > 0 && (
              <button
                onClick={() => dirName && void libraryFinalize(dirName, job.id).catch(() => {})}
                className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500"
              >
                Use {attachedCount} library asset{attachedCount === 1 ? "" : "s"} &amp; finish
              </button>
            )}
          </>
        )}
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
  const [showUsage, setShowUsage] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [turn, setTurn] = useState<{ done: number; total: number } | null>(null);
  const { done, total } = jobProgress(job);

  const runTurnaround = async () => {
    if (!dirName || turn) return;
    const objs = job.assets.filter((a) => a.models.some((m) => m.glbPath));
    if (objs.length === 0) return;
    setTurn({ done: 0, total: objs.length });
    try {
      const { createTurnaroundRig } = await import("../lib/turnaround");
      const rig = createTurnaroundRig(1024);
      const frames: TurnaroundFrame[] = [];
      try {
        for (let i = 0; i < objs.length; i++) {
          const a = objs[i];
          const m =
            a.models.find((x) => x.glbPath && x.pathKind === "fast") ??
            a.models.find((x) => x.glbPath)!;
          try {
            const url = m.glbPath ? await decomposeAssetUrl(dirName, m.glbPath) : null;
            if (url) {
              const slug = `${String(i).padStart(2, "0")}_${
                a.class.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 40) || "object"
              }`;
              for (const f of await rig.render(url)) {
                frames.push({ objectId: a.id, slug, view: f.view, dataUri: f.dataUri });
              }
            }
          } catch (objErr) {
            console.error(`turnaround: skipped ${a.class}`, objErr);
          }
          setTurn((t) => (t ? { ...t, done: i + 1 } : t));
        }
      } finally {
        rig.dispose();
      }
      if (frames.length) await exportTurnaround(dirName, job.id, frames);
    } catch (e) {
      console.error("turnaround render failed", e);
    } finally {
      setTurn(null);
    }
  };

  const [combining, setCombining] = useState(false);
  const [combineErr, setCombineErr] = useState<string | null>(null);
  const runCombine = async () => {
    if (!dirName || combining) return;
    setCombining(true);
    setCombineErr(null);
    try {
      const { mergeSceneToGlb, loadImageSize, arrayBufferToBase64 } = await import("../lib/sceneMerge");
      const imageUrl = await decomposeAssetUrl(dirName, job.imagePath);
      if (!imageUrl) throw new Error("Source image is missing");
      const size = await loadImageSize(imageUrl);

      const objs: { id: string; class: string; bbox: [number, number, number, number]; glbUrl: string }[] = [];
      for (const a of job.assets) {
        // Same preference order as write_scene_manifest in decompose.rs: a
        // hand-picked library asset first, then a Fast-path generation, then
        // whatever else finished.
        const m =
          a.models.find((x) => x.glbPath && x.provider === "library") ??
          a.models.find((x) => x.glbPath && x.pathKind === "fast") ??
          a.models.find((x) => x.glbPath);
        if (!m?.glbPath) continue;
        const url = await decomposeAssetUrl(dirName, m.glbPath);
        if (url) objs.push({ id: a.id, class: a.class, bbox: a.bbox, glbUrl: url });
      }
      if (objs.length === 0) throw new Error("Nothing to merge — no finished models");

      const buffer = await mergeSceneToGlb(objs, size);
      const dataUri = `data:model/gltf-binary;base64,${arrayBufferToBase64(buffer)}`;
      await exportCombinedScene(dirName, job.id, dataUri);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("combined scene export failed", e);
      setCombineErr(msg);
    } finally {
      setCombining(false);
    }
  };

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

      {job.submitted &&
        job.assets.some((a) => a.models.length > 0) &&
        (() => {
          const withModels = job.assets.filter((a) => a.models.length > 0);
          const skipped = job.assets.length - withModels.length;
          const libModels = job.assets
            .flatMap((a) => a.models)
            .filter((m) => m.provider === "library");
          return (
            <div className="mt-3 space-y-2.5">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                {withModels.map((asset) => {
                  const glbModel = asset.models.find((m) => m.glbPath);
                  const anyRunning = asset.models.some(
                    (m) => m.status === "running" || m.status === "pending",
                  );
                  const allFailed = asset.models.every((m) => m.status === "failed");
                  const previewOpenHere = asset.models.some((m) => m.key === previewKey);
                  return (
                    <ObjectThumb
                      key={asset.id}
                      asset={asset}
                      imgH="h-28"
                      active={previewOpenHere}
                      onClick={glbModel ? () => openPreview(glbModel) : undefined}
                      title={glbModel ? "Preview this model" : asset.class}
                      overlay={
                        <div className="absolute inset-0 flex items-center justify-center">
                          {glbModel ? (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
                              {previewOpenHere ? <View size={15} /> : <Play size={15} className="ml-0.5" />}
                            </span>
                          ) : anyRunning ? (
                            <Loader2 size={18} className="animate-spin text-white/90 drop-shadow" />
                          ) : allFailed ? (
                            <XCircle size={18} className="text-red-400 drop-shadow" />
                          ) : null}
                        </div>
                      }
                      footer={
                        <div className="flex flex-wrap gap-1 bg-base-900/90 px-1.5 pb-1.5">
                          {asset.models.map((m) => {
                            const tone =
                              m.status === "succeeded"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : m.status === "failed"
                                  ? "bg-red-500/15 text-red-300"
                                  : "bg-base-700 text-slate-400";
                            return (
                              <button
                                key={m.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (m.glbPath) openPreview(m);
                                }}
                                title={
                                  m.error ??
                                  `${m.provider} · ${PATH_LABEL[m.pathKind] ?? m.pathKind} · ${m.status}`
                                }
                                className={`rounded px-1 py-px text-[9px] capitalize ${tone} ${
                                  m.key === previewKey ? "ring-1 ring-accent-400" : ""
                                }`}
                              >
                                {m.provider === "library" ? "library" : m.provider}
                                {m.provider !== "library" &&
                                  ` ${(PATH_LABEL[m.pathKind] ?? m.pathKind).slice(0, 1)}`}
                                {m.status === "running" || m.status === "pending" ? " …" : ""}
                              </button>
                            );
                          })}
                        </div>
                      }
                    />
                  );
                })}
              </div>

              {skipped > 0 && (
                <p className="text-[10px] text-slate-600">
                  {skipped} object{skipped === 1 ? "" : "s"} not sent
                </p>
              )}

              {libModels.length > 0 && (
                <p className="text-[10px] text-slate-500">
                  {libModels.length} CC0 asset{libModels.length === 1 ? "" : "s"} — credits in{" "}
                  <span className="text-slate-400">CREDITS.txt</span>:{" "}
                  {libModels
                    .map((m) => m.author)
                    .filter((v, i, arr) => v && arr.indexOf(v) === i)
                    .join(", ")}
                </p>
              )}

              {previewKey && (
                <div className="overflow-hidden rounded-lg border border-base-700">
                  <div className="flex items-center justify-between bg-base-900 px-2.5 py-1.5 text-[10px] text-slate-400">
                    <span className="capitalize">
                      {previewModel?.provider === "library"
                        ? "library asset"
                        : `${previewModel?.provider} · ${
                            PATH_LABEL[previewModel?.pathKind ?? ""] ?? previewModel?.pathKind
                          }`}{" "}
                      <span className="text-slate-600">— drag to rotate · scroll to zoom</span>
                    </span>
                    <button
                      onClick={() => {
                        setPreviewKey(null);
                        setPreviewUrl(null);
                      }}
                      className="hover:text-slate-200"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div
                    className="h-64 w-full"
                    style={{
                      background:
                        "radial-gradient(90% 70% at 50% 35%, #23262e 0%, #14161b 70%, #0d0e12 100%)",
                    }}
                  >
                    {previewUrl ? (
                      <Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                            <Loader2 size={12} className="mr-1.5 animate-spin" /> loading viewer…
                          </div>
                        }
                      >
                        <ModelViewer src={previewUrl} className="h-full w-full !bg-transparent" />
                      </Suspense>
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                        <Loader2 size={12} className="mr-1.5 animate-spin" /> opening…
                      </div>
                    )}
                  </div>
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
          );
        })()}

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
              onClick={() => void runTurnaround()}
              disabled={turn !== null}
              className="flex items-center gap-1.5 text-[11px] text-accent-400 hover:text-accent-300 disabled:opacity-50"
              title="Render a clean 5-view turnaround (perspective + front/back/left/right) of each generated model — the real mesh, geometrically exact, no AI and no spend."
            >
              <RotateCw size={12} className={turn ? "animate-spin" : ""} />
              {turn ? `Rendering ${turn.done}/${turn.total}…` : "Turnaround (.zip)"}
            </button>
            {job.status === "done" && (
              <button
                onClick={() => void runCombine()}
                disabled={combining}
                className="flex items-center gap-1.5 text-[11px] text-accent-400 hover:text-accent-300 disabled:opacity-50"
                title="Merge every object's preferred model into ONE positioned .glb — placed on a virtual floor from its 2D bounding box, same layout math as the Blender add-on. Load it straight into any DCC or engine instead of dragging in loose files one by one."
              >
                <Boxes size={12} className={combining ? "animate-pulse" : ""} />
                {combining ? "Merging…" : "Combined scene (.glb)"}
              </button>
            )}
            {combineErr && <p className="w-full text-[11px] text-red-400">{combineErr}</p>}
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
                <b className="text-slate-300">Just to look at one</b> — click its ▶ in the grid
                above (in-app viewer). Outside the app: double-click the .glb — Windows{" "}
                <b className="text-slate-300">3D&nbsp;Viewer</b> / Paint&nbsp;3D open it; or drag it
                onto <span className="text-slate-300">gltf-viewer.donmccurdy.com</span> or{" "}
                <span className="text-slate-300">sandbox.babylonjs.com</span> in a browser; VS Code
                with the <span className="text-slate-300">glTF Tools</span> extension also previews
                it.
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
