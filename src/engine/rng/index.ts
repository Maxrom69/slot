/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B03 — Deterministic, Testable RNG Subsystem
 *
 * Implements the explicit RandomSource / DeterministicGameRng abstraction,
 * seed normalization, domain-separated substream derivation (fork),
 * unbiased rejection-sampled bounded integer generation, weighted selection,
 * state snapshot/restoration, optional diagnostic audit trails, and
 * versioned algorithm routing for deterministic replay.
 *
 * SECURITY & DETERMINISM NOTE:
 * This module provides deterministic pseudorandom number generation (PRNG)
 * for gameplay execution, batch simulation, verification, and replay.
 * It is NOT a cryptographically secure RNG (CSPRNG). Never use Math.random(),
 * Date.now(), performance.now(), or global mutable singletons here.
 */

import {
  EmptySelectionError,
  InvalidProbabilityError,
  InvalidRangeError,
  InvalidRngStateError,
  InvalidSeedError,
  InvalidWeightError,
  UnsupportedRngAlgorithmError,
  ZeroTotalWeightError,
} from "../errors";

/* -------------------------------------------------------------------------- */
/* ALGORITHM VERSIONING & IDENTIFIERS                                         */
/* -------------------------------------------------------------------------- */

export type RngAlgorithmName = "mulberry32" | "sfc32";
export type RngAlgorithmId = "mulberry32-v1" | "sfc32-v1";

export const DEFAULT_RNG_ALGORITHM: RngAlgorithmName = "mulberry32";
export const DEFAULT_RNG_ALGORITHM_VERSION = 1 as const;
export const DEFAULT_RNG_ALGORITHM_ID: RngAlgorithmId = "mulberry32-v1";

export const SUPPORTED_RNG_ALGORITHMS: Readonly<
  Record<
    RngAlgorithmId,
    {
      readonly id: RngAlgorithmId;
      readonly name: RngAlgorithmName;
      readonly version: number;
      readonly stateWordCount: 1 | 4;
      readonly description: string;
    }
  >
> = Object.freeze({
  "mulberry32-v1": Object.freeze({
    id: "mulberry32-v1",
    name: "mulberry32",
    version: 1,
    stateWordCount: 1,
    description:
      "32-bit Weyl-sequence PRNG (Tommy Ettinger) with 32-bit integer avalanche mixing.",
  }),
  "sfc32-v1": Object.freeze({
    id: "sfc32-v1",
    name: "sfc32",
    version: 1,
    stateWordCount: 4,
    description:
      "128-bit Small Fast Counting PRNG (Chris Doty-Humphrey, PractRand) with 3x32-bit state + 32-bit counter.",
  }),
});

const UINT32_SPAN = 0x100000000; // 4,294,967,296 (2^32)

/* -------------------------------------------------------------------------- */
/* SEED REPRESENTATION & NORMALIZATION                                        */
/* -------------------------------------------------------------------------- */

export interface CanonicalSeed {
  readonly canonical: string;
  readonly rawInputType: "string" | "number" | "bytes";
  readonly originalValue: string;
  readonly primaryUint32: number;
  readonly seedWords: readonly [number, number, number, number];
}

function copyCanonicalSeed(seed: CanonicalSeed): CanonicalSeed {
  return Object.freeze({ ...seed, seedWords: Object.freeze([...seed.seedWords]) as readonly [number, number, number, number] });
}
function validateSnapshotSeed(seed: CanonicalSeed): CanonicalSeed {
  if (!seed || typeof seed.canonical !== "string" || !seed.canonical.trim() || typeof seed.originalValue !== "string" || !seed.originalValue.trim() || !["string", "number", "bytes"].includes(seed.rawInputType) || !Number.isInteger(seed.primaryUint32) || seed.primaryUint32 < 0 || seed.primaryUint32 > 0xffffffff || !Array.isArray(seed.seedWords) || seed.seedWords.length !== 4 || seed.seedWords.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffffffff)) throw new InvalidRngStateError("Malformed RNG canonical seed identity.");
  return copyCanonicalSeed(seed);
}

export type SeedInput =
  | string
  | number
  | Uint8Array
  | readonly number[]
  | CanonicalSeed;

function isCanonicalSeed(value: unknown): value is CanonicalSeed {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanonicalSeed>;
  return (
    typeof candidate.canonical === "string" &&
    typeof candidate.originalValue === "string" &&
    typeof candidate.primaryUint32 === "number" &&
    Array.isArray(candidate.seedWords) &&
    candidate.seedWords.length === 4
  );
}

/**
 * Finalizer mix (MurmurHash3 32-bit fmix32) for deterministic avalanche.
 */
function fmix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Deterministic FNV-1a 32-bit hash for string/seed payloads.
 * Returns a guaranteed non-zero uint32.
 */
function fnv1aUint32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0 || 0x6d2b79f5;
}

/**
 * Deterministic 128-bit (4 x uint32) seed word expansion (cyrb128-inspired)
 * from a canonical seed string.
 */
function deriveFourUint32Words(canonicalText: string): readonly [
  number,
  number,
  number,
  number,
] {
  let h1 = 0x6a09e667;
  let h2 = 0xbb67ae85;
  let h3 = 0x3c6ef372;
  let h4 = 0xa54ff53a;

  for (let i = 0; i < canonicalText.length; i += 1) {
    const k = canonicalText.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 0x239b961b);
    h2 = h3 ^ Math.imul(h2 ^ k, 0xab0e9789);
    h3 = h4 ^ Math.imul(h3 ^ k, 0x38b34ae5);
    h4 = h1 ^ Math.imul(h4 ^ k, 0xa1e38b93);
  }

  const len = canonicalText.length;
  h1 = fmix32(h1 ^ len);
  h2 = fmix32(h2 ^ len);
  h3 = fmix32(h3 ^ len);
  h4 = fmix32(h4 ^ len);

  const w0 = (h1 + h2 + h3 + h4) >>> 0 || 0x6d2b79f5;
  const w1 = (h2 + h1) >>> 0 || 0x9e3779b9;
  const w2 = (h3 + h1) >>> 0 || 0x7f4a7c15;
  const w3 = (h4 + h1) >>> 0 || 0x1;

  return Object.freeze([w0, w1, w2, w3] as const);
}

/**
 * Deterministically normalizes any valid SeedInput into a CanonicalSeed.
 * Rejects null, undefined, empty/whitespace strings, NaN, Infinity, or empty byte arrays.
 */
export function normalizeSeed(input: SeedInput): CanonicalSeed {
  if (input === null || input === undefined) {
    throw new InvalidSeedError("RNG seed must not be null or undefined.", {
      seed: input,
    });
  }

  if (isCanonicalSeed(input)) {
    if (!input.canonical || input.canonical.trim().length === 0) {
      throw new InvalidSeedError("CanonicalSeed must not be empty.", {
        seed: input,
      });
    }
    return input;
  }

  if (typeof input === "string") {
    if (input.trim().length === 0) {
      throw new InvalidSeedError(
        "RNG string seed must be a non-empty, non-whitespace string.",
        { seed: input },
      );
    }
    const primaryUint32 = fnv1aUint32(input);
    const seedWords = deriveFourUint32Words(`str:${input}`);
    return Object.freeze({
      canonical: `str:${input}`,
      rawInputType: "string",
      originalValue: input,
      primaryUint32,
      seedWords,
    });
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new InvalidSeedError(
        `RNG numeric seed must be a finite number, received ${String(input)}.`,
        { seed: input },
      );
    }
    // Normalize -0 to "0"
    const numStr = Object.is(input, -0) ? "0" : String(input);
    const primaryUint32 = fnv1aUint32(numStr);
    const seedWords = deriveFourUint32Words(`num:${numStr}`);
    return Object.freeze({
      canonical: `num:${numStr}`,
      rawInputType: "number",
      originalValue: numStr,
      primaryUint32,
      seedWords,
    });
  }

  if (input instanceof Uint8Array || Array.isArray(input)) {
    if (input.length === 0) {
      throw new InvalidSeedError(
        "RNG byte/word array seed must contain at least one element.",
        { length: 0 },
      );
    }
    const hexParts: string[] = [];
    for (let i = 0; i < input.length; i += 1) {
      const val = input[i];
      if (typeof val !== "number" || !Number.isFinite(val) || !Number.isInteger(val)) {
        throw new InvalidSeedError(
          `RNG array seed element at index ${i} must be a finite integer.`,
          { index: i, value: val },
        );
      }
      const u32 = val >>> 0;
      hexParts.push(u32.toString(16).padStart(8, "0"));
    }
    const joined = hexParts.join(":");
    const canonical = `bytes:${joined}`;
    const primaryUint32 = fnv1aUint32(canonical);
    const seedWords = deriveFourUint32Words(canonical);
    return Object.freeze({
      canonical,
      rawInputType: "bytes",
      originalValue: canonical,
      primaryUint32,
      seedWords,
    });
  }

  throw new InvalidSeedError("Unsupported RNG seed input type.", {
    seedType: typeof input,
  });
}

/**
 * Deterministic 32-bit FNV-1a hash helper (preserved for B01 compatibility).
 */
export function hashSeedToUint32(seed: SeedInput): number {
  return normalizeSeed(seed).primaryUint32;
}

/**
 * Domain-separated deterministic seed derivation for substreams.
 * Given a root/parent seed and a namespace (e.g. "reels", "features", "bonuses"),
 * derives an independent CanonicalSeed without consuming parent PRNG draws.
 */
export function deriveSeed(
  rootSeed: SeedInput,
  namespace: string,
): CanonicalSeed {
  const base = normalizeSeed(rootSeed);
  if (typeof namespace !== "string" || namespace.trim().length === 0) {
    throw new InvalidSeedError(
      "Substream namespace must be a non-empty string.",
      { namespace },
    );
  }
  const cleanNamespace = namespace.trim();
  const domainString = `${base.canonical}::stream[${cleanNamespace}]`;
  const primaryUint32 = fmix32(fnv1aUint32(domainString));
  const seedWords = deriveFourUint32Words(domainString);
  return Object.freeze({
    canonical: domainString,
    rawInputType: "string",
    originalValue: `${base.originalValue}::${cleanNamespace}`,
    primaryUint32: primaryUint32 || 0x6d2b79f5,
    seedWords,
  });
}

/* -------------------------------------------------------------------------- */
/* INTERFACES & CONTRACTS                                                     */
/* -------------------------------------------------------------------------- */

export interface WeightedItem<T> {
  readonly value: T;
  readonly weight: number;
}

export interface SeedState {
  readonly algorithm: string;
  readonly originalSeed: string;
  readonly internalState: number;
  readonly callCount: number;
}

export interface RngStateSnapshot extends SeedState {
  readonly algorithm: RngAlgorithmId;
  readonly algorithmName: RngAlgorithmName;
  readonly algorithmVersion: number;
  readonly originalSeed: string;
  readonly canonicalSeed: string;
  /** B16 replay repair: preserve active and root identities, including fork ancestry. */
  readonly seedIdentity?: { readonly active: CanonicalSeed; readonly root: CanonicalSeed };
  readonly streamNamespace: string;
  readonly internalState: number;
  readonly stateWords: readonly number[];
  readonly callCount: number;
  readonly drawCount: number;
}

export type RngAuditOperation =
  | "nextUint32"
  | "nextFloat"
  | "nextInt"
  | "nextBoolean"
  | "pick"
  | "weightedPick"
  | "fork"
  | "restore";

export interface RngAuditRecord {
  readonly streamNamespace: string;
  readonly operation: RngAuditOperation;
  readonly drawIndexBefore: number;
  readonly drawIndexAfter: number;
  readonly request?: Readonly<Record<string, unknown>>;
  readonly result: number | boolean | string;
}

/**
 * Core RandomSource interface consumed by all gameplay and simulation systems.
 */
export interface RandomSource {
  readonly algorithm: string;
  readonly algorithmName: RngAlgorithmName;
  readonly algorithmVersion: number;
  readonly streamNamespace: string;

  /** Generates a uniform unsigned 32-bit integer in [0, 4294967295]. */
  nextUint32(): number;

  /** Generates a uniform floating-point number in [0, 1). */
  nextFloat(): number;

  /**
   * Generates an unbiased integer in:
   * - [0, maxExclusive) when called as nextInt(maxExclusive)
   * - [minInclusive, maxExclusive) when called as nextInt(minInclusive, maxExclusive)
   */
  nextInt(maxExclusive: number): number;
  nextInt(minInclusive: number, maxExclusive: number): number;

  /**
   * Generates a boolean with optional probability in [0, 1] (default 0.5).
   * probability = 0 always returns false; probability = 1 always returns true.
   */
  nextBoolean(probability?: number): boolean;

  /** Selects a uniform random item from a non-empty readonly array without mutating it. */
  pick<T>(items: readonly T[]): T;

  /**
   * Selects an item proportionally to its relative finite non-negative weight.
   * Zero-weight items are never selected.
   */
  weightedPick<T>(items: readonly WeightedItem<T>[]): T;

  /**
   * Creates an independent, deterministic child RNG stream for `namespace`
   * derived from the root seed and stream path without advancing parent state.
   */
  fork(namespace: string): DeterministicGameRng;

  /** Captures a serializable snapshot of the current RNG state and draw count. */
  snapshot(): RngStateSnapshot;

  /** Restores the RNG to a previously captured serializable snapshot. */
  restore(snapshot: RngStateSnapshot | SeedState): void;

  /** Returns the total number of primitive uint32 draws consumed by this stream. */
  getDrawCount(): number;

  /** B01 compatibility alias for snapshot(). */
  getState(): RngStateSnapshot;

  /** Clones this RNG stream at its exact current state and draw count. */
  clone(): DeterministicGameRng;
}

/**
 * Extended interface for deterministic gameplay RNG with audit trail and
 * B01 reel/weight index helpers.
 */
export interface DeterministicGameRng extends RandomSource {
  selectReelStopIndex(reelIndex: number, stopCount: number): number;
  selectWeightedIndex(
    cumulativeWeights: readonly number[],
    totalWeight: number,
  ): number;
  getAuditTrail(): readonly RngAuditRecord[];
  clearAuditTrail(): void;
}

/** Alias preserved for B01 compatibility. */
export type RandomNumberGenerator = DeterministicGameRng;

/**
 * Explicit boundary marker for non-gameplay cryptographic randomness if ever
 * required by external security/session tokens. Never mixed with DeterministicGameRng.
 */
export interface SecureRandomSource {
  readonly isCryptographic: true;
  randomBytes(byteLength: number): Uint8Array;
}

export interface RngConfig {
  readonly seed: SeedInput;
  readonly algorithm?: RngAlgorithmName | RngAlgorithmId;
  readonly algorithmVersion?: number;
  readonly streamNamespace?: string;
  readonly recordAudit?: boolean;
  readonly initialState?: RngStateSnapshot | SeedState;
}

export interface ReplayRngInput {
  readonly seed: SeedInput;
  readonly rngAlgorithm?: RngAlgorithmName | RngAlgorithmId | string;
  readonly algorithmVersion?: number;
  readonly streamNamespace?: string;
  readonly stateSnapshot?: RngStateSnapshot | SeedState;
  readonly recordAudit?: boolean;
}

export interface RngFactory {
  createFromSeed(
    seed: SeedInput,
    options?: Omit<RngConfig, "seed">,
  ): DeterministicGameRng;
  restoreFromState(state: RngStateSnapshot | SeedState): DeterministicGameRng;
}

/* -------------------------------------------------------------------------- */
/* ALGORITHM RESOLUTION                                                       */
/* -------------------------------------------------------------------------- */

export function resolveRngAlgorithmId(
  algorithm: string | undefined = DEFAULT_RNG_ALGORITHM,
  version: number | undefined = DEFAULT_RNG_ALGORITHM_VERSION,
): RngAlgorithmId {
  const raw = String(algorithm).trim();
  if (raw === "mulberry32-v1" && (version === undefined || version === 1)) {
    return "mulberry32-v1";
  }
  if (raw === "sfc32-v1" && (version === undefined || version === 1)) {
    return "sfc32-v1";
  }
  if (raw === "mulberry32" && version === 1) {
    return "mulberry32-v1";
  }
  if (raw === "sfc32" && version === 1) {
    return "sfc32-v1";
  }
  throw new UnsupportedRngAlgorithmError(
    `Unsupported RNG algorithm "${String(algorithm)}" (version: ${String(version)}). Supported: mulberry32-v1, sfc32-v1.`,
    { algorithm, version },
  );
}

/* -------------------------------------------------------------------------- */
/* SEEDED RNG IMPLEMENTATION                                                  */
/* -------------------------------------------------------------------------- */

export class SeededRNG implements DeterministicGameRng {
  public readonly algorithm: RngAlgorithmId;
  public readonly algorithmName: RngAlgorithmName;
  public readonly algorithmVersion: number;
  public readonly streamNamespace: string;

  private rootCanonicalSeed: CanonicalSeed;
  private activeCanonicalSeed: CanonicalSeed;
  private originalSeed: string;
  private state0: number;
  private state1: number;
  private state2: number;
  private state3: number;
  private draws: number;
  private readonly recordAudit: boolean;
  private readonly auditTrail: RngAuditRecord[] = [];
  private suppressInternalAudit = false;

  constructor(
    seed: SeedInput,
    options?: {
      readonly internalState?: number;
      readonly stateWords?: readonly number[];
      readonly callCount?: number;
      readonly drawCount?: number;
      readonly algorithm?: RngAlgorithmName | RngAlgorithmId | string;
      readonly algorithmVersion?: number;
      readonly streamNamespace?: string;
      readonly rootSeed?: CanonicalSeed;
      readonly recordAudit?: boolean;
    },
  ) {
    const resolvedAlgId = resolveRngAlgorithmId(
      options?.algorithm,
      options?.algorithmVersion,
    );
    const algSpec = SUPPORTED_RNG_ALGORITHMS[resolvedAlgId];

    this.algorithm = resolvedAlgId;
    this.algorithmName = algSpec.name;
    this.algorithmVersion = algSpec.version;
    this.recordAudit = Boolean(options?.recordAudit);

    const streamNamespace = options?.streamNamespace?.trim() || "root";
    this.streamNamespace = streamNamespace;

    const normalized = normalizeSeed(seed);
    this.rootCanonicalSeed = options?.rootSeed ?? normalized;
    this.activeCanonicalSeed = normalized;
    this.originalSeed = normalized.originalValue;

    if (
      options?.internalState !== undefined ||
      options?.stateWords !== undefined
    ) {
      const count = options.drawCount ?? options.callCount ?? 0;
      if (!Number.isInteger(count) || count < 0) {
        throw new InvalidRngStateError(
          `RNG drawCount/callCount must be a non-negative integer, received ${String(count)}.`,
          { drawCount: count },
        );
      }
      this.draws = count;

      if (this.algorithm === "sfc32-v1") {
        const words = options.stateWords;
        if (!Array.isArray(words) || words.length !== 4) {
          throw new InvalidRngStateError(
            "sfc32-v1 requires 4 uint32 stateWords for restoration.",
            { stateWords: words },
          );
        }
        this.state0 = words[0] >>> 0;
        this.state1 = words[1] >>> 0;
        this.state2 = words[2] >>> 0;
        this.state3 = words[3] >>> 0;
      } else {
        const primary =
          options.internalState !== undefined
            ? options.internalState
            : options.stateWords?.[0];
        if (typeof primary !== "number" || !Number.isFinite(primary)) {
          throw new InvalidRngStateError(
            "mulberry32-v1 requires a finite numeric internalState.",
            { internalState: primary },
          );
        }
        this.state0 = primary >>> 0;
        this.state1 = 0;
        this.state2 = 0;
        this.state3 = 0;
      }
    } else {
      this.draws = 0;
      if (this.algorithm === "sfc32-v1") {
        this.state0 = normalized.seedWords[0] >>> 0;
        this.state1 = normalized.seedWords[1] >>> 0;
        this.state2 = normalized.seedWords[2] >>> 0;
        this.state3 = normalized.seedWords[3] >>> 0;
      } else {
        this.state0 = normalized.primaryUint32 >>> 0;
        this.state1 = 0;
        this.state2 = 0;
        this.state3 = 0;
      }
    }
  }

  private drawRawUint32(): number {
    this.draws += 1;
    if (this.algorithm === "sfc32-v1") {
      const a = this.state0 >>> 0;
      const b = this.state1 >>> 0;
      const c = this.state2 >>> 0;
      const d = (this.state3 + 1) >>> 0;
      this.state3 = d;
      const t = (a + b + d) >>> 0;
      this.state0 = (b ^ (b >>> 9)) >>> 0;
      this.state1 = (c + (c << 3)) >>> 0;
      this.state2 = (((c << 21) | (c >>> 11)) + t) >>> 0;
      return t >>> 0;
    }

    // Default: mulberry32-v1
    let t = (this.state0 = (this.state0 + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  public nextUint32(): number {
    const before = this.draws;
    const value = this.drawRawUint32();
    if (this.recordAudit && !this.suppressInternalAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "nextUint32",
          drawIndexBefore: before,
          drawIndexAfter: this.draws,
          result: value,
        }),
      );
    }
    return value;
  }

  public nextFloat(): number {
    const before = this.draws;
    const value = this.drawRawUint32() / UINT32_SPAN;
    if (this.recordAudit && !this.suppressInternalAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "nextFloat",
          drawIndexBefore: before,
          drawIndexAfter: this.draws,
          result: value,
        }),
      );
    }
    return value;
  }

  public nextInt(maxExclusive: number): number;
  public nextInt(minInclusive: number, maxExclusive: number): number;
  public nextInt(arg1: number, arg2?: number): number {
    let minInclusive: number;
    let maxExclusive: number;

    if (arg2 === undefined) {
      minInclusive = 0;
      maxExclusive = arg1;
      if (
        typeof maxExclusive !== "number" ||
        !Number.isSafeInteger(maxExclusive) ||
        maxExclusive <= 0 ||
        maxExclusive > UINT32_SPAN
      ) {
        throw new InvalidRangeError(
          `nextInt(maxExclusive) requires a safe integer in [1, 4294967296], received ${String(maxExclusive)}.`,
          { minInclusive: 0, maxExclusive },
        );
      }
    } else {
      minInclusive = arg1;
      maxExclusive = arg2;
      if (
        typeof minInclusive !== "number" ||
        typeof maxExclusive !== "number" ||
        !Number.isSafeInteger(minInclusive) ||
        !Number.isSafeInteger(maxExclusive) ||
        maxExclusive <= minInclusive
      ) {
        throw new InvalidRangeError(
          `nextInt(min, max) requires safe integers with min < max, received [${String(minInclusive)}, ${String(maxExclusive)}).`,
          { minInclusive, maxExclusive },
        );
      }
    }

    const range = maxExclusive - minInclusive;
    if (range > UINT32_SPAN) {
      throw new InvalidRangeError(
        `nextInt(min, max) range (${range}) exceeds maximum 32-bit unbiased span (${UINT32_SPAN}).`,
        { minInclusive, maxExclusive, range },
      );
    }

    const before = this.draws;
    let result: number;

    if (range === UINT32_SPAN) {
      result = minInclusive + this.drawRawUint32();
    } else {
      // Unbiased rejection sampling over 2^32:
      // threshold = 2^32 - (2^32 % range) is the largest multiple of `range` <= 2^32.
      // Any sample r < threshold maps uniformly onto [0, range - 1] via r % range.
      const remainder = UINT32_SPAN % range;
      const threshold = UINT32_SPAN - remainder;
      let r = this.drawRawUint32();
      while (r >= threshold) {
        r = this.drawRawUint32();
      }
      result = minInclusive + (r % range);
    }

    if (this.recordAudit && !this.suppressInternalAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "nextInt",
          drawIndexBefore: before,
          drawIndexAfter: this.draws,
          request: Object.freeze({ minInclusive, maxExclusive }),
          result,
        }),
      );
    }

    return result;
  }

  public nextBoolean(probability = 0.5): boolean {
    if (
      typeof probability !== "number" ||
      Number.isNaN(probability) ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new InvalidProbabilityError(
        `nextBoolean(probability) requires a finite number in [0, 1], received ${String(probability)}.`,
        { probability },
      );
    }

    const before = this.draws;
    const draw = this.drawRawUint32() / UINT32_SPAN;
    const result =
      probability === 0 ? false : probability === 1 ? true : draw < probability;

    if (this.recordAudit && !this.suppressInternalAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "nextBoolean",
          drawIndexBefore: before,
          drawIndexAfter: this.draws,
          request: Object.freeze({ probability }),
          result,
        }),
      );
    }

    return result;
  }

  public pick<T>(items: readonly T[]): T {
    if (!Array.isArray(items) || items.length === 0) {
      throw new EmptySelectionError(
        "pick(items) requires a non-empty array.",
        { length: Array.isArray(items) ? items.length : null },
      );
    }

    const before = this.draws;
    this.suppressInternalAudit = true;
    let index: number;
    try {
      index = this.nextInt(0, items.length);
    } finally {
      this.suppressInternalAudit = false;
    }
    const chosen = items[index];

    if (this.recordAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "pick",
          drawIndexBefore: before,
          drawIndexAfter: this.draws,
          request: Object.freeze({ itemCount: items.length }),
          result: index,
        }),
      );
    }

    return chosen;
  }

  public weightedPick<T>(items: readonly WeightedItem<T>[]): T {
    if (!Array.isArray(items) || items.length === 0) {
      throw new EmptySelectionError(
        "weightedPick(items) requires a non-empty array of weighted items.",
        { length: Array.isArray(items) ? items.length : null },
      );
    }

    let totalWeight = 0;
    let lastPositiveIndex = -1;

    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i];
      if (!entry || typeof entry !== "object") {
        throw new InvalidWeightError(
          `Weighted item at index ${i} must be an object with { value, weight }.`,
          { index: i },
        );
      }
      const w = entry.weight;
      if (typeof w !== "number" || Number.isNaN(w) || !Number.isFinite(w)) {
        throw new InvalidWeightError(
          `Weighted item at index ${i} has non-finite weight ${String(w)}.`,
          { index: i, weight: w },
        );
      }
      if (w < 0) {
        throw new InvalidWeightError(
          `Weighted item at index ${i} has negative weight ${w}.`,
          { index: i, weight: w },
        );
      }
      if (w > 0) {
        totalWeight += w;
        if (!Number.isFinite(totalWeight)) {
          throw new InvalidWeightError(
            "Cumulative total weight overflowed to Infinity.",
            { index: i, weight: w },
          );
        }
        lastPositiveIndex = i;
      }
    }

    if (totalWeight <= 0 || lastPositiveIndex === -1) {
      throw new ZeroTotalWeightError(
        "weightedPick(items) requires a total weight strictly greater than zero.",
        { totalWeight, itemCount: items.length },
      );
    }

    const before = this.draws;
    let chosenIndex = lastPositiveIndex;

    // Monotonic cumulative-weight selection:
    // u in [0, 1) scaled by totalWeight preserves exact relative weight invariance
    // (e.g., [1, 2, 7] and [10, 20, 70] map identically for every draw), while
    // skipping zero-weight entries and clamping any upper-boundary float rounding
    // to lastPositiveIndex so a trailing zero-weight item can never be selected.
    const target = (this.drawRawUint32() / UINT32_SPAN) * totalWeight;
    let cumulative = 0;
    for (let i = 0; i < items.length; i += 1) {
      const w = items[i].weight;
      if (w <= 0) continue;
      cumulative += w;
      if (target < cumulative) {
        chosenIndex = i;
        break;
      }
    }

    if (this.recordAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "weightedPick",
          drawIndexBefore: before,
          drawIndexAfter: this.draws,
          request: Object.freeze({
            itemCount: items.length,
            totalWeight,
          }),
          result: chosenIndex,
        }),
      );
    }

    return items[chosenIndex].value;
  }

  public selectReelStopIndex(_reelIndex: number, stopCount: number): number {
    return this.nextInt(0, stopCount);
  }

  public selectWeightedIndex(
    cumulativeWeights: readonly number[],
    totalWeight: number,
  ): number {
    if (!Array.isArray(cumulativeWeights) || cumulativeWeights.length === 0) {
      throw new EmptySelectionError(
        "selectWeightedIndex requires a non-empty cumulativeWeights array.",
        { length: 0 },
      );
    }
    if (
      typeof totalWeight !== "number" ||
      Number.isNaN(totalWeight) ||
      !Number.isFinite(totalWeight)
    ) {
      throw new InvalidWeightError(
        `selectWeightedIndex requires a finite totalWeight, received ${String(totalWeight)}.`,
        { totalWeight },
      );
    }
    if (totalWeight <= 0) {
      throw new ZeroTotalWeightError(
        `selectWeightedIndex requires totalWeight > 0, received ${totalWeight}.`,
        { totalWeight },
      );
    }

    const items: WeightedItem<number>[] = [];
    let prev = 0;
    for (let i = 0; i < cumulativeWeights.length; i += 1) {
      const curr = cumulativeWeights[i];
      if (typeof curr !== "number" || !Number.isFinite(curr) || curr < prev) {
        throw new InvalidWeightError(
          `Invalid cumulative weight at index ${i}: ${String(curr)}.`,
          { index: i, cumulativeWeight: curr, previous: prev },
        );
      }
      items.push({ value: i, weight: curr - prev });
      prev = curr;
    }
    return this.weightedPick(items);
  }

  public fork(namespace: string): SeededRNG {
    if (typeof namespace !== "string" || namespace.trim().length === 0) {
      throw new InvalidSeedError(
        "fork(namespace) requires a non-empty string namespace.",
        { namespace },
      );
    }
    const clean = namespace.trim();
    const childNamespace = `${this.streamNamespace}/${clean}`;
    const childSeed = deriveSeed(this.rootCanonicalSeed, childNamespace);

    if (this.recordAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "fork",
          drawIndexBefore: this.draws,
          drawIndexAfter: this.draws,
          request: Object.freeze({ namespace: clean }),
          result: childNamespace,
        }),
      );
    }

    return new SeededRNG(childSeed, {
      algorithm: this.algorithm,
      algorithmVersion: this.algorithmVersion,
      streamNamespace: childNamespace,
      rootSeed: this.rootCanonicalSeed,
      recordAudit: this.recordAudit,
    });
  }

  public snapshot(): RngStateSnapshot {
    const stateWords =
      this.algorithm === "sfc32-v1"
        ? Object.freeze([
            this.state0 >>> 0,
            this.state1 >>> 0,
            this.state2 >>> 0,
            this.state3 >>> 0,
          ])
        : Object.freeze([this.state0 >>> 0]);

    return Object.freeze({
      algorithm: this.algorithm,
      algorithmName: this.algorithmName,
      algorithmVersion: this.algorithmVersion,
      originalSeed: this.originalSeed,
      canonicalSeed: this.activeCanonicalSeed.canonical,
      seedIdentity: Object.freeze({ active: copyCanonicalSeed(this.activeCanonicalSeed), root: copyCanonicalSeed(this.rootCanonicalSeed) }),
      streamNamespace: this.streamNamespace,
      internalState: this.state0 >>> 0,
      stateWords,
      callCount: this.draws,
      drawCount: this.draws,
    });
  }

  public getState(): RngStateSnapshot {
    return this.snapshot();
  }

  public restore(snapshot: RngStateSnapshot | SeedState): void {
    if (!snapshot || typeof snapshot !== "object") {
      throw new InvalidRngStateError(
        "restore(snapshot) requires a non-null RNG state snapshot object.",
        { snapshot },
      );
    }

    const snap = snapshot as Partial<RngStateSnapshot>;
    const resolvedAlg = resolveRngAlgorithmId(
      snap.algorithm,
      snap.algorithmVersion,
    );
    if (resolvedAlg !== this.algorithm) {
      throw new InvalidRngStateError(
        `Cannot restore snapshot for algorithm "${resolvedAlg}" into RNG configured for "${this.algorithm}".`,
        { expectedAlgorithm: this.algorithm, snapshotAlgorithm: resolvedAlg },
      );
    }

    if (
      typeof snap.originalSeed !== "string" ||
      snap.originalSeed.trim().length === 0
    ) {
      throw new InvalidRngStateError(
        "RNG state snapshot must include a non-empty originalSeed string.",
        { originalSeed: snap.originalSeed },
      );
    }

    if (snap.streamNamespace !== undefined && snap.streamNamespace !== this.streamNamespace) throw new InvalidRngStateError("RNG snapshot stream namespace does not match the destination stream.");
    const identity = snap.seedIdentity;
    let active: CanonicalSeed, root: CanonicalSeed;
    if (identity) {
      active = validateSnapshotSeed(identity.active); root = validateSnapshotSeed(identity.root);
      if (active.canonical !== snap.canonicalSeed || active.originalValue !== snap.originalSeed) throw new InvalidRngStateError("RNG seed identity does not match its snapshot metadata.");
      const expected = active.canonical === root.canonical ? root : deriveSeed(root, snap.streamNamespace ?? this.streamNamespace);
      if (active.canonical !== expected.canonical || active.originalValue !== expected.originalValue || active.primaryUint32 !== expected.primaryUint32 || active.seedWords.join(":") !== expected.seedWords.join(":")) throw new InvalidRngStateError("RNG active seed identity does not follow its recorded root lineage.");
    } else {
      // Legacy root snapshots predate the optional lineage record.
      if (snap.canonicalSeed?.startsWith("num:") && !snap.canonicalSeed.includes("::stream[")) active = normalizeSeed(Number(snap.originalSeed));
      else if (snap.canonicalSeed?.startsWith("bytes:") && !snap.canonicalSeed.includes("::stream[")) active = normalizeSeed(snap.canonicalSeed.slice(6).split(":").map((word) => parseInt(word, 16)));
      else active = normalizeSeed(snap.originalSeed);
      root = active;
      if (snap.canonicalSeed !== undefined && active.canonical !== snap.canonicalSeed) throw new InvalidRngStateError("Legacy fork/custom seed snapshot lacks recoverable seed lineage; restore a snapshot containing seedIdentity.");
    }
    const drawCount = snap.drawCount ?? snap.callCount;
    if (
      typeof drawCount !== "number" ||
      !Number.isInteger(drawCount) ||
      drawCount < 0
    ) {
      throw new InvalidRngStateError(
        `RNG state snapshot must include a non-negative integer drawCount/callCount, received ${String(drawCount)}.`,
        { drawCount },
      );
    }

    if (this.algorithm === "sfc32-v1") {
      if (
        !Array.isArray(snap.stateWords) ||
        snap.stateWords.length !== 4 ||
        snap.stateWords.some(
          (w) => typeof w !== "number" || !Number.isInteger(w) || w < 0 || w > 0xffffffff,
        )
      ) {
        throw new InvalidRngStateError(
          "sfc32-v1 snapshot requires 4 valid uint32 stateWords.",
          { stateWords: snap.stateWords },
        );
      }
      this.state0 = snap.stateWords[0] >>> 0;
      this.state1 = snap.stateWords[1] >>> 0;
      this.state2 = snap.stateWords[2] >>> 0;
      this.state3 = snap.stateWords[3] >>> 0;
    } else {
      const word =
        snap.internalState !== undefined
          ? snap.internalState
          : snap.stateWords?.[0];
      if (
        typeof word !== "number" ||
        !Number.isInteger(word) ||
        word < 0 ||
        word > 0xffffffff
      ) {
        throw new InvalidRngStateError(
          `mulberry32-v1 snapshot requires a valid uint32 internalState, received ${String(word)}.`,
          { internalState: word },
        );
      }
      this.state0 = word >>> 0;
    }

    this.originalSeed = snap.originalSeed;
    this.activeCanonicalSeed = active;
    this.rootCanonicalSeed = root;
    this.draws = drawCount;

    if (this.recordAudit) {
      this.auditTrail.push(
        Object.freeze({
          streamNamespace: this.streamNamespace,
          operation: "restore",
          drawIndexBefore: drawCount,
          drawIndexAfter: drawCount,
          result: this.state0,
        }),
      );
    }
  }

  public getDrawCount(): number {
    return this.draws;
  }

  public getAuditTrail(): readonly RngAuditRecord[] {
    return Object.freeze([...this.auditTrail]);
  }

  public clearAuditTrail(): void {
    this.auditTrail.length = 0;
  }

  public clone(): SeededRNG {
    const snap = this.snapshot();
    return new SeededRNG(this.activeCanonicalSeed, {
      algorithm: this.algorithm,
      algorithmVersion: this.algorithmVersion,
      streamNamespace: this.streamNamespace,
      rootSeed: this.rootCanonicalSeed,
      internalState: snap.internalState,
      stateWords: snap.stateWords,
      drawCount: snap.drawCount,
      recordAudit: this.recordAudit,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* FACTORIES, SERIALIZATION & REPLAY HELPERS                                  */
/* -------------------------------------------------------------------------- */

export class DefaultRngFactory implements RngFactory {
  public createFromSeed(
    seed: SeedInput,
    options?: Omit<RngConfig, "seed">,
  ): DeterministicGameRng {
    return createRandomSource({
      seed,
      ...options,
    });
  }

  public restoreFromState(
    state: RngStateSnapshot | SeedState,
  ): DeterministicGameRng {
    if (!state || typeof state !== "object") {
      throw new InvalidRngStateError(
        "restoreFromState requires a valid RNG state object.",
        { state },
      );
    }
    const snap = state as Partial<RngStateSnapshot>;
    const rng = new SeededRNG(state.originalSeed, {
      algorithm: snap.algorithm ?? DEFAULT_RNG_ALGORITHM_ID,
      algorithmVersion: snap.algorithmVersion ?? DEFAULT_RNG_ALGORITHM_VERSION,
      streamNamespace: snap.streamNamespace ?? "root",
    });
    rng.restore(state);
    return rng;
  }
}

export function createSeededRng(
  seed: SeedInput,
  options?: Omit<RngConfig, "seed">,
): SeededRNG {
  return createRandomSource({
    seed,
    ...options,
  });
}

export function createRandomSource(configOrSeed: RngConfig | SeedInput): SeededRNG {
  if (
    configOrSeed !== null &&
    typeof configOrSeed === "object" &&
    !(configOrSeed instanceof Uint8Array) &&
    !Array.isArray(configOrSeed) &&
    !isCanonicalSeed(configOrSeed) &&
    "seed" in configOrSeed
  ) {
    const cfg = configOrSeed as RngConfig;
    const rng = new SeededRNG(cfg.seed, {
      algorithm: cfg.algorithm,
      algorithmVersion: cfg.algorithmVersion,
      streamNamespace: cfg.streamNamespace,
      recordAudit: cfg.recordAudit,
    });
    if (cfg.initialState) {
      rng.restore(cfg.initialState);
    }
    return rng;
  }
  return new SeededRNG(configOrSeed as SeedInput);
}

export function createRngFromReplayInput(input: ReplayRngInput): SeededRNG {
  if (!input || typeof input !== "object") {
    throw new InvalidSeedError(
      "createRngFromReplayInput requires a valid ReplayRngInput object.",
      { input },
    );
  }
  const rng = new SeededRNG(input.seed, {
    algorithm: input.rngAlgorithm ?? DEFAULT_RNG_ALGORITHM_ID,
    algorithmVersion: input.algorithmVersion ?? DEFAULT_RNG_ALGORITHM_VERSION,
    streamNamespace: input.streamNamespace ?? "root",
    recordAudit: input.recordAudit,
  });
  if (input.stateSnapshot) {
    rng.restore(input.stateSnapshot);
  }
  return rng;
}

export function serializeRngState(
  snapshot: RngStateSnapshot | SeedState,
): string {
  if (!snapshot || typeof snapshot !== "object") {
    throw new InvalidRngStateError(
      "serializeRngState requires a valid RNG snapshot object.",
      { snapshot },
    );
  }
  return JSON.stringify(snapshot);
}

export function deserializeRngState(
  serialized: string,
): DeterministicGameRng {
  if (typeof serialized !== "string" || serialized.trim().length === 0) {
    throw new InvalidRngStateError(
      "deserializeRngState requires a non-empty JSON string.",
      { serialized },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (err) {
    throw new InvalidRngStateError(
      `Failed to parse serialized RNG state JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return new DefaultRngFactory().restoreFromState(parsed as RngStateSnapshot);
}
