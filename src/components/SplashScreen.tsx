import { useEffect, useState } from "react";
import { X } from "lucide-react";

const LAST_SPLASH_KEY = "cozyverse-last-splash";
const AUTO_DISMISS_MS = 8000;

type SplashVariant = "exterior" | "interior";

function nextVariant(): SplashVariant {
  const last = localStorage.getItem(LAST_SPLASH_KEY);
  const next: SplashVariant = last === "exterior" ? "interior" : "exterior";
  localStorage.setItem(LAST_SPLASH_KEY, next);
  return next;
}

export function SplashScreen({ onDismiss }: { onDismiss: () => void }) {
  const [variant] = useState<SplashVariant>(nextVariant);
  const [closing, setClosing] = useState(false);

  const dismiss = () => {
    setClosing(true);
    window.setTimeout(onDismiss, 250);
  };

  useEffect(() => {
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[100] bg-base-950/95 flex items-center justify-center p-10 transition-opacity duration-300 ${closing ? "opacity-0" : "opacity-100"}`}
      onClick={dismiss}
    >
      <div className="relative max-w-2xl w-full">
        <img
          src={`/splash/${variant}.png`}
          alt="Cozyverse Studio"
          className="w-full h-auto max-h-[70vh] object-contain rounded-2xl border border-white/10 shadow-2xl"
        />
        <button
          onClick={(event) => {
            event.stopPropagation();
            dismiss();
          }}
          aria-label="Close splash screen"
          className="absolute -top-3 -right-3 flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-black/60 hover:bg-black/80 rounded-full px-3 py-1.5 transition"
        >
          <X size={14} /> Skip
        </button>
      </div>
    </div>
  );
}
