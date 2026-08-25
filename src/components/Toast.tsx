import { useEffect } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export function Toast() {
  const error = useAppStore((state) => state.error);
  const notice = useAppStore((state) => state.notice);
  const clearError = useAppStore((state) => state.clearError);
  const clearNotice = useAppStore((state) => state.clearNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 5000);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  if (!error && !notice) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-800 bg-red-950/90 backdrop-blur-sm text-red-200 text-sm px-4 py-3 shadow-lg">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p className="flex-1">{error}</p>
          <button onClick={clearError} className="text-red-400 hover:text-red-200 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2.5 rounded-lg border border-green-800 bg-green-950/90 backdrop-blur-sm text-green-200 text-sm px-4 py-3 shadow-lg">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <p className="flex-1 break-words">{notice}</p>
          <button onClick={clearNotice} className="text-green-400 hover:text-green-200 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
