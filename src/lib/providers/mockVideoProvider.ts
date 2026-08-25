import type { GenerationIntent } from "../continuity";
import type { VideoGenerationOptions, VideoGenerationResult, VideoProvider } from "./types";
import { buildSkyline, drawSky, drawSkyline, drawWeather, hashString, makeRandom, wrapText } from "./sceneRenderer";
import { blobToDataUrl } from "./mediaEncoding";

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return "video/webm";
}

export const mockVideoProvider: VideoProvider = {
  id: "mock",
  label: "Mock Motion Renderer (local, no API)",
  async generate(intent: GenerationIntent, options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("This system's webview does not support recording video (MediaRecorder unavailable).");
    }

    const width = 960;
    const height = 540;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create a rendering surface for the mock motion renderer.");

    const settings = intent.settings as { timeOfDay?: string; weather?: string; colorPalette?: string[]; motionDescription?: string };
    const seed = hashString(intent.prompt + JSON.stringify(intent.settings));
    const palette = settings.colorPalette?.length ? settings.colorPalette : ["#8b7bf6", "#2a2a3d", "#f6a35b"];
    const buildings = buildSkyline(seed, width + 240, height);
    const durationMs = Math.max(1, options.durationSeconds) * 1000;

    const stream = canvas.captureStream(30);
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const recorded = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = (event) => reject((event as unknown as { error?: Error }).error || new Error("Recording failed."));
    });

    const startedAt = performance.now();
    let frameHandle = 0;
    const drawFrame = () => {
      const elapsed = performance.now() - startedAt;
      const t = Math.min(1, elapsed / durationMs);

      // Slow camera pan across the pre-laid-out skyline, easing at both ends.
      const eased = t - Math.sin(t * Math.PI * 2) / (Math.PI * 4);
      const panOffset = eased * 200;
      const random = makeRandom(seed + Math.floor(elapsed / 33));

      drawSky(ctx, width, height, settings.timeOfDay || "day");
      drawSkyline(ctx, buildings, palette, width, height, panOffset);
      drawWeather(ctx, settings.weather || "", width, height, random, t);

      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, height - 78, width, 78);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "14px sans-serif";
      wrapText(ctx, settings.motionDescription || "Gentle ambient drift", 18, height - 50, width - 36, 20, 2);

      if (elapsed < durationMs) {
        frameHandle = requestAnimationFrame(drawFrame);
      }
    };

    recorder.start();
    frameHandle = requestAnimationFrame(drawFrame);
    await new Promise((resolve) => setTimeout(resolve, durationMs + 120));
    cancelAnimationFrame(frameHandle);
    recorder.stop();

    const blob = await recorded;
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, extension: "webm" };
  },
};
