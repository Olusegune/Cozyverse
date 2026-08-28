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
    title: "Decompose & Send to 3D",
    body: [
      "Every image card in Image Studio has a \"Decompose & Send to 3D\" button. It breaks the picture into its separate objects (furniture, decor, props) and turns each one into a 3D model.",
      "It runs two ways at once: a Fast path (the object's crop straight to a single-image 3D model) and a Quality path (four synthesized orthographic views to a multi-view model). Both go to Tripo and Meshy in parallel — up to four models per object.",
      "Add a Tripo and/or Meshy API key in Settings first. After segmenting, the panel shows how many objects were found and how many paid generations that means — nothing is sent until you press Send to 3D.",
      "Stub mode (toggle in the panel) skips the local pipeline and uses a single placeholder crop — for testing the wiring without the GPU step. Finished GLB files land in the project's assets/models folder.",
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
