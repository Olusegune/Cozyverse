import { useState } from "react";
import { Plus, Trash2, User, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { projectCharacters } from "../types";

/** Named, reusable characters — a style sheet (appearance, wardrobe, personality, anything that
 * needs to stay consistent) plus reference images that ARE this character. Picking a character into
 * a shot in Image/Motion Studio auto-attaches its reference image on models that support one, and
 * folds the style sheet text into the prompt either way — see the "Characters in this Shot" picker
 * in both Studios' Shot Mode. */
export function CharactersPage() {
  const project = useAppStore((state) => state.project);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const addCharacter = useAppStore((state) => state.addCharacter);
  const removeCharacter = useAppStore((state) => state.removeCharacter);
  const updateCharacter = useAppStore((state) => state.updateCharacter);
  const toggleCharacterReference = useAppStore((state) => state.toggleCharacterReference);

  const [newName, setNewName] = useState("");
  const [pickingRefsFor, setPickingRefsFor] = useState<string | null>(null);

  if (!project) return null;
  const characters = projectCharacters(project);
  const imageAssets = project.assets.filter((asset) => asset.type === "image");

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addCharacter(newName.trim());
    setNewName("");
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Characters</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">
          Define recurring characters once — appearance, wardrobe, personality — then pick them into any shot in Image or Motion Studio. Their reference
          image attaches automatically on models that support one, and their style sheet folds into the prompt either way.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void handleAdd()}
          placeholder="New character name — e.g. Maya, the lighthouse keeper"
          className="flex-1 max-w-sm bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
        />
        <button
          onClick={() => void handleAdd()}
          disabled={!newName.trim()}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-accentText font-medium transition"
        >
          <Plus size={13} /> Add Character
        </button>
      </div>

      {characters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <User className="mx-auto text-slate-600 mb-3" size={28} />
          <p className="text-slate-400">No characters yet — add one above, then pick it into a shot in Image or Motion Studio.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {characters.map((character) => {
            const references = imageAssets.filter((asset) => character.referenceAssetIds.includes(asset.id));
            return (
              <div key={character.id} className="rounded-xl border border-base-700 bg-base-900 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    value={character.name}
                    onChange={(event) => void updateCharacter(character.id, { name: event.target.value })}
                    className="flex-1 bg-transparent text-sm font-medium text-white outline-none border-b border-transparent focus:border-accent-500 py-0.5"
                  />
                  <button onClick={() => void removeCharacter(character.id)} className="text-slate-500 hover:text-red-400 shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">Style Sheet</label>
                  <textarea
                    rows={4}
                    value={character.styleSheet}
                    onChange={(event) => void updateCharacter(character.id, { styleSheet: event.target.value })}
                    placeholder="e.g. mid-20s woman, short curly red hair, always wears a paint-stained denim jacket, warm and a little sarcastic"
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-xs text-white outline-none focus:border-accent-500 resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Reference Images</label>
                    <button onClick={() => setPickingRefsFor(pickingRefsFor === character.id ? null : character.id)} className="text-[11px] text-accent-400 hover:text-accent-300">
                      {pickingRefsFor === character.id ? "Done" : "Pick from Image Studio…"}
                    </button>
                  </div>
                  {references.length === 0 && pickingRefsFor !== character.id ? (
                    <p className="text-[11px] text-slate-500">No reference image yet — pick one so shots can attach it automatically.</p>
                  ) : (
                    <div className="grid grid-cols-5 gap-1.5">
                      {references.map((asset) => (
                        <div key={asset.id} className="relative aspect-square rounded-md overflow-hidden border border-accent-500/50">
                          <img src={assetUrl(asset)} alt="" className="w-full h-full object-cover" />
                          {pickingRefsFor === character.id && (
                            <button
                              onClick={() => void toggleCharacterReference(character.id, asset.id)}
                              className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 transition"
                            >
                              <X size={14} className="text-white" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {pickingRefsFor === character.id && (
                    <div className="mt-2 grid grid-cols-5 gap-1.5 max-h-40 overflow-y-auto rounded-md border border-base-700 p-1.5">
                      {imageAssets.length === 0 && <p className="text-[11px] text-slate-500 col-span-5">No images yet — generate one in Image Studio first.</p>}
                      {imageAssets
                        .filter((asset) => !character.referenceAssetIds.includes(asset.id))
                        .map((asset) => (
                          <button
                            key={asset.id}
                            title={asset.name}
                            onClick={() => void toggleCharacterReference(character.id, asset.id)}
                            className="aspect-square rounded-md overflow-hidden border-2 border-base-700 hover:border-accent-500 transition"
                          >
                            <img src={assetUrl(asset)} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
