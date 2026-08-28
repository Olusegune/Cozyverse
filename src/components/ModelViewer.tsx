// A minimal self-contained GLB viewer: three.js scene + OrbitControls +
// GLTFLoader, no external CDN. Used to preview the models a decompose job
// produced without leaving the app. Loads from a Tauri asset-protocol URL
// (see decompose_file_path + convertFileSrc).

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Loader2 } from "lucide-react";

function ModelViewerImpl({
  src,
  className,
  autoRotate = true,
}: {
  src: string;
  className?: string;
  autoRotate?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    setStatus("loading");
    const width = mount.clientWidth || 320;
    const height = mount.clientHeight || 220;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x505060, 3.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 3.0);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.4);
    fill.position.set(-4, 2, -3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.0);
    rim.position.set(0, 3, -5);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.6;

    let raf = 0;
    let disposed = false;
    const root = new THREE.Group();
    scene.add(root);

    const loader = new GLTFLoader();
    // A .glb is self-contained. A .gltf pulls a sibling .bin + textures by
    // relative path — but Tauri's asset URL percent-encodes the whole file path
    // into one opaque segment, so GLTFLoader's default "everything up to the last
    // slash" base is just "http://asset.localhost/". Point it at the real folder
    // (kept %2F-encoded) so `base + "foo.bin"` decodes to the right file.
    if (/\.gltf(\?|#|$)/i.test(src)) {
      const enc = src.lastIndexOf("%2F");
      const raw = src.lastIndexOf("/");
      const cut = Math.max(enc, raw);
      if (cut > 0) {
        loader.setResourcePath(src.slice(0, cut + (cut === enc ? 3 : 1)));
      }
    }

    loader.load(
      src,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        model.position.sub(center);
        root.add(model);

        const dist = maxDim * 1.5;
        camera.position.set(dist * 0.85, dist * 0.55, dist);
        camera.near = maxDim / 100;
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) setStatus("error");
      },
    );

    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      const w = mount.clientWidth || width;
      const h = mount.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [src, autoRotate]);

  return (
    <div className={`relative overflow-hidden rounded-md bg-base-950 ${className ?? ""}`}>
      <div ref={mountRef} className="h-full w-full" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
          {status === "loading" ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> loading model…
            </span>
          ) : (
            "couldn't load this model"
          )}
        </div>
      )}
    </div>
  );
}

// Default export so DecomposePanel can React.lazy() this — three.js is ~600 KB
// and most sessions never open a 3D preview.
export default ModelViewerImpl;
