/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Engine Diagnostics & Structured Trace Abstraction
 *
 * Replaces scattered console.log calls with an optional, serializable,
 * zero-allocation-when-disabled diagnostics collector.
 */

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type SpinPipelineStageName =
  | "INITIALIZE"
  | "VALIDATE_REQUEST"
  | "ADVANCE_ROUND"
  | "RESOLVE_RNG"
  | "RESOLVE_REELS"
  | "BUILD_BOARD"
  | "EVALUATE_WINS"
  | "RESOLVE_FEATURES"
  | "APPLY_STATE"
  | "PRODUCE_RESULT";

export interface DiagnosticEntry {
  readonly sequence: number;
  readonly level: DiagnosticLevel;
  readonly stage: SpinPipelineStageName;
  readonly code: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DiagnosticsOptions {
  readonly enabled?: boolean;
  readonly minLevel?: DiagnosticLevel;
}

export interface EngineDiagnosticsSink {
  readonly enabled: boolean;
  record(
    level: DiagnosticLevel,
    stage: SpinPipelineStageName,
    code: string,
    message: string,
    data?: Record<string, string | number | boolean | null>,
  ): void;
  getEntries(): readonly DiagnosticEntry[];
  clear(): void;
}

const LEVEL_WEIGHT: Record<DiagnosticLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class EngineDiagnosticsCollector implements EngineDiagnosticsSink {
  public readonly enabled: boolean;
  private readonly minWeight: number;
  private entries: DiagnosticEntry[] = [];
  private sequence = 0;

  constructor(options: DiagnosticsOptions = {}) {
    this.enabled = Boolean(options.enabled);
    this.minWeight = LEVEL_WEIGHT[options.minLevel ?? "debug"];
  }

  public record(
    level: DiagnosticLevel,
    stage: SpinPipelineStageName,
    code: string,
    message: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    if (!this.enabled) return;
    if (LEVEL_WEIGHT[level] < this.minWeight) return;

    this.sequence += 1;
    const entry: DiagnosticEntry = Object.freeze({
      sequence: this.sequence,
      level,
      stage,
      code,
      message,
      ...(data ? { data: Object.freeze({ ...data }) } : {}),
    });
    this.entries.push(entry);
  }

  public getEntries(): readonly DiagnosticEntry[] {
    return Object.freeze([...this.entries]);
  }

  public clear(): void {
    this.entries = [];
    this.sequence = 0;
  }
}

export function createDiagnosticsCollector(
  options?: DiagnosticsOptions,
): EngineDiagnosticsSink {
  return new EngineDiagnosticsCollector(options);
}
