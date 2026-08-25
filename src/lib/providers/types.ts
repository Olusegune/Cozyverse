import type { GenerationIntent } from "../continuity";

export type ImageGenerationResult = {
  /** PNG bytes as a data URL (data:image/png;base64,...). */
  dataUrl: string;
};

export interface ImageProvider {
  id: string;
  label: string;
  generate(intent: GenerationIntent): Promise<ImageGenerationResult>;
}

export type VideoGenerationResult = {
  /** WebM bytes as a data URL (data:video/webm;base64,...). */
  dataUrl: string;
  extension: string;
};

export type VideoGenerationOptions = {
  durationSeconds: number;
  loop: boolean;
};

export interface VideoProvider {
  id: string;
  label: string;
  generate(intent: GenerationIntent, options: VideoGenerationOptions): Promise<VideoGenerationResult>;
}

export type AudioGenerationResult = {
  /** WAV bytes as a data URL (data:audio/wav;base64,...). */
  dataUrl: string;
  extension: string;
};

export type AudioGenerationOptions = {
  durationSeconds: number;
};

export interface AudioProvider {
  id: string;
  label: string;
  generate(intent: GenerationIntent, options: AudioGenerationOptions): Promise<AudioGenerationResult>;
}
