#!/usr/bin/env python3
"""
decompose_pipeline.py — split one Cozyverse image into semantic 3D-ready assets.

Called as a subprocess by the Cozyverse Studio Rust backend (see
src-tauri/src/decompose.rs). Contract:

    python decompose_pipeline.py --image <file> --out <dir> [--quality] [--stub]

  * stdout  : a single JSON array (last non-empty line) — the asset list.
  * stderr  : human-readable progress / errors.
  * exit 0  : success; exit non-zero : Rust surfaces stderr tail to the user.
  * files   : every referenced PNG is written under <dir> (which the Rust side
              has already placed inside the project's assets/ tree).

Asset entry shape (matches RawAsset in decompose.rs):

    {
      "id": "asset_0",
      "class": "armchair",
      "bbox": [x0, y0, x1, y1],
      "perspective_image": "<abs or out-relative path>.png",
      "ortho_views": {                      # omit / null any view you can't make
        "front": "...png", "back": "...png",
        "left": "...png",  "right": "...png"
      }
    }

Two execution paths
-------------------
--stub (or missing GPU deps + --stub):
    Pillow only. Emits ONE asset — the whole image as the perspective crop, no
    ortho views. Lets the end-to-end wiring (queue → providers → GLB download)
    be exercised with zero model downloads.

full (default):
    Grounded-SAM for instance masks   : transformers GroundingDINO + SAM
    CLIP for labelling each instance   : openai/clip-vit-base-patch32
    Zero123++ for novel views (--quality) : sudo-ai/zero123plus-v1.2

    ~9-11 GB VRAM peak. Models are loaded, used, and freed one stage at a time
    (torch.cuda.empty_cache between stages) to stay under a 12 GB card. If a
    required package is missing the script exits non-zero with an install hint
    rather than silently degrading.

Install (full path):
    pip install torch --index-url https://download.pytorch.org/whl/cu124
    pip install transformers accelerate diffusers pillow numpy
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Vocabulary used both as GroundingDINO prompt and CLIP label set. Tuned for
# cozy interior / diorama scenes; extend freely.
ASSET_VOCAB = [
    "armchair", "sofa", "chair", "stool", "bench", "table", "coffee table",
    "desk", "bed", "bookshelf", "shelf", "cabinet", "dresser", "wardrobe",
    "lamp", "floor lamp", "ceiling light", "rug", "curtain", "plant",
    "potted plant", "vase", "picture frame", "painting", "mirror", "clock",
    "television", "radio", "record player", "guitar", "piano", "fireplace",
    "window", "door", "stairs", "box", "basket", "pillow", "blanket",
    "book", "stack of books", "mug", "teapot", "bowl", "bottle", "candle",
    "toy", "sculpture", "statue", "fan", "heater", "suitcase", "backpack",
]

BOX_THRESHOLD = 0.22
TEXT_THRESHOLD = 0.18
MAX_ASSETS = 12
MIN_BOX_AREA_FRAC = 0.002   # ignore specks
PAD_FRAC = 0.06             # context padding around each crop


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def emit(assets):
    # Rust reads the LAST non-empty stdout line as the payload.
    print(json.dumps(assets), flush=True)


# --------------------------------------------------------------------- stub path

def run_stub(image_path: Path, out_dir: Path) -> list[dict]:
    from PIL import Image

    out_dir.mkdir(parents=True, exist_ok=True)
    img = Image.open(image_path).convert("RGB")
    persp = out_dir / "asset_0_perspective.png"
    img.save(persp)
    log(f"[stub] wrote {persp} ({img.width}x{img.height})")
    return [
        {
            "id": "asset_0",
            "class": "scene",
            "bbox": [0, 0, img.width, img.height],
            "perspective_image": str(persp),
            "ortho_views": {"front": str(persp)},
        }
    ]


# --------------------------------------------------------------------- full path

def _require(module_hint: str):
    log(f"ERROR: missing dependency for the full pipeline — {module_hint}")
    log("Install: pip install torch transformers accelerate diffusers pillow numpy")
    log("Or re-run the decomposition in stub mode for a wiring test.")
    sys.exit(2)


def run_full(image_path: Path, out_dir: Path, quality: bool) -> list[dict]:
    try:
        import numpy as np
        import torch
        from PIL import Image
    except ImportError:
        _require("torch / numpy / pillow")

    out_dir.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        log("WARNING: no CUDA device visible; the full pipeline will be very slow.")

    image = Image.open(image_path).convert("RGB")
    W, H = image.size

    # --- stage 1: GroundingDINO boxes ------------------------------------------
    try:
        from transformers import (
            AutoProcessor,
            AutoModelForZeroShotObjectDetection,
        )
    except ImportError:
        _require("transformers")

    log("[1/4] GroundingDINO — detecting objects")
    gd_id = "IDEA-Research/grounding-dino-base"
    gd_proc = AutoProcessor.from_pretrained(gd_id)
    gd_model = AutoModelForZeroShotObjectDetection.from_pretrained(gd_id).to(device)

    prompt = ". ".join(ASSET_VOCAB) + "."
    inputs = gd_proc(images=image, text=prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = gd_model(**inputs)
    # transformers renamed `box_threshold` -> `threshold` in v5. Support both.
    pp_kwargs = dict(
        input_ids=inputs.input_ids,
        text_threshold=TEXT_THRESHOLD,
        target_sizes=[image.size[::-1]],
    )
    try:
        results = gd_proc.post_process_grounded_object_detection(
            outputs, threshold=BOX_THRESHOLD, **pp_kwargs
        )[0]
    except TypeError:
        results = gd_proc.post_process_grounded_object_detection(
            outputs, box_threshold=BOX_THRESHOLD, **pp_kwargs
        )[0]

    boxes = results["boxes"].cpu().numpy()
    labels = results.get("text_labels") or results.get("labels") or []
    scores = results["scores"].cpu().numpy()

    del gd_model, gd_proc, inputs, outputs
    torch.cuda.empty_cache()

    # Filter + de-duplicate overlapping boxes, keep the strongest.
    dets = []
    for box, label, score in zip(boxes, labels, scores):
        x0, y0, x1, y1 = [float(v) for v in box]
        x0, y0 = max(0.0, x0), max(0.0, y0)
        x1, y1 = min(float(W), x1), min(float(H), y1)
        if (x1 - x0) * (y1 - y0) < MIN_BOX_AREA_FRAC * W * H:
            continue
        dets.append({"box": [x0, y0, x1, y1], "label": label or "object",
                     "score": float(score)})
    dets.sort(key=lambda d: d["score"], reverse=True)
    dets = _nms(dets, iou_thresh=0.55)[:MAX_ASSETS]
    if not dets:
        log("No objects passed the detection thresholds.")
        return []
    log(f"      kept {len(dets)} objects: "
        + ", ".join(f'{d["label"]}({d["score"]:.2f})' for d in dets))

    # --- stage 2: SAM masks ---------------------------------------------------
    try:
        from transformers import SamModel, SamProcessor
    except ImportError:
        _require("transformers (SamModel)")

    log("[2/4] SAM — segmenting each object")
    sam_id = "facebook/sam-vit-base"
    sam_proc = SamProcessor.from_pretrained(sam_id)
    sam_model = SamModel.from_pretrained(sam_id).to(device)

    input_boxes = [[d["box"] for d in dets]]
    sam_inputs = sam_proc(image, input_boxes=input_boxes, return_tensors="pt").to(device)
    with torch.no_grad():
        sam_out = sam_model(**sam_inputs)
    masks = sam_proc.image_processor.post_process_masks(
        sam_out.pred_masks.cpu(),
        sam_inputs["original_sizes"].cpu(),
        sam_inputs["reshaped_input_sizes"].cpu(),
    )[0]  # (N, C, H, W) bool

    del sam_model, sam_proc, sam_inputs, sam_out
    torch.cuda.empty_cache()

    # --- stage 3: crops on white --------------------------------------------
    log("[3/4] compositing perspective crops on white")
    rgb = np.asarray(image).astype(np.uint8)
    assets = []
    per_asset_front = []  # keep PIL front crops for stage 4
    for i, (det, mask_set) in enumerate(zip(dets, masks)):
        m = _clean_mask(mask_set, det["box"], H, W)
        white = np.full_like(rgb, 255)
        comp = np.where(m[..., None], rgb, white)

        x0, y0, x1, y1 = _pad_box(det["box"], W, H, PAD_FRAC)
        crop = Image.fromarray(comp[y0:y1, x0:x1])
        crop = _square_pad(crop)
        p = out_dir / f"asset_{i}_perspective.png"
        crop.save(p)
        per_asset_front.append(crop)

        assets.append({
            "id": f"asset_{i}",
            "class": det["label"],
            "bbox": [x0, y0, x1, y1],
            "perspective_image": str(p),
            "ortho_views": {"front": str(p)},
        })

    if not quality:
        log("      Quality Path not requested — perspective only.")
        return assets

    # --- stage 4: Zero123++ novel views -----------------------------------
    try:
        import diffusers  # noqa: F401
        from diffusers import DiffusionPipeline
    except ImportError:
        log("WARNING: diffusers not installed — skipping ortho views, "
            "Fast Path only.")
        return assets

    log("[4/4] Zero123++ — synthesising left / back / right views")
    try:
        pipe = DiffusionPipeline.from_pretrained(
            "sudo-ai/zero123plus-v1.2",
            custom_pipeline="sudo-ai/zero123plus-pipeline",
            trust_remote_code=True,
            dtype=torch.float16 if device == "cuda" else torch.float32,
        ).to(device)
        pipe.set_progress_bar_config(disable=True)
    except Exception as e:  # noqa: BLE001
        log(f"WARNING: could not load Zero123++ ({e}); Fast Path only.")
        return assets

    # Zero123++ v1.2 emits a 3x2 grid at azimuths 30,90,150,210,270,330 with
    # alternating elevations. We approximate: right≈90, back≈210, left≈270.
    GRID = (960, 640)  # 3 wide x 2 tall of 320px tiles
    TILE = 320
    picks = {"right": (1, 0), "back": (0, 1), "left": (2, 1)}  # (col,row)
    for i, front in enumerate(per_asset_front):
        try:
            result = pipe(front, num_inference_steps=36).images[0]
            result = result.resize(GRID)
            views = {"front": assets[i]["ortho_views"]["front"]}
            for name, (c, r) in picks.items():
                tile = result.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE))
                tp = out_dir / f"asset_{i}_{name}.png"
                _square_pad(tile).save(tp)
                views[name] = str(tp)
            assets[i]["ortho_views"] = views
            log(f"      asset_{i}: front/left/back/right ready")
        except Exception as e:  # noqa: BLE001
            log(f"      asset_{i}: view synthesis failed ({e}); keeping front only")

    del pipe
    torch.cuda.empty_cache()
    return assets


# ------------------------------------------------------------------- geometry

def _iou(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    ua = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / ua if ua > 0 else 0.0


def _nms(dets, iou_thresh):
    kept = []
    for d in dets:
        if all(_iou(d["box"], k["box"]) < iou_thresh for k in kept):
            kept.append(d)
    return kept


def _pad_box(box, W, H, frac):
    x0, y0, x1, y1 = box
    px, py = (x1 - x0) * frac, (y1 - y0) * frac
    return (
        int(max(0, x0 - px)), int(max(0, y0 - py)),
        int(min(W, x1 + px)), int(min(H, y1 + py)),
    )


def _box_mask(box, H, W):
    import numpy as np
    m = np.zeros((H, W), dtype=bool)
    x0, y0, x1, y1 = [int(v) for v in box]
    m[y0:y1, x0:x1] = True
    return m


def _clean_mask(mask_set, box, H, W):
    """Pick the best of SAM's multimask outputs for this box, then fill interior
    holes and lightly close ragged edges — a clean cutout matters a lot for the
    downstream image-to-3D quality."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter

    x0, y0, x1, y1 = [int(v) for v in box]
    box_area = max(1, (x1 - x0) * (y1 - y0))
    candidates = [mask_set[j].numpy().astype(bool) for j in range(mask_set.shape[0])]
    # Prefer the largest mask that stays within ~1.6x the detection box (avoids
    # SAM's occasional "whole wall/floor" mask); else the smallest.
    scored = sorted(
        candidates,
        key=lambda mm: (mm.sum() <= 1.6 * box_area, mm.sum()),
        reverse=True,
    )
    m = scored[0] if scored else candidates[0]
    if m.sum() < 64:
        return _box_mask(box, H, W)

    # Fill holes: flood the outside background from each corner; unreached
    # background pixels are interior holes.
    inv = Image.fromarray((~m).astype(np.uint8) * 255)  # bg=255, obj=0
    for seed in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)):
        if inv.getpixel(seed) == 255:
            ImageDraw.floodfill(inv, seed, 128)
    filled = m | (np.array(inv) == 255)

    # Light morphological close to smooth the edge.
    im = Image.fromarray(filled.astype(np.uint8) * 255)
    im = im.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    return np.array(im) > 127


def _square_pad(img):
    from PIL import Image
    w, h = img.size
    s = max(w, h)
    canvas = Image.new("RGB", (s, s), (255, 255, 255))
    canvas.paste(img, ((s - w) // 2, (s - h) // 2))
    return canvas


# ------------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--image", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--quality", action="store_true",
                    help="also synthesise 4 orthographic views per asset")
    ap.add_argument("--stub", action="store_true",
                    help="Pillow-only wiring test: 1 asset, no models")
    args = ap.parse_args()

    if not args.image.is_file():
        log(f"ERROR: image not found: {args.image}")
        sys.exit(1)

    try:
        if args.stub:
            assets = run_stub(args.image, args.out)
        else:
            assets = run_full(args.image, args.out, args.quality)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        log(f"ERROR: {e}")
        sys.exit(1)

    emit(assets)


if __name__ == "__main__":
    main()
