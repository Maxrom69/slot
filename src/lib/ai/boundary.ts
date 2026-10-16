/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * Future AI extension boundary (interfaces & inert capability state only).
 *
 * No AI generation, LLM APIs, agents, or simulated workflows exist in SECTION 1.
 * Any reference to this boundary returns a deterministic `not_implemented` state.
 */

export type AICommandKind =
  | "generate_concept"
  | "generate_symbol_art"
  | "generate_variations"
  | "suggest_palette"
  | "custom";

export interface AICommand {
  id: string;
  kind: AICommandKind;
  targetId?: string;
  params?: Record<string, unknown>;
}

export interface AICapabilityState {
  implemented: false;
  available: false;
  status: "not_implemented";
  reason: string;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly available: false;
  getCapabilityState(): AICapabilityState;
}

export interface AIService {
  readonly available: false;
  getCapabilityState(): AICapabilityState;
  listProviders(): readonly AIProvider[];
  execute(command: AICommand): Promise<AICapabilityState>;
}

export const NOT_IMPLEMENTED_AI_STATE: AICapabilityState = Object.freeze({
  implemented: false,
  available: false,
  status: "not_implemented",
  reason:
    "AI integration is not implemented in SECTION 1. The Slot Studio Builder is fully manual and deterministic.",
});

export const RESERVED_AI_PROVIDER: AIProvider = Object.freeze({
  id: "reserved-section3-provider",
  name: "Reserved AI Provider (Not Implemented)",
  available: false,
  getCapabilityState() {
    return NOT_IMPLEMENTED_AI_STATE;
  },
});

export const NOOP_AI_SERVICE: AIService = Object.freeze({
  available: false,
  getCapabilityState() {
    return NOT_IMPLEMENTED_AI_STATE;
  },
  listProviders() {
    return [RESERVED_AI_PROVIDER];
  },
  async execute(_command: AICommand): Promise<AICapabilityState> {
    return NOT_IMPLEMENTED_AI_STATE;
  },
});

export function getAIService(): AIService {
  return NOOP_AI_SERVICE;
}
