# Cozyverse → Blender bridge

`cozyverse_bridge.py` is a small Blender add-on that imports a **decomposed
Cozyverse scene** — the per-object GLBs produced by *Decompose & Send to 3D*,
laid out on a ground plane from each object's 2D bbox.

## Install (once)

1. Blender → **Edit ▸ Preferences ▸ Add-ons ▸ Install…**
2. Pick `cozyverse_bridge.py`, then tick **Cozyverse Bridge** to enable it.

## Use

1. In Cozyverse, run *Decompose & Send to 3D* and let a job finish. It writes
   `scene.json` next to the models, at:
   `Documents/Cozyverses/<project>/assets/decompose/<jobId>/scene.json`
   (the panel's **Blender scene file** button reveals it).
2. In Blender: **Sidebar (press N) ▸ Cozyverse** tab → set the **scene.json**
   path → **Import Decomposed Scene**.

Every object is imported (its preferred = Fast-path GLB), scaled to roughly
track its footprint in the source frame, and dropped on the floor under a
`Cozyverse <job>` empty. Adjust **Room size** to spread things out, then nudge
by hand — the placement is a starting point, not a solve.

## scene.json

```jsonc
{
  "version": 1,
  "job": "<id>",
  "sourceImage": "<abs path to the original image>",
  "objects": [
    {
      "id": "asset_0",
      "class": "sofa",
      "bbox": [x0, y0, x1, y1],        // pixels in the source image
      "models": {                       // provider_path -> abs .glb
        "tripo_fast": "…/models/…​.glb",
        "meshy_fast": "…/models/…​.glb"
      },
      "preferred": "tripo_fast"
    }
  ]
}
```

Same manifest is intended to drive Unreal (Editor Python) and Unity (Editor
package) importers — not built yet.
