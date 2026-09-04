import { useEffect, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";

const LAST_SPLASH_KEY = "cozyverse-last-splash";
const AUTO_DISMISS_MS = 8000;

type SplashVariant = "exterior" | "interior";

function nextVariant(): SplashVariant {
  const last = localStorage.getItem(LAST_SPLASH_KEY);
  const next: SplashVariant = last === "exterior" ? "interior" : "exterior";
  localStorage.setItem(LAST_SPLASH_KEY, next);
  return next;
}

export function SplashScreen({ onDismiss, onHelp }: { onDismiss: () => void; onHelp: () => void }) {
  const [variant] = useState<SplashVariant>(nextVariant);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const dismiss = () => {
    setClosing(true);
    window.setTimeout(onDismiss, 250);
  };

  // A fixed 8s auto-dismiss doesn't give a real first-time user enough room to notice and click
  // Help before the splash vanishes out from under their cursor — the fix isn't a longer fixed
  // number (still a guess), it's pausing the countdown entirely while they're actually looking at
  // it. Hovering the splash cancels the pending timer; leaving restarts a fresh one, so someone who
  // never interacts still gets the same original behavior, but reading or reaching for a button
  // buys unlimited extra time.
  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const startTimer = () => {
    clearTimer();
    timerRef.current = window.setTimeout(dismiss, AUTO_DISMISS_MS);
  };

  useEffect(() => {
    startTimer();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[100] bg-base-950/95 flex items-center justify-center p-10 transition-opacity duration-300 ${closing ? "opacity-0" : "opacity-100"}`}
      onClick={dismiss}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
    >
      <div className="relative max-w-2xl w-full">
        <img
          src={`/splash/${variant}.png`}
          alt="Cozyverse Studio"
          className="w-full h-auto max-h-[70vh] object-contain rounded-2xl border border-white/10 shadow-2xl"
        />
        <div className="absolute -top-3 -right-3 flex items-center gap-2">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onHelp();
            }}
            aria-label="Open Help & Documentation"
            title="Help & Documentation"
            className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-black/60 hover:bg-black/80 rounded-full px-3 py-1.5 transition"
          >
            <HelpCircle size={14} /> Help
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              dismiss();
            }}
            aria-label="Close splash screen"
            className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-black/60 hover:bg-black/80 rounded-full px-3 py-1.5 transition"
          >
            <X size={14} /> Skip
          </button>
        </div>
      </div>
    </div>
  );
}
