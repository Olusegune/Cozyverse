import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Lightbox({ src, alt, onClose, actions }: { src: string; alt: string; onClose: () => void; actions?: ReactNode }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-8" onClick={onClose}>
      <img src={src} alt={alt} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={(event) => event.stopPropagation()} />
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-5 right-5 flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full px-3 py-1.5 transition"
      >
        <X size={14} /> Close
      </button>
      {actions && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
