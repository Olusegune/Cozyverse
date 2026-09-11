import { X } from "lucide-react";

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: "Golden path",
    body: [
      "Create a Cozyverse from Projects, then fill in the World Bible — this is the one place identity lives, and everything else draws from it.",
      "Generate a master image in Image Studio, then create Variants (weather/lighting/season changes) or Shots (close-ups on a subject) derived from it.",
      "Turn a still into a short clip in Motion Studio, add ambience/music/SFX/dialogue in Audio Studio, then compose it all in Scene Composer.",
      "World Map is the landing view after opening a project — every scene as a diorama tile, click one to jump into Scene Composer for it. Preview the result, then package everything into a single portable file from Export.",
    ],
  },
  {
    title: "Cast & Props",
    body: [
      "Define recurring characters, props, vehicles, and sets once — a name, a style sheet, reference images — then pick them into any Shot Mode generation in Image or Motion Studio. Picking one auto-attaches its reference image (on models that support it) and folds its style sheet into the prompt either way.",
      "Each entry can design its own reference image directly: describe it, pick a model, generate. \"Turnaround\" generates front/back/left/right views in one click. \"Match project style\" lets it inherit the project's own established Style Stack, or pick a different one. \"Design Sheet\" exports a branded reference-sheet PNG.",
    ],
  },
  {
    title: "Mock vs. real generation",
    body: [
      "Every studio has a Rendering toggle: Mock (local, free, no API key) or Auto (a connected real provider). Mock is what the app is validated against and always works offline.",
      "Add provider API keys in Settings to unlock real generation. Nothing is ever required — Mock output is a genuine fallback, not a placeholder. Settings also shows a running count of real generations this project has made, by provider.",
    ],
  },
  {
    title: "Style Stack & Musical Cozies",
    body: [
      "Image Studio's Style Stack is a set of independent art-direction layers (art style, material, lighting, color, camera, etc.) that compose into the prompt — leave any at \"None\" to fall back to the World Bible's own style. Drop in a reference photo under \"Style from a Photo\" to have it described as a ready-to-use Custom Style instead of picking words by hand.",
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
      "IMAGE PATH: a zip of every object for any external image-to-3D tool. \"Download image pack (.zip)\" is free and instant — the pipeline's cutout (+ Zero123++ side views if you ran them), each normalised to a 1024px white canvas. \"AI turnaround\" (paid) re-renders all five views per object — perspective + front/back/left/right — large and clean on white. Pick the engine from the dropdown: Gemini Nano Banana (cheapest, best identity), fal's Nano Banana / FLUX.1 Kontext / Seedream 4, or OpenAI gpt-image-2 — whichever keys you have. Perspective/front are observed; the front is then fed to the back/side calls as a reference so identity holds, but those angles are still inferred. Both exports are on the confirm block and on finished jobs; neither touches Tripo/Meshy.",
      "3D PATH (paid): needs a Tripo and/or Meshy API key (Settings). The confirm block shows a thumbnail of every detected object with a checkbox — untick the junk (a wall, a duplicate) so you don't pay for it — your live provider balance, and exactly how many paid generations \"Send to 3D\" will start (a Fast path always; an optional experimental Quality path from the 4 views). A Stop button cancels a run; \"Retry failed (N)\" re-runs only the models that failed, keeping the ones that worked.",
      "PREVIEW: on a finished job, click any cell with a GLB tag to open a rotatable 3D preview right in the panel — no need to leave for Blender to check the result. Finished .glb files are in the project's assets/models folder.",
      "FREE MODELS (not to be confused with the Assets nav page): the confirm block's \"Free Models\" tab — per object, \"Find a free asset\" pulls ranked CC0 matches from Poly Haven; pick one and it downloads into assets/library/ and attaches like a generated model (and becomes the preferred one in scene.json). A CREDITS.txt is written automatically. \"Use N library assets & finish\" completes a job with no provider spend. Best for generic furniture/props; mix it with AI gen for the bespoke pieces.",
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
    title: "Prompt Assist & Continuity Guardian (Ollama)",
    body: [
      "Connect a local Ollama model once in Settings — no key, no cost, fully private. The ✨ Assist button next to any prompt field turns a plain-language idea into ready-to-use prompt drafts grounded in the World Bible and scene conditions.",
      "\"Check Continuity\" (next to the Cast & Props picker) compares a prompt against selected entities' style sheets and the World Bible's Things to Avoid, flagging contradictions with a one-click fix. Storyboard has a whole-reel version that checks every scene's prompt against every other scene's, catching contradictions a single shot can't reveal on its own.",
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
