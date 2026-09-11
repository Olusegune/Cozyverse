import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { hasSeenGenerateNote, markSeenGenerateNote } from "../lib/onboarding";

/** Shown once, above the first Generate button someone reaches (Image Studio,
 * since it's first in the flow) — the trust signal that makes hitting Generate
 * for the first time feel safe: nothing gets overwritten. Dismissed forever
 * after the first close or the first successful generate. */
export function GenerateTrustNote() {
  const [dismissed, setDismissed] = useState(hasSeenGenerateNote);
  if (dismissed) return null;

  const dismiss = () => {
    markSeenGenerateNote();
    setDismissed(true);
  };

  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs">
      <ShieldCheck size={15} className="text-emerald-400 mt-0.5 shrink-0" />
      <p className="text-slate-300 flex-1">
        Every generation is kept — nothing here ever overwrites a previous version, and deleting
        anything moves it to a recoverable trash folder instead of erasing it. Generate freely.
      </p>
      <button onClick={dismiss} className="text-slate-500 hover:text-white shrink-0" aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}
