import { X } from "lucide-react";

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: "Golden path",
    body: [
      "Create a Cozyverse from Projects, then fill in the World Bible — this is the one place identity lives, and everything else draws from it.",
      "Generate a master image in Image Studio, then create Variants (weather/lighting/season changes) or Shots (close-ups on a subject) derived from it.",
      "Turn a still into a short clip in Motion Studio, add ambience/music/SFX/dialogue in Audio Studio, then compose it all in Scene Composer.",
      "Preview the result, then package everything into a single portable file from Export.",
    ],
  },
  {
    title: "Mock vs. real generation",
    body: [
      "Every studio has a Rendering toggle: Mock (local, free, no API key) or Auto (a connected real provider). Mock is what the app is validated against and always works offline.",
      "Add provider API keys in Settings to unlock real generation. Nothing is ever required — Mock output is a genuine fallback, not a placeholder.",
    ],
  },
  {
    title: "Style Stack & Musical Cozies",
    body: [
      "Image Studio's Style Stack is a set of independent art-direction layers (art style, material, lighting, color, camera, etc.) that compose into the prompt — leave any at \"None\" to fall back to the World Bible's own style.",
      "Musical Cozy presets (in Image Studio and Audio Studio → Music) apply a genre's whole visual + sonic identity in one click, refinable afterward.",
    ],
  },
  {
    title: "Model selection (Pro)",
    body: [
      "When Auto rendering is on, a Model dropdown appears wherever more than one real provider supports that job — pick a specific model instead of trusting the automatic best-match pick.",
      "Image Studio also has a Prompt Preview panel showing the exact composed prompt before it's sent, and a Raw Prompt Override to bypass composition entirely.",
    ],
  },
  {
    title: "Local Models (ComfyUI)",
    body: [
      "In Settings, add a local model by uploading a workflow exported from ComfyUI as API-format JSON (Workflow → Export (API), not a regular save), then pick which node holds the prompt text and, optionally, which node takes a source image.",
      "Once added, it shows up in that capability's Model dropdown alongside cloud models — no API key, no cost, runs on your own machine (e.g. LTX, Wan, HunyuanVideo, or anything else you've got set up).",
    ],
  },
  {
    title: "Decompose — 3D or images",
    body: [
      "Every image card in Image Studio has a \"Decompose (3D or images)\" button. It breaks the picture into its separate objects (furniture, decor, props); the panel below the gallery then offers two paths for those objects.",
      "One-time setup, in the panel: Quick (~400 MB, CPU — clean cutouts, no side views) or Full (~3 GB, GPU — adds Zero123++ synthesized front/back/left/right views). Both install into an isolated environment Cozyverse manages. Stub mode skips all of it with one placeholder crop, for testing the wiring.",
      "IMAGE PATH (free): in the confirm block press \"Download image pack (.zip)\" — a zip of every object as a PNG cutout, plus its four views if the Full pipeline made them, plus a manifest. Take these into any image-to-3D tool. No API key, nothing billed. The same button is on finished jobs.",
      "3D PATH (paid): needs a Tripo and/or Meshy API key (Settings). The confirm block shows the object count and exactly how many paid generations \"Send to 3D\" will start — a Fast path (object crop → single-image model) always, and an optional experimental Quality path (the 4 views → multi-view model). Finished .glb files land in the project's assets/models folder; a Stop button cancels a run in progress.",
    ],
  },
  {
    title: "Using the 3D models (Blender / Unity / Unreal)",
    body: [
      "Each model is a standard textured .glb in assets/models/, named <object>_<provider>_<path>.glb. Next to each finished job is scene.json — a manifest listing every object with its bounding box in the source image, so an importer can lay the pieces back out as a scene.",
      "Blender: install integrations/blender/cozyverse_bridge.py via Edit ▸ Preferences ▸ Add-ons ▸ Install, enable \"Cozyverse Bridge\", then Sidebar (N) ▸ Cozyverse ▸ point at scene.json ▸ Import Decomposed Scene. For a single model, File ▸ Import ▸ glTF 2.0.",
      "Unity: drop the .glb files into Assets/ (install the glTFast or UnityGLTF package first), drag each into the scene. Unreal: drag the .glb into the Content Browser, or File ▸ Import Into Level (Interchange glTF is enabled by default in UE 5.x).",
      "The \"How to use these files\" toggle on a finished job repeats these steps in-app. Full walkthrough with screenshots: docs/decompose-to-3d-tutorial/. Add-on details: integrations/blender/README.md.",
    ],
  },
  {
    title: "Nothing is ever silently lost",
    body: [
      "Deleting an asset or a whole Cozyverse moves it to a _trash folder next to it rather than deleting it outright — always recoverable from disk.",
      "Every generation is kept in project history; nothing is overwritten by a new attempt.",
    ],
  },
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-8" onClick={onClose}>
      <div
        className="relative bg-base-900 border border-base-700 w-full max-w-xl max-h-[80vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-700">
          <h2 className="font-display font-semibold text-white text-base">Documentation</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-semibold text-accent-400 mb-1.5">{section.title}</h3>
              <ul className="space-y-1.5">
                {section.body.map((line, index) => (
                  <li key={index} className="text-sm text-slate-300 leading-relaxed">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
