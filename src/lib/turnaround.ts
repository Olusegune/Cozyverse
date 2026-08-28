// Render a decomposed object's generated GLB to a clean 5-view turnaround sheet,
// entirely client-side with three.js. Unlike the AI-turnaround pack, every angle
// is the *real* mesh — geometrically exact and perfectly consistent. Free.
//
// Dynamically imported so three.js only loads when the user actually exports.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const TURNAROUND_VIEWS = ["perspective", "front", "back", "left", "right"] as const;

// Camera direction per view (object centred at origin, then scaled by `dist`).
const POSES: Record<(typeof TURNAROUND_VIEWS)[number], [number, number, number]> = {
  perspective: [0.92, 0.55, 1.0],
  front: [0, 0.12, 1],
  back: [0, 0.12, -1],
  left: [-1, 0.12, 0],
  right: [1, 0.12, 0],
};

const FOV = 26; // long-ish lens → near-orthographic, matches the AI pack framing

/** A reusable offscreen renderer so a multi-object export doesn't spin up (and
 * leak) a WebGL context per object. Call render() per GLB, then dispose(). */
export function createTurnaroundRig(size = 1024) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // required for toDataURL
    alpha: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  renderer.setClearColor(0xffffff, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e8e8, 2.6));
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.7);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.3);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(0, 3, -5);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 5000);

  async function render(url: string): Promise<{ view: string; dataUri: string }[]> {
    const loader = new GLTFLoader();
    // A .gltf pulls siblings by relative path; Tauri's asset URL encodes the
    // whole path into one segment, so point the resource base at the real folder
    // (same fix as ModelViewer). A .glb is self-contained and skips this.
    if (/\.gltf(\?|#|$)/i.test(url)) {
      const enc = url.lastIndexOf("%2F");
      const raw = url.lastIndexOf("/");
      const cut = Math.max(enc, raw);
      if (cut > 0) loader.setResourcePath(url.slice(0, cut + (cut === enc ? 3 : 1)));
    }

    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    const dims = box.getSize(new THREE.Vector3());
    model.position.sub(centre);
    scene.add(model);

    const maxDim = Math.max(dims.x, dims.y, dims.z) || 1;
    const dist = (maxDim / 2 / Math.tan((FOV * Math.PI) / 180 / 2)) * 1.18;
    camera.near = maxDim / 200;
    camera.far = maxDim * 200;

    const frames: { view: string; dataUri: string }[] = [];
    for (const view of TURNAROUND_VIEWS) {
      const [x, y, z] = POSES[view];
      camera.position.set(x * dist, y * dist, z * dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      frames.push({ view, dataUri: renderer.domElement.toDataURL("image/png") });
    }

    scene.remove(model);
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    return frames;
  }

  function dispose() {
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return { render, dispose };
}
