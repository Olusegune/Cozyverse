import { useState } from "react";

/** ffmpeg's own error output is real and useful for debugging, but multiple raw lines of it
 * dumped straight into the UI reads as "broken app," not "helpful error." Shows just the first
 * line by default — almost always the actual human-readable problem — with the rest tucked
 * behind "Show details" for when someone actually needs to paste it into a bug report. */
export function RenderErrorMessage({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = message.split("\n").filter(Boolean);
  const [firstLine, ...rest] = lines;

  return (
    <div className="mt-2">
      <p className="text-[11px] text-red-400">{firstLine}</p>
      {rest.length > 0 && (
        <>
          <button onClick={() => setExpanded((value) => !value)} className="text-[11px] text-slate-500 hover:text-white underline mt-1">
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && <pre className="text-[10px] text-red-400/80 whitespace-pre-wrap mt-1 bg-black/30 rounded-md p-2 max-h-40 overflow-auto">{rest.join("\n")}</pre>}
        </>
      )}
    </div>
  );
}
