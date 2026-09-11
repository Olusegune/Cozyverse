// Merge every object in a finished Decompose job into ONE positioned .glb —
// the roadmap #3 remainder ("combined/laid-out GLB"). Placement math mirrors
// integrations/blender/cozyverse_bridge.py exactly (same ROOM_SIZE, same
// bbox -> position/scale formula, translated from Blender's Z-up to glTF's
// Y-up) so an in-app export and a Blender import lay objects out identically.
//
// Dynamically imported — three.js + GLTFExporter only load when used.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/** Diorama width/depth in glTF units — matches cozyverse_bridge.py's DEFAULT_ROOM. */
const ROOM_SIZE = 4;

export type MergeObject = {
  id: string;
  class: string;
  /** [x0, y0, x1, y1] in source-image pixels. */
  bbox: [number, number, number, number];
  /** Loadable URL (asset protocol) for the object's preferred model. */
  glbUrl: string;
};

function fixGltfResourcePath(loader: GLTFLoader, url: string) {
  // A .gltf pulls its .bin/textures by relative path; Tauri's asset protocol
  // encodes the whole path into one URL segment, so point the resource base at
  // the real folder (same fix as ModelViewer.tsx / turnaround.ts). A .glb is
  // self-contained and doesn't need this.
  if (!/\.gltf(\?|#|$)/i.test(url)) return;
  const enc = url.lastIndexOf("%2F");
  const raw = url.lastIndexOf("/");
  const cut = Math.max(enc, raw);
  if (cut > 0) loader.setResourcePath(url.slice(0, cut + (cut === enc ? 3 : 1)));
}

/** Natural pixel size of an image at `url` — used to normalise bbox coordinates. */
export function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 });
    img.onerror = () => reject(new Error("Could not read the source image size"));
    img.src = url;
  });
}

/**
 * Loads every object's GLB, places it on a virtual floor from its 2D bbox
 * (ground-plane position from the bbox centre, scale from its footprint
 * height, dropped so its base sits at y=0), and exports the combined scene as
 * one binary glTF (.glb) ArrayBuffer.
 */
export async function mergeSceneToGlb(
  objects: MergeObject[],
  imageSize: { width: number; height: number },
): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  const loader = new GLTFLoader();
  const imgW = Math.max(imageSize.width, 1);
  const imgH = Math.max(imageSize.height, 1);
  let placed = 0;

  for (const obj of objects) {
    try {
      fixGltfResourcePath(loader, obj.glbUrl);
      const gltf = await loader.loadAsync(obj.glbUrl);
      const model = gltf.scene;
      model.name = `${obj.id}_${obj.class}`.replace(/[^\w-]+/g, "_").slice(0, 60);

      const [x0, y0, x1, y1] = obj.bbox;
      const cx = (x0 + x1) / 2 / imgW;
      const cy = (y0 + y1) / 2 / imgH;
      const bboxHeightFrac = (y1 - y0) / imgH;

      // Natural (pre-scale, pre-placement) size and centroid.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const curHeight = Math.max(size.y, 1e-4);
      const targetHeight = Math.max(bboxHeightFrac * ROOM_SIZE * 0.9, ROOM_SIZE * 0.05);
      // A near-zero-volume mesh (bad export, degenerate geometry) would
      // otherwise divide down to a tiny curHeight and blow scale up to
      // thousands-of-x — clamp so one bad model can't wreck the whole
      // merged scene's proportions.
      const scale = Math.min(targetHeight / curHeight, 1000);
      model.scale.setScalar(scale);

      // Ground-plane position: image X -> world X, image Y (down) -> world -Z
      // (glTF's Y is up, so Blender's horizontal "Y" becomes glTF's "Z").
      // Offset by the scaled centroid so the object's own bounding-box centre
      // lands on the target point, not its local origin.
      model.position.x = (cx - 0.5) * ROOM_SIZE - centre.x * scale;
      model.position.z = -(cy - 0.5) * ROOM_SIZE - centre.z * scale;

      scene.add(model);
      scene.updateMatrixWorld(true);
      const placedBox = new THREE.Box3().setFromObject(model);
      model.position.y -= placedBox.min.y; // sit on the floor
      placed++;
    } catch (err) {
      console.error(`scene merge: skipped ${obj.class}`, err);
    }
  }

  if (placed === 0) {
    throw new Error("No objects could be loaded — nothing to merge.");
  }

  const exporter = new GLTFExporter();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error("Exporter did not return binary glTF"));
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true },
    );
  });
}

/** Chunked base64 encode — avoids a call-stack blowup from spreading a large
 * Uint8Array into String.fromCharCode at once (combined scenes can be 10s of MB). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
