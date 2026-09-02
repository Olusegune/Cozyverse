import type { RegisteredModel } from "./providers/modelRegistry";
import type { Scene, WorldBible } from "../types";

export type PromptAssistKind = "image" | "video" | "audio" | "ambience" | "sfx";

const KIND_LABEL: Record<PromptAssistKind, string> = {
  image: "a still image",
  video: "a short video clip",
  audio: "background music",
  ambience: "an ambient sound loop",
  sfx: "a one-shot sound effect",
};

/** Resolves the current value of a scene's weather/time/lighting controls into plain words, same
 * fields Scene Composer and Storyboard already read for their own background-matching logic. */
function sceneEnvironment(scene: Scene | undefined): string {
  if (!scene) return "";
  const parts: string[] = [];
  for (const control of scene.controls) {
    if (["time", "lighting", "weather"].includes(control.target)) {
      parts.push(`${control.target === "time" ? "time of day" : control.target}: ${String(control.value)}`);
    }
  }
  return parts.join(", ");
}

/** A short note on how the target model likes prompts written, where that's known — e.g. models
 * with a confirmed @mention reference syntax get told to use it. Deliberately terse: this is a
 * hint for the local LLM's system prompt, not documentation. */
function modelIdiomNote(model: RegisteredModel | undefined): string {
  if (!model) return "";
  const notes: string[] = [`Target model: ${model.label} (family: ${model.family}).`];
  if (model.mentionSyntax?.images || model.mentionSyntax?.video || model.mentionSyntax?.audio) {
    const kinds = [model.mentionSyntax.images && "@Image1/@Image2…", model.mentionSyntax.video && "@Video1", model.mentionSyntax.audio && "@Audio1"]
      .filter(Boolean)
      .join(", ");
    notes.push(`This model supports @mention tags (${kinds}) to refer to specific reference assets by name within the prompt text — use them naturally if it fits.`);
  }
  if (model.requiresStartFrame) notes.push("This model animates from a fixed start frame — describe motion and camera movement, not the starting composition (that's the reference image).");
  return notes.join(" ");
}

/** Builds the system prompt for one Ollama call — bakes in World Bible style/tone/characters, the
 * active scene's environmental state, and the target model's own prompting idiom, so suggestions
 * stay continuous with the rest of the project instead of reading as generic stock prompts. */
export function buildAssistSystemPrompt(kind: PromptAssistKind, worldBible: WorldBible | undefined, scene: Scene | undefined, model: RegisteredModel | undefined): string {
  const lines: string[] = [
    `You are a prompt-writing assistant inside a creative tool called Cozyverse Studio. The user will describe a rough idea or concept, and you write ${KIND_LABEL[kind]} generation prompts from it.`,
  ];

  if (worldBible?.artStyle) lines.push(`Art/visual style to stay consistent with: ${worldBible.artStyle}.`);
  if (worldBible?.mood) lines.push(`Overall mood/tone: ${worldBible.mood}.`);
  if (worldBible?.characters) lines.push(`Established characters (keep consistent if referenced): ${worldBible.characters}.`);
  if (worldBible?.thingsToAvoid) lines.push(`Avoid: ${worldBible.thingsToAvoid}.`);
  const environment = sceneEnvironment(scene);
  if (environment) lines.push(`Current scene environment: ${environment}.`);

  const idiom = modelIdiomNote(model);
  if (idiom) lines.push(idiom);

  lines.push(
    "Write exactly 3 distinct prompt drafts based on the user's idea. Each should be a single self-contained paragraph, ready to paste directly into a generation tool — no numbering, no quotes, no markdown, no explanations, no preamble like \"Here are 3 options\".",
    "Separate the 3 drafts with a line containing only ---.",
  );

  return lines.join(" \n");
}

/** Splits Ollama's raw response into individual prompt drafts, defensively — local models don't
 * always follow the "---" separator instruction exactly, so this also falls back to splitting on
 * numbered-list markers or blank lines when no separator is present. Strips common leading
 * numbering/quote/markdown artifacts from each draft. */
export function parseAssistVariants(raw: string): string[] {
  let parts = raw.split(/\n\s*---\s*\n/);
  if (parts.length < 2) parts = raw.split(/\n(?=\d+[.)]\s)/);
  if (parts.length < 2) parts = raw.split(/\n{2,}/);

  return parts
    .map((part) =>
      part
        .trim()
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^["'“]|["'”]$/g, "")
        .replace(/^\*\*|\*\*$/g, "")
        .trim(),
    )
    .filter((part) => part.length > 0)
    .slice(0, 3);
}
