import { activeModelsFor, type GenerationCapability, type ModelProfile, type ProviderId, type RegisteredModel } from "./modelRegistry";

export type RouteDecision = { model?: RegisteredModel; explanation: string };

export function routeGeneration(
  capability: GenerationCapability,
  profile: ModelProfile,
  availableProviders: Set<ProviderId>,
  requiresStartFrame = false,
): RouteDecision {
  const byCapability = activeModelsFor(capability).filter((model) => Boolean(model.requiresStartFrame) === requiresStartFrame);
  const candidates = byCapability.filter((model) => availableProviders.has(model.provider));
  if (!candidates.length) {
    const anyModelExists = byCapability.length > 0;
    return {
      model: undefined,
      explanation: anyModelExists
        ? "No connected provider supports this yet. Add an API key in Settings."
        : requiresStartFrame
          ? "No connected provider supports image-conditioned generation for this capability yet."
          : "No provider adapter supports this capability yet.",
    };
  }
  const preferred = candidates.filter((model) => model.profiles.includes(profile));
  const selected = preferred[0] || candidates[0];
  return { model: selected, explanation: `Auto-routed to ${selected.label} (${selected.provider}).` };
}
