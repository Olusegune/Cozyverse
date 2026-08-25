import type { GenerationIntent } from "../continuity";
import type { AudioGenerationOptions, AudioGenerationResult, AudioProvider } from "./types";
import { hashString, makeRandom } from "./sceneRenderer";
import { blobToDataUrl, encodeWavPcm16 } from "./mediaEncoding";

const SAMPLE_RATE = 44100;

const MAJOR_PENTATONIC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
const MINOR_PENTATONIC = [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5];

function scaleForMood(mood: string): number[] {
  const key = mood.toLowerCase();
  return key.includes("dream") || key.includes("melanchol") || key.includes("mystery") ? MINOR_PENTATONIC : MAJOR_PENTATONIC;
}

function scheduleEnvelope(gain: GainNode, ctx: OfflineAudioContext, start: number, attack: number, decay: number, sustain: number, peak: number) {
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.linearRampToValueAtTime(peak * sustain, start + attack + decay);
}

function fillNoise(ctx: OfflineAudioContext, random: () => number, length: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, length, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = random() * 2 - 1;
  return buffer;
}

function renderAmbience(ctx: OfflineAudioContext, duration: number, random: () => number, weather: string, mood: string) {
  const master = ctx.createGain();
  master.connect(ctx.destination);
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.5, Math.min(1, duration * 0.15));
  master.gain.setValueAtTime(0.5, Math.max(0, duration - Math.min(1, duration * 0.15)));
  master.gain.linearRampToValueAtTime(0, duration);

  const noise = ctx.createBufferSource();
  noise.buffer = fillNoise(ctx, random, Math.ceil(duration * SAMPLE_RATE));
  noise.loop = false;
  const filter = ctx.createBiquadFilter();
  const key = weather.toLowerCase();
  if (key.includes("rain") || key.includes("storm")) {
    filter.type = "bandpass";
    filter.frequency.value = 2200;
    filter.Q.value = 0.6;
  } else if (key.includes("wind") || key.includes("fog")) {
    filter.type = "lowpass";
    filter.frequency.value = 500;
  } else {
    filter.type = "lowpass";
    filter.frequency.value = 900;
  }
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = key.includes("rain") || key.includes("storm") ? 0.9 : 0.35;
  noise.connect(filter).connect(noiseGain).connect(master);
  noise.start(0);

  const drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = mood.toLowerCase().includes("dream") ? 130.8 : 110;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.08;
  drone.connect(droneGain).connect(master);
  drone.start(0);
  drone.stop(duration);
  noise.stop(duration);
}

function renderMusic(ctx: OfflineAudioContext, duration: number, random: () => number, mood: string) {
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  const scale = scaleForMood(mood);
  const baseFrequency = 220;
  const noteLength = 0.55;
  let time = 0;
  while (time < duration) {
    const ratio = scale[Math.floor(random() * scale.length)];
    const octave = random() > 0.7 ? 2 : 1;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = baseFrequency * ratio * octave;
    const gain = ctx.createGain();
    scheduleEnvelope(gain, ctx, time, 0.03, noteLength * 0.4, 0.3, 0.6);
    gain.gain.linearRampToValueAtTime(0, time + noteLength);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + noteLength + 0.05);
    time += noteLength * (0.85 + random() * 0.3);
  }
}

function renderSfx(ctx: OfflineAudioContext, duration: number, random: () => number) {
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  const startFrequency = 500 + random() * 400;
  osc.frequency.setValueAtTime(startFrequency, 0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(60, startFrequency * 0.2), duration);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.8, 0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, duration);
  osc.connect(oscGain).connect(master);
  osc.start(0);
  osc.stop(duration);

  const noise = ctx.createBufferSource();
  noise.buffer = fillNoise(ctx, random, Math.ceil(duration * SAMPLE_RATE));
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1500;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, 0);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, duration);
  noise.connect(filter).connect(noiseGain).connect(master);
  noise.start(0);
  noise.stop(duration);
}

export const mockAudioProvider: AudioProvider = {
  id: "mock",
  label: "Mock Audio Renderer (local, no API)",
  async generate(intent: GenerationIntent, options: AudioGenerationOptions): Promise<AudioGenerationResult> {
    if (typeof OfflineAudioContext === "undefined") {
      throw new Error("This system's webview does not support offline audio rendering.");
    }
    const settings = intent.settings as { kind?: string; weather?: string; mood?: string };
    const kind = settings.kind || "ambience";
    const duration = kind === "sfx" ? Math.min(2.5, Math.max(0.4, options.durationSeconds)) : Math.max(1, options.durationSeconds);
    const seed = hashString(intent.prompt + JSON.stringify(intent.settings));
    const random = makeRandom(seed);

    const ctx = new OfflineAudioContext(1, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
    if (kind === "music") renderMusic(ctx, duration, random, settings.mood || "Cozy");
    else if (kind === "sfx") renderSfx(ctx, duration, random);
    else renderAmbience(ctx, duration, random, settings.weather || "Clear", settings.mood || "Cozy");

    const rendered = await ctx.startRendering();
    const blob = encodeWavPcm16(rendered.getChannelData(0), SAMPLE_RATE);
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, extension: "wav" };
  },
};
