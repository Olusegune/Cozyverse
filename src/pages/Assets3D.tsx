import { Boxes } from "lucide-react";
import { DecomposePanel } from "../components/DecomposePanel";

/** A dedicated home for Decompose — previously only reachable as two small
 * buttons at the bottom of each Image Studio card, so most people never
 * discovered 3D generation existed at all. This renders the exact same live
 * panel (same job store) so starting a decompose from an Image Studio card and
 * checking on it here always agree. */
export function Assets3DPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-500/15 border border-accent-500/30">
          <Boxes size={16} className="text-accent-400" />
        </span>
        <h1 className="text-2xl font-semibold text-white">3D &amp; Assets</h1>
      </div>
      <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
      <p className="text-sm text-slate-400 mt-1 mb-6 max-w-2xl">
        Turn any generated image into per-object 3D models, image reference sheets, or free CC0
        assets. Start a decompose from a card in <b className="text-slate-300">Image Studio</b> — every
        job you've started, running or finished, lives here.
      </p>
      <DecomposePanel />
    </div>
  );
}
