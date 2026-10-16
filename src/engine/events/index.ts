/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Serializable Engine Event Model
 *
 * Events describe pure game domain transitions and outcomes.
 * They never carry UI components, CSS, or frontend animation instructions.
 */

export type EngineEventType =
  | "SPIN_STARTED"
  | "REELS_STOPPED"
  | "WIN_DETECTED"
  | "PAYOUT_AWARDED"
  | "FEATURE_TRIGGERED"
  | "FEATURE_STARTED"
  | "FEATURE_ENDED"
  | "ROUND_COMPLETE"
  | "SYMBOL_REMOVED"
  | "SYMBOL_INSERTED"
  | "CASCADE_STARTED"
  | "CASCADE_COMPLETE"
  | "BOARD_RESIZED"
  | "MULTIPLIER_CHANGED"
  | "LOCK_APPLIED"
  | "LOCK_RELEASED";

export interface EngineEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly sequence: number;
  readonly type: EngineEventType;
  readonly gameId: string;
  readonly roundId: string;
  readonly roundIndex: number;
  readonly payload: Readonly<TPayload>;
}

export class EngineEventBuffer {
  private readonly gameId: string;
  private readonly roundId: string;
  private readonly roundIndex: number;
  private sequence = 0;
  private readonly events: EngineEvent[] = [];

  constructor(gameId: string, roundId: string, roundIndex: number) {
    this.gameId = gameId;
    this.roundId = roundId;
    this.roundIndex = roundIndex;
  }

  public emit<TPayload extends Record<string, unknown>>(
    type: EngineEventType,
    payload: TPayload,
  ): EngineEvent<TPayload> {
    this.sequence += 1;
    const event: EngineEvent<TPayload> = Object.freeze({
      sequence: this.sequence,
      type,
      gameId: this.gameId,
      roundId: this.roundId,
      roundIndex: this.roundIndex,
      payload: Object.freeze({ ...payload }),
    });
    this.events.push(event);
    return event;
  }

  public getEvents(): readonly EngineEvent[] {
    return Object.freeze([...this.events]);
  }
}
