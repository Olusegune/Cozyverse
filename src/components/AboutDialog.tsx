import { X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    void invoke<string>("app_version").then(setVersion).catch(() => setVersion(""));
  }, []);

  return (
    <div className="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-8" onClick={onClose}>
      <div className="relative bg-base-900 border border-base-700 w-full max-w-sm p-6 text-center" onClick={(event) => event.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white">
          <X size={16} />
        </button>
        <div className="w-12 h-12 mx-auto flex items-center justify-center bg-accent-500/15 border border-accent-500/30 mb-4">
          <span className="font-display font-bold text-accent-400 text-lg">C</span>
        </div>
        <h2 className="font-display font-semibold text-white text-lg">Cozyverse Studio</h2>
        {version && <p className="text-xs text-slate-500 mt-1">Version {version}</p>}
        <p className="text-sm text-slate-400 mt-4">
          A local-first tool for building small immersive Cozyverse digital art worlds — image, motion, audio, and interactive scenes, all kept on your own disk.
        </p>
        <p className="text-xs text-slate-600 mt-4">Wheelbarrow Studios</p>
      </div>
    </div>
  );
}
