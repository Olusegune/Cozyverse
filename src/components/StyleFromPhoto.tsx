import { useRef, useState } from "react";
import { ImageUp, Loader2 } from "lucide-react";
import * as api from "../lib/api";

/** "Make my world look like THIS" — lets the user drop in any reference photo and reverse-engineers
 * it into a style-description prompt fragment via Gemini vision, instead of hand-picking descriptive
 * words. Never generates or edits anything itself — only ever hands the extracted text to the
 * caller, same non-destructive philosophy as Prompt Assist and Continuity Check. Requires a
 * connected Gemini key (the only vision-capable provider this app talks to); silently disabled with
 * a hint otherwise rather than a hard error, since this is an optional enhancement. */
export function StyleFromPhoto({ onExtracted }: { onExtracted: (styleDescription: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      const [, mime, base64] = dataUrl.match(/^data:(.+?);base64,(.*)$/) || [];
      if (!mime || !base64) throw new Error("Could not read this file as an image.");
      const description = await api.geminiDescribeImageStyle(mime, base64);
      onExtracted(description);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 transition disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ImageUp size={12} />} {busy ? "Analyzing style…" : "Extract Style from Photo…"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />
      {error && <p className="text-[11px] text-yellow-500 mt-1.5">{error.includes("No gemini API key") ? "Add a Gemini API key in Settings to use this." : error}</p>}
    </div>
  );
}
