import type { AudioProvider, ImageProvider, VideoProvider } from "./types";
import { mockImageProvider } from "./mockImageProvider";
import { mockVideoProvider } from "./mockVideoProvider";
import { mockAudioProvider } from "./mockAudioProvider";

const imageProviders: Record<string, ImageProvider> = {
  mock: mockImageProvider,
};

const videoProviders: Record<string, VideoProvider> = {
  mock: mockVideoProvider,
};

const audioProviders: Record<string, AudioProvider> = {
  mock: mockAudioProvider,
};

export function getImageProvider(id: string = "mock"): ImageProvider {
  return imageProviders[id] || mockImageProvider;
}

export function getVideoProvider(id: string = "mock"): VideoProvider {
  return videoProviders[id] || mockVideoProvider;
}

export function getAudioProvider(id: string = "mock"): AudioProvider {
  return audioProviders[id] || mockAudioProvider;
}

export function listImageProviders(): ImageProvider[] {
  return Object.values(imageProviders);
}

export type {
  ImageProvider,
  ImageGenerationResult,
  VideoProvider,
  VideoGenerationResult,
  VideoGenerationOptions,
  AudioProvider,
  AudioGenerationResult,
  AudioGenerationOptions,
} from "./types";
