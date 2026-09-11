import { useState } from "react";
import { Expand, Plus, Star, Trash2, User, Package, Car, Layers, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { EntityReferenceGenerator } from "../components/EntityReferenceGenerator";
import { DesignSheetExport } from "../components/DesignSheetExport";
import { Lightbox } from "../components/Lightbox";
import { ENTITY_KIND_LABELS, entityKind, projectCharacters, type Asset, type EntityKind } from "../types";

const KIND_ICON: Record<EntityKind, typeof User> = { character: User, prop: Package, vehicle: Car, set: Layers };
const KIND_ORDER: EntityKind[] = ["character", "prop", "vehicle", "set"];

/** Named, reusable entities — characters, props, vehicles, and sets are all the same underlying
 * shape (a style sheet plus reference images), just labeled by `kind`. Picking one into a shot in
 * Image/Motion Studio auto-attaches its reference image on models that support one, and folds the
 * style sheet text into the prompt either way — see the picker in both Studios' Shot Mode. */
export function CharactersPage() {
  const project = useAppStore((state) => state.project);
  const assetUrl = useAppStore((state) => state.assetUrl);
  const addCharacter = useAppStore((state) => state.addCharacter);
  const removeCharacter = useAppStore((state) => state.removeCharacter);
  const updateCharacter = useAppStore((state) => state.updateCharacter);
  const toggleCharacterReference = useAppStore((state) => state.toggleCharacterReference);

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<EntityKind>("character");
  const [pickingRefsFor, setPickingRefsFor] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<Asset | null>(null);

  if (!project) return null;
  const entities = projectCharacters(project);
  const imageAssets = project.assets.filter((asset) => asset.type === "image");

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addCharacter(newName.trim(), newKind);
    setNewName("");
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Cast &amp; Props</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">
          Define recurring characters, props, vehicles, and sets once — appearance, materials, anything that needs to stay consistent — then pick them into
          any shot in Image or Motion Studio. Their reference image attaches automatically on models that support one, and their style sheet folds into the
          prompt either way.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="flex rounded-md border border-base-600 overflow-hidden shrink-0">
          {KIND_ORDER.map((kind) => {
            const Icon = KIND_ICON[kind];
            return (
              <button
                key={kind}
                onClick={() => setNewKind(kind)}
                title={ENTITY_KIND_LABELS[kind]}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs transition ${
                  newKind === kind ? "bg-accent-500 text-accentText" : "text-slate-400 hover:text-white"
                }`}
              >
                <Icon size={13} /> {ENTITY_KIND_LABELS[kind]}
              </button>
            );
          })}
        </div>
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void handleAdd()}
          placeholder={
            newKind === "character"
              ? "New character name — e.g. Maya, the lighthouse keeper"
              : newKind === "prop"
                ? "New prop name — e.g. Maya's brass telescope"
                : newKind === "vehicle"
                  ? "New vehicle name — e.g. the rusted red delivery van"
                  : "New set name — e.g. the lighthouse keeper's study"
          }
          className="flex-1 max-w-sm bg-base-800 border border-base-600 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
        />
        <button
          onClick={() => void handleAdd()}
          disabled={!newName.trim()}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-accentText font-medium transition"
        >
          <Plus size={13} /> Add {ENTITY_KIND_LABELS[newKind]}
        </button>
      </div>

      {entities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-600 p-16 text-center">
          <User className="mx-auto text-slate-600 mb-3" size={28} />
          <p className="text-slate-400">Nothing here yet — add a character, prop, vehicle, or set above, then pick it into a shot in Image or Motion Studio.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {KIND_ORDER.filter((kind) => entities.some((entity) => entityKind(entity) === kind)).map((kind) => {
            const Icon = KIND_ICON[kind];
            const group = entities.filter((entity) => entityKind(entity) === kind);
            return (
              <div key={kind}>
                <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">
                  <Icon size={13} /> {ENTITY_KIND_LABELS[kind]}s
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {group.map((entity) => {
                    // Ordered by entity.referenceAssetIds, NOT by imageAssets' own order — the
                    // first entry here is what the rest of the app already treats as "primary"
                    // (Style Stack inheritance, @mention token lookup, Shot Mode auto-attach all
                    // read referenceAssetIds[0]) — the grid needs to actually show that same order,
                    // not whatever order the assets happen to sit in project-wide.
                    const references = entity.referenceAssetIds
                      .map((id) => imageAssets.find((asset) => asset.id === id))
                      .filter((asset): asset is (typeof imageAssets)[number] => Boolean(asset));
                    const makePrimary = (assetId: string) =>
                      void updateCharacter(entity.id, { referenceAssetIds: [assetId, ...entity.referenceAssetIds.filter((id) => id !== assetId)] });
                    return (
                      <div key={entity.id} className="rounded-xl border border-base-700 bg-base-900 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            value={entity.name}
                            onChange={(event) => void updateCharacter(entity.id, { name: event.target.value })}
                            className="flex-1 bg-transparent text-sm font-medium text-white outline-none border-b border-transparent focus:border-accent-500 py-0.5"
                          />
                          <button onClick={() => void removeCharacter(entity.id)} className="text-slate-500 hover:text-red-400 shrink-0">
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">Style Sheet</label>
                          <textarea
                            rows={4}
                            value={entity.styleSheet}
                            onChange={(event) => void updateCharacter(entity.id, { styleSheet: event.target.value })}
                            placeholder={
                              kind === "character"
                                ? "e.g. mid-20s woman, short curly red hair, always wears a paint-stained denim jacket, warm and a little sarcastic"
                                : kind === "prop"
                                  ? "e.g. tarnished brass telescope on a tripod, engraved star chart along the barrel, always slightly askew"
                                  : kind === "vehicle"
                                    ? "e.g. rusted red 1970s delivery van, dented left fender, faded hand-painted logo on the side"
                                    : "e.g. cramped study lined with charts, a single oil lamp, salt-worn wood floor, one tall window facing the sea"
                            }
                            className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-2 text-xs text-white outline-none focus:border-accent-500 resize-none"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Reference Images</label>
                            <button onClick={() => setPickingRefsFor(pickingRefsFor === entity.id ? null : entity.id)} className="text-[11px] text-accent-400 hover:text-accent-300">
                              {pickingRefsFor === entity.id ? "Done" : "Pick from Image Studio…"}
                            </button>
                          </div>
                          {references.length === 0 && pickingRefsFor !== entity.id ? (
                            <p className="text-[11px] text-slate-500">No reference image yet — pick one so shots can attach it automatically.</p>
                          ) : (
                            <div className="grid grid-cols-5 gap-1.5">
                              {references.map((asset, index) => {
                                const isPrimary = index === 0;
                                return (
                                  <div
                                    key={asset.id}
                                    className={`group relative aspect-square rounded-md overflow-hidden border ${isPrimary ? "border-accent-500" : "border-accent-500/50"}`}
                                  >
                                    <button type="button" onClick={() => setLightboxAsset(asset)} className="block w-full h-full">
                                      <img src={assetUrl(asset)} alt="" className="w-full h-full object-cover" />
                                    </button>
                                    {isPrimary && (
                                      <span
                                        title="Primary reference — used automatically when a model only supports one, and for the Style Stack inheritance/@mention lookups"
                                        className="absolute top-1 left-1 flex items-center gap-0.5 bg-accent-500 text-accentText text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                                      >
                                        <Star size={9} fill="currentColor" /> Primary
                                      </span>
                                    )}
                                    {pickingRefsFor === entity.id ? (
                                      <button
                                        onClick={() => void toggleCharacterReference(entity.id, asset.id)}
                                        className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 transition"
                                        title="Remove this reference"
                                      >
                                        <X size={14} className="text-white" />
                                      </button>
                                    ) : (
                                      <div className="absolute bottom-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                        {!isPrimary && (
                                          <button
                                            onClick={() => makePrimary(asset.id)}
                                            className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white"
                                            title="Make this the primary reference"
                                          >
                                            <Star size={11} />
                                          </button>
                                        )}
                                        <button onClick={() => setLightboxAsset(asset)} className="p-1 rounded-md bg-black/60 hover:bg-black/80 text-white" title="View full size">
                                          <Expand size={11} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {pickingRefsFor === entity.id && (
                            <div className="mt-2 grid grid-cols-5 gap-1.5 max-h-40 overflow-y-auto rounded-md border border-base-700 p-1.5">
                              {imageAssets.length === 0 && <p className="text-[11px] text-slate-500 col-span-5">No images yet — generate one in Image Studio first.</p>}
                              {imageAssets
                                .filter((asset) => !entity.referenceAssetIds.includes(asset.id))
                                .map((asset) => (
                                  <button
                                    key={asset.id}
                                    title={asset.name}
                                    onClick={() => void toggleCharacterReference(entity.id, asset.id)}
                                    className="aspect-square rounded-md overflow-hidden border-2 border-base-700 hover:border-accent-500 transition"
                                  >
                                    <img src={assetUrl(asset)} alt="" className="w-full h-full object-cover" />
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>

                        <EntityReferenceGenerator
                          kind={kind}
                          styleSheet={entity.styleSheet}
                          onAdded={(assetId) => void toggleCharacterReference(entity.id, assetId)}
                        />

                        <DesignSheetExport
                          name={entity.name}
                          kindLabel={ENTITY_KIND_LABELS[kind]}
                          styleSheet={entity.styleSheet}
                          imageUrls={references.map((asset) => assetUrl(asset)).filter((url): url is string => Boolean(url))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lightboxAsset && (
        <Lightbox src={assetUrl(lightboxAsset) || ""} alt={lightboxAsset.name} onClose={() => setLightboxAsset(null)} />
      )}
    </div>
  );
}
