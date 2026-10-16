/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F17 — SlotRuntimeAdapter boundary & default disconnected runtime adapter.
 *
 * The actual mathematical slot runtime belongs to SECTION 2 — Backend Slot Game Engine.
 * When no SECTION 2 runtime engine is connected, this adapter deterministically
 * reports "Runtime Engine Not Connected" and never generates fake RNG or fake payouts.
 */

import {
  RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE,
  type RuntimeConnectionState,
  type RuntimeSpinRequest,
  type RuntimeSpinResponse,
  type SlotRuntimeAdapter,
} from "./types";

export class DisconnectedSlotRuntimeAdapter implements SlotRuntimeAdapter {
  public readonly id = "section1-disconnected-runtime";
  public readonly name = "Section 2 Slot Runtime (Disconnected)";
  public readonly connectionState: RuntimeConnectionState = "disconnected";

  public isConnected(): boolean {
    return false;
  }

  public getStatusMessage(): string {
    return RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE;
  }

  public async requestSpin(
    _request: RuntimeSpinRequest,
  ): Promise<RuntimeSpinResponse> {
    return {
      connected: false,
      statusMessage: RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE,
      timestamp: new Date().toISOString(),
      engineResult: null,
    };
  }
}

export function createDisconnectedRuntimeAdapter(): SlotRuntimeAdapter {
  return new DisconnectedSlotRuntimeAdapter();
}

export async function invokeRuntimeSpin(
  adapter: SlotRuntimeAdapter | null | undefined,
  request: RuntimeSpinRequest,
): Promise<RuntimeSpinResponse> {
  const activeAdapter = adapter ?? createDisconnectedRuntimeAdapter();
  if (!activeAdapter.isConnected()) {
    return {
      connected: false,
      statusMessage: RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE,
      timestamp: new Date().toISOString(),
      engineResult: null,
    };
  }
  return activeAdapter.requestSpin(request);
}
