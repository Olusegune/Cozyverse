import { useState } from "react";
import { Image, Loader2 } from "lucide-react";
import * as api from "../lib/api";
import { blobToDataUrl, renderPostcard } from "../lib/postcard";

/** One-click shareable export — composites the given image into a branded "Cozyverse Postcard" PNG
 * (see lib/postcard.ts) and hands it to a native Save-As dialog. Never writes into the project
 * itself; purely a share/export action. */
export function PostcardExport({ imageUrl, title, subtitle }: { imageUrl: string; title: string; subtitle?: string }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await renderPostcard(imageUrl, title, subtitle);
      const dataUrl = await blobToDataUrl(blob);
      await api.saveGeneratedBytes(dataUrl, `${title || "cozyverse"}-postcard.png`, "png");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => void run()}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs text-white/90 hover:text-white bg-black/50 hover:bg-black/70 disabled:opacity-50 rounded-full px-3 py-1.5 transition"
        title="Export a shareable branded postcard image"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Image size={13} />} Postcard
      </button>
      {error && <p className="text-[11px] text-yellow-500 mt-1">{error}</p>}
    </div>
  );
}
