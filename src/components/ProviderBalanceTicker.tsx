import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { decomposeProviderKeys, providerBalance } from "../lib/decompose";

const REFRESH_MS = 90_000;

/** Ambient spend visibility in the sidebar, so checking your 3D-provider
 * balance doesn't require a trip into Settings. Tripo/Meshy are the only
 * providers with a real numeric balance endpoint today — this deliberately
 * does NOT claim to total spend across every provider (OpenAI/Gemini/fal
 * don't expose one via API key auth), since a fabricated or silently-wrong
 * number would be worse than no ticker at all. */
export function ProviderBalanceTicker() {
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [keyed, setKeyed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void decomposeProviderKeys().then((k) => !cancelled && setKeyed(k)).catch(() => {});
      void providerBalance().then((b) => !cancelled && setBalances(b)).catch(() => {});
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const rows = (["tripo", "meshy"] as const).filter((p) => keyed[p] && typeof balances[p] === "number");
  if (rows.length === 0) return null;

  return (
    <div
      className="mx-2 mb-2 flex items-center gap-1.5 rounded-lg bg-base-800/60 px-2.5 py-1.5 text-[11px] text-slate-400"
      title="Live Tripo/Meshy credit balance — used by Decompose's 3D path"
    >
      <Coins size={12} className="text-accent-400 shrink-0" />
      <span className="truncate">
        {rows.map((p) => `${p[0].toUpperCase()}${p.slice(1)} ${Math.round(balances[p] as number)}`).join(" · ")}
      </span>
    </div>
  );
}
