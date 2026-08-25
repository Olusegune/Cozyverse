import type { GenerationIntent } from "../continuity";
import type { ImageGenerationResult, ImageProvider } from "./types";
import { buildSkyline, drawSky, drawSkyline, drawWeather, hashString, wrapText } from "./sceneRenderer";

export const mockImageProvider: ImageProvider = {
  id: "mock",
  label: "Mock Studio Renderer (local, no API)",
  async generate(intent: GenerationIntent): Promise<ImageGenerationResult> {
    // Simulate queue + generation latency so the job lifecycle UI has something to show.
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 700));

    const width = 1024;
    const height = 640;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create a rendering surface for the mock provider.");

    const settings = intent.settings as { timeOfDay?: string; weather?: string; colorPalette?: string[] };
    const seed = hashString(intent.prompt + JSON.stringify(intent.settings));
    const palette = settings.colorPalette?.length ? settings.colorPalette : ["#8b7bf6", "#2a2a3d", "#f6a35b"];

    drawSky(ctx, width, height, settings.timeOfDay || "day");
    drawSkyline(ctx, buildSkyline(seed, width, height), palette, width, height, 0);
    drawWeather(ctx, settings.weather || "", width, height, (() => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })());

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, height - 92, width, 92);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "16px sans-serif";
    wrapText(ctx, intent.prompt || "Untitled Cozyverse", 20, height - 62, width - 40, 22, 2);

    return { dataUrl: canvas.toDataURL("image/png") };
  },
};
