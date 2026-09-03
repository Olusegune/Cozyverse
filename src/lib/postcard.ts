/** Composites a shareable "Cozyverse Postcard" — a scene image with the app's own branding treatment
 * (wordmark, title, subtitle over a bottom gradient) — entirely client-side via <canvas>, reusing the
 * same warm gold-on-dark identity as the splash screens rather than inventing a new look. Never
 * touches the project's own assets; produces a standalone PNG blob for the caller to save. */

const WIDTH = 1600;
const HEIGHT = 1000;
const GOLD = "#e0a034";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image to build a postcard from."));
    img.src = url;
  });
}

/** Draws an image into the canvas with cover-fit (fills the frame, cropping overflow), the same
 * behavior as CSS object-fit: cover, since canvas has no built-in equivalent. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / img.width, height / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  ctx.drawImage(img, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): void {
  const words = text.split(/\s+/);
  let line = "";
  let lineCount = 0;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines - 1) break;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(lineCount >= maxLines - 1 && line !== words[words.length - 1] ? `${line}…` : line, x, y + lineCount * lineHeight);
}

export async function renderPostcard(imageUrl: string, title: string, subtitle?: string): Promise<Blob> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't render a postcard (no 2D canvas context).");

  drawCover(ctx, img, WIDTH, HEIGHT);

  const gradient = ctx.createLinearGradient(0, HEIGHT * 0.45, 0, HEIGHT);
  gradient.addColorStop(0, "rgba(12,9,6,0)");
  gradient.addColorStop(1, "rgba(12,9,6,0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textBaseline = "alphabetic";
  ctx.font = "600 26px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = GOLD;
  ctx.letterSpacing = "2px";
  ctx.fillText("COZYVERSE STUDIO", 56, 64);
  ctx.letterSpacing = "0px";

  ctx.font = "700 58px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  const titleY = subtitle ? HEIGHT - 120 : HEIGHT - 64;
  ctx.fillText(title, 56, titleY);

  if (subtitle) {
    ctx.font = "400 26px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    wrapText(ctx, subtitle, 56, titleY + 44, WIDTH - 112, 34, 2);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export the postcard image."))), "image/png");
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the generated image"));
    reader.readAsDataURL(blob);
  });
}
