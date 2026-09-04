/** Composites a "Design Sheet" for a Cast & Props entity — name, kind, style sheet text, and a grid
 * of its reference images — entirely client-side via <canvas>, in the same warm gold-on-dark
 * identity as the Postcard export and splash screens (see lib/postcard.ts, which this deliberately
 * mirrors rather than inventing a second visual language). Produces a standalone PNG blob; never
 * touches the project's own assets. A real production "character bible" page, not a screenshot. */

const WIDTH = 1600;
const GOLD = "#e0a034";
const INK = "#0c0906";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load a reference image for the design sheet."));
    img.src = url;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): number {
  const words = text.split(/\s+/);
  let line = "";
  let lineCount = 0;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines) break;
    } else {
      line = testLine;
    }
  }
  if (line && lineCount < maxLines) {
    ctx.fillText(line, x, y + lineCount * lineHeight);
    lineCount += 1;
  }
  return lineCount;
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / img.width, height / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.drawImage(img, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  ctx.restore();
}

export async function renderDesignSheet(imageUrls: string[], name: string, kindLabel: string, styleSheet: string): Promise<Blob> {
  const images = await Promise.all(imageUrls.slice(0, 6).map(loadImage));

  // Height is content-driven: a header band, a wrapped style-sheet block sized to however many
  // lines it actually needs, then a grid of however many reference images exist (up to 6, 3 per row).
  const headerHeight = 200;
  const styleSheetLineHeight = 30;
  const styleSheetMaxLines = 6;
  const rows = Math.max(1, Math.ceil(images.length / 3));
  const gridCellSize = (WIDTH - 56 * 2 - 24 * 2) / 3;
  const gridHeight = images.length > 0 ? rows * gridCellSize + (rows - 1) * 24 : 0;
  const styleSheetBlockHeight = styleSheet.trim() ? styleSheetMaxLines * styleSheetLineHeight + 56 : 0;
  const height = headerHeight + styleSheetBlockHeight + gridHeight + 64;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = Math.max(height, 400);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't render a design sheet (no 2D canvas context).");

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textBaseline = "alphabetic";
  ctx.font = "600 22px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = GOLD;
  ctx.letterSpacing = "2px";
  ctx.fillText("COZYVERSE STUDIO — DESIGN SHEET", 56, 58);
  ctx.letterSpacing = "0px";

  ctx.font = "700 52px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name || "Untitled", 56, 122);

  ctx.font = "500 22px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = GOLD;
  ctx.fillText(kindLabel.toUpperCase(), 56, 158);

  ctx.strokeStyle = "rgba(224,160,52,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(56, headerHeight - 20);
  ctx.lineTo(WIDTH - 56, headerHeight - 20);
  ctx.stroke();

  let cursorY = headerHeight;
  if (styleSheet.trim()) {
    ctx.font = "500 18px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("STYLE SHEET", 56, cursorY + 24);
    ctx.font = "400 24px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    wrapText(ctx, styleSheet.trim(), 56, cursorY + 60, WIDTH - 112, styleSheetLineHeight, styleSheetMaxLines);
    cursorY += styleSheetBlockHeight;
  }

  images.forEach((img, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 56 + col * (gridCellSize + 24);
    const y = cursorY + row * (gridCellSize + 24);
    drawCover(ctx, img, x, y, gridCellSize, gridCellSize);
    ctx.strokeStyle = "rgba(224,160,52,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, gridCellSize, gridCellSize);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export the design sheet image."))), "image/png");
  });
}
