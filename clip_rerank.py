"""Asset Library Phase 3 — CLIP visual re-ranking.

Given a query image (the decompose pipeline's cutout of one detected object)
and a list of candidate thumbnail URLs (from library_search's text ranking),
scores each candidate by CLIP cosine similarity to the query and prints a
JSON {id: similarity} map to stdout.

Invoked only after the caller (decompose.rs) has confirmed the CLIP
checkpoint is already cached locally — `local_files_only=True` below is a
second, hard guarantee that this script never triggers a network download of
model weights on its own. A thumbnail that fails to fetch, decode, or embed
is silently dropped from the result rather than failing the whole run.

Usage: python clip_rerank.py <request.json>
  request.json: {"cutout": "<local image path>",
                 "candidates": [{"id": "...", "thumb": "<url>"}, ...]}
Prints: {"<id>": <float similarity>, ...} for every candidate that succeeded.
"""
import json
import sys
import urllib.request

CLIP_MODEL = "openai/clip-vit-base-patch32"
THUMB_TIMEOUT = 8
MAX_CANDIDATES = 12
MAX_THUMB_BYTES = 25 * 1024 * 1024  # a thumbnail should be KBs; this is just a hard ceiling


def load_image(source):
    from PIL import Image
    import io

    if source.startswith("http://") or source.startswith("https://"):
        req = urllib.request.Request(source, headers={"User-Agent": "CozyverseStudio/0.1"})
        with urllib.request.urlopen(req, timeout=THUMB_TIMEOUT) as resp:
            data = resp.read(MAX_THUMB_BYTES + 1)
        if len(data) > MAX_THUMB_BYTES:
            raise ValueError(f"thumbnail exceeded {MAX_THUMB_BYTES} bytes")
        return Image.open(io.BytesIO(data)).convert("RGB")
    return Image.open(source).convert("RGB")


def main():
    if len(sys.argv) < 2:
        print("{}")
        return
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        request = json.load(f)

    cutout_path = request.get("cutout", "")
    candidates = request.get("candidates", [])[:MAX_CANDIDATES]
    if not cutout_path or not candidates:
        print("{}")
        return

    import torch
    from transformers import CLIPModel, CLIPProcessor

    model = CLIPModel.from_pretrained(CLIP_MODEL, local_files_only=True)
    processor = CLIPProcessor.from_pretrained(CLIP_MODEL, local_files_only=True)
    model.eval()

    def embed(img):
        # Goes through vision_model + visual_projection directly rather than
        # get_image_features(), whose return shape/type has proven unstable
        # across transformers versions (observed returning the raw encoder
        # output instead of the projected embedding on 5.x) — this is exactly
        # what that wrapper does internally, just without the ambiguity.
        with torch.no_grad():
            inputs = processor(images=img, return_tensors="pt")
            pooled = model.vision_model(pixel_values=inputs["pixel_values"]).pooler_output
            feat = model.visual_projection(pooled)
            return feat / feat.norm(p=2, dim=-1, keepdim=True)

    query_feat = embed(load_image(cutout_path))

    scores = {}
    for cand in candidates:
        cand_id = cand.get("id")
        thumb = cand.get("thumb")
        if not cand_id or not thumb:
            continue
        try:
            feat = embed(load_image(thumb))
            scores[cand_id] = (query_feat @ feat.T).item()
        except Exception:
            continue  # one bad thumbnail shouldn't sink the whole re-rank

    print(json.dumps(scores))


if __name__ == "__main__":
    main()
