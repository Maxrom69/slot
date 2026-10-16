/**
 * Creation providers — the extension point for how a NewGameDraft is produced.
 *
 * Only "manual" exists. "agent" is a reserved slot for a future phase: it is
 * registered as unavailable and has NO implementation behind it. The studio
 * never requires a provider other than manual.
 */
export type CreationProviderId = "manual" | "agent";

export interface CreationProviderInfo {
  id: CreationProviderId;
  label: string;
  available: boolean;
  badge?: string;
}

export const CREATION_PROVIDERS: CreationProviderInfo[] = [
  { id: "manual", label: "Manual", available: true },
  { id: "agent", label: "Agent", available: false, badge: "Coming soon" },
];

export {
  type AICommand,
  type AICommandKind,
  type AICapabilityState,
  type AIProvider,
  type AIService,
  NOT_IMPLEMENTED_AI_STATE,
  RESERVED_AI_PROVIDER,
  NOOP_AI_SERVICE,
  getAIService,
} from "@/lib/ai/boundary";

