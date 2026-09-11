import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import * as api from "../lib/api";
import { blobToDataUrl } from "../lib/postcard";
import { renderDesignSheet } from "../lib/designSheet";

/** One-click export of a Cast & Props entity as a "Design Sheet" — name, kind, style sheet, and its
 * reference images laid out like a real production character/prop bible page. Mirrors
 * PostcardExport's save flow exactly (client-side canvas render → Save-As dialog); never writes
 * into the project itself. */
export function DesignSheetExport({ name, kindLabel, styleSheet, imageUrls }: { name: string; kindLabel: string; styleSheet: string; imageUrls: string[] }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await renderDesignSheet(imageUrls, name, kindLabel, styleSheet);
      const dataUrl = await blobToDataUrl(blob);
      await api.saveGeneratedBytes(dataUrl, `${name || "cozyverse"}-design-sheet.png`, "png");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={saving || imageUrls.length === 0}
        title={imageUrls.length === 0 ? "Add at least one reference image first" : "Export a design sheet with the style sheet and reference images"}
        className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 disabled:opacity-40 transition"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />} Design Sheet
      </button>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
