// Shared canvas rendering helpers for the mock image and video providers. Kept here so both
// providers stay visually consistent without depending on each other.

export function makeRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}

const TIME_SKY: Record<string, [string, string]> = {
  morning: ["#ffd9a0", "#7ba7d9"],
  day: ["#bfe3ff", "#5aa0e0"],
  sunset: ["#ff9a6b", "#3a2f5c"],
  night: ["#1a1a3d", "#05050f"],
};

export function skyColors(timeOfDay: string): [string, string] {
  const key = timeOfDay.toLowerCase();
  const match = Object.keys(TIME_SKY).find((candidate) => key.includes(candidate));
  return TIME_SKY[match || "day"];
}

export type SkylineBuilding = { x: number; w: number; h: number; windows: Array<[number, number]> };

/** Deterministic skyline layout for a given seed, so pan/zoom animation stays stable frame to frame. */
export function buildSkyline(seed: number, width: number, height: number): SkylineBuilding[] {
  const random = makeRandom(seed);
  const buildings: SkylineBuilding[] = [];
  let x = -80;
  while (x < width + 80) {
    const w = 40 + random() * 90;
    const h = 60 + random() * 180;
    const windows: Array<[number, number]> = [];
    for (let wy = height * 0.65 - h + 10; wy < height * 0.65 - 8; wy += 16) {
      for (let wx = x + 6; wx < x + w - 6; wx += 14) {
        if (random() > 0.55) windows.push([wx, wy]);
      }
    }
    buildings.push({ x, w, h, windows });
    x += w + random() * 20;
  }
  return buildings;
}

export function drawSky(ctx: CanvasRenderingContext2D, width: number, height: number, timeOfDay: string) {
  const [skyTop, skyBottom] = skyColors(timeOfDay);
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.7);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height * 0.7);
}

export function drawSkyline(ctx: CanvasRenderingContext2D, buildings: SkylineBuilding[], palette: string[], width: number, height: number, panOffset: number) {
  ctx.fillStyle = palette[0] || "#2a2a3d";
  ctx.fillRect(0, height * 0.65, width, height * 0.35);
  for (const building of buildings) {
    ctx.fillStyle = palette[1] || "#1f1f30";
    ctx.fillRect(building.x - panOffset, height * 0.65 - building.h, building.w, building.h);
    ctx.fillStyle = palette[2] || "#f6a35b";
    for (const [wx, wy] of building.windows) ctx.fillRect(wx - panOffset, wy, 6, 8);
  }
}

/** `phase` is 0..1 progress used to animate falling rain/snow across a frame or a video's timeline. */
export function drawWeather(ctx: CanvasRenderingContext2D, weather: string, width: number, height: number, random: () => number, phase = 0) {
  const key = weather.toLowerCase();
  if (key.includes("rain")) {
    ctx.strokeStyle = "rgba(200,220,255,0.35)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 140; index += 1) {
      const x = random() * width;
      const y = (random() * height + phase * height * 6) % height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 14);
      ctx.stroke();
    }
  } else if (key.includes("snow")) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (let index = 0; index < 100; index += 1) {
      const x = (random() * width + phase * 20) % width;
      const y = (random() * height + phase * height * 2) % height;
      const r = 1 + random() * 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key.includes("fog") || key.includes("mist")) {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let band = 0; band < 4; band += 1) {
      ctx.fillRect(0, height * 0.5 + band * (height * 0.12), width, height * 0.08);
    }
  }
}

const LABEL_PALETTE = ["#e0575b", "#e0a63e", "#4fae74", "#3ea0d9", "#8b7bf6", "#d9578f", "#5bbfae", "#c98a3e"];

/** Picks a short, at-a-glance label for a mock render so otherwise-identical placeholder art
 * (same skyline shape, same generic scene) can still be told apart in a small thumbnail grid —
 * a real gap we hit doing QA on Cast & Props turnarounds, where every angle rendered as the same
 * generic skyline. Turnaround angle suffixes get their own short word; anything else falls back to
 * the prompt's first few meaningful words. */
export function deriveDistinguishingLabel(prompt: string): string {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  if (/front view|facing directly toward/.test(lower)) return "FRONT";
  if (/back view|facing directly away/.test(lower)) return "BACK";
  if (/left side profile/.test(lower)) return "LEFT";
  if (/right side profile/.test(lower)) return "RIGHT";
  if (!text) return "UNTITLED";
  const firstClause = text.split(/[,.\n]/)[0].trim();
  const words = firstClause.split(/\s+/).filter(Boolean).slice(0, 3);
  return (words.join(" ") || text.slice(0, 24)).toUpperCase();
}

/** A deterministic accent color for a given seed, from a fixed palette spaced for contrast against
 * each other — used so the label badge (and, by extension, the thumbnail as a whole) reads as a
 * distinct color at a glance, not just distinct text. */
export function pickAccentColor(seed: number): string {
  return LABEL_PALETTE[seed % LABEL_PALETTE.length];
}

/** Draws a bold, high-contrast label band across the vertical center of the canvas — positioned so
 * it survives a center-weighted `object-cover` crop into a square thumbnail, and sized to shrink
 * automatically until the label fits. This is the primary way a mock-rendered image reads as
 * distinct from another at 40px, where the bottom prompt strip is illegible. */
export function drawLabelBadge(ctx: CanvasRenderingContext2D, width: number, height: number, label: string, color: string) {
  const bandHeight = height * 0.22;
  const bandY = height * 0.5 - bandHeight / 2;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.88;
  ctx.fillRect(0, bandY, width, bandHeight);
  ctx.globalAlpha = 1;

  let fontSize = 64;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  const maxWidth = width * 0.6; // stays inside the center-crop-safe region even on a square thumbnail
  do {
    ctx.font = `700 ${fontSize}px sans-serif`;
    fontSize -= 4;
  } while (ctx.measureText(label).width > maxWidth && fontSize > 20);
  ctx.fillText(label, width / 2, bandY + bandHeight / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
      lines += 1;
      if (lines >= maxLines) return;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y);
}
