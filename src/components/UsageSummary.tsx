import { useMemo } from "react";
import { CircleDollarSign } from "lucide-react";
import { modelById } from "../lib/providers/modelRegistry";
import type { GenerationJob } from "../types";

/** A plain-language usage summary for this project's real (paid-provider) generations — deliberately
 * NOT a dollar total. No pricing data is wired into the model registry (costHint is a relative
 * "low"/"medium"/"high" label, not a real per-call price, and per-provider pricing changes and
 * varies by resolution/duration in ways this app has no visibility into), so inventing a $ figure
 * would be a fabricated number dressed up as a real one — worse than no number at all. This instead
 * counts real completed jobs by provider and by cost tier, which is honest about what's actually
 * knowable from local data. */
export function UsageSummary({ generations }: { generations: GenerationJob[] }) {
  const stats = useMemo(() => {
    const real = generations.filter((job) => job.provider !== "mock" && job.status === "completed");
    const byProvider = new Map<string, number>();
    const byTier: Record<"low" | "medium" | "high" | "unknown", number> = { low: 0, medium: 0, high: 0, unknown: 0 };
    for (const job of real) {
      byProvider.set(job.provider, (byProvider.get(job.provider) ?? 0) + 1);
      const tier = modelById(job.model)?.costHint ?? "unknown";
      byTier[tier] += 1;
    }
    return { total: real.length, byProvider: [...byProvider.entries()].sort((a, b) => b[1] - a[1]), byTier };
  }, [generations]);

  if (stats.total === 0) return null;

  return (
    <div className="rounded-lg border border-base-700 bg-base-900 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <CircleDollarSign size={14} className="text-accent-400" />
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Real Generations, This Project</h3>
      </div>
      <p className="text-sm text-white mb-1.5">
        {stats.total} real generation{stats.total === 1 ? "" : "s"} completed
        {stats.byTier.high > 0 && <span className="text-[11px] text-slate-500"> · {stats.byTier.high} high-cost-tier</span>}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {stats.byProvider.map(([provider, count]) => (
          <span key={provider} className="text-[11px] text-slate-500">
            {provider}: <span className="text-slate-300">{count}</span>
          </span>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 mt-2">
        Counts, not dollars — this app doesn't have real per-call pricing wired in, so a $ total here would be a guess dressed up as a fact. Check
        your provider's own dashboard for actual spend.
      </p>
    </div>
  );
}
