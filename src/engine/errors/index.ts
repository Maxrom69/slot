/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 / B03 / B04 / B05 / B06 / B07 — Structured Engine Error Model
 *
 * Pure TypeScript error classes with machine-readable codes and serializable
 * diagnostic context. Zero browser or UI dependencies.
 */

export type RuntimeErrorCode = "RUNTIME_INVALID_CONFIG" | "RUNTIME_SESSION_NOT_FOUND" | "RUNTIME_FORBIDDEN" | "RUNTIME_INVALID_REQUEST" | "RUNTIME_INVALID_TRANSITION" | "RUNTIME_INVALID_BET" | "RUNTIME_INSUFFICIENT_BALANCE" | "RUNTIME_IDEMPOTENCY_CONFLICT" | "RUNTIME_RESULT_EXPIRED" | "RUNTIME_LIMIT_EXCEEDED" | "RUNTIME_EXECUTION_FAILED" | "RUNTIME_INVALID_SNAPSHOT" | "RUNTIME_REPLAY_FAILED";
export type EngineErrorCode = RuntimeErrorCode
  | "INVALID_GAME_CONFIG"
  | "INVALID_SPIN_REQUEST"
  | "INVALID_SYMBOL_REFERENCE"
  | "INVALID_REEL_CONFIG"
  | "INVALID_PAYLINE_CONFIG"
  | "INVALID_PAYTABLE"
  | "UNSUPPORTED_GAME_SCHEMA"
  | "ENGINE_STATE_ERROR"
  | "RNG_ERROR"
  | "INVALID_SEED"
  | "INVALID_RANGE"
  | "INVALID_PROBABILITY"
  | "EMPTY_SELECTION"
  | "INVALID_WEIGHT"
  | "ZERO_TOTAL_WEIGHT"
  | "INVALID_RNG_STATE"
  | "UNSUPPORTED_RNG_ALGORITHM"
  | "INVALID_REEL_COUNT"
  | "EMPTY_REEL"
  | "SHORT_REEL_STRIP"
  | "INVALID_STOP_INDEX"
  | "INVALID_REEL_WEIGHT"
  | "ZERO_WEIGHT_REEL"
  | "INVALID_VISIBLE_ROW_COUNT"
  | "INVALID_REEL_RESOLUTION"
  | "INVALID_BOARD"
  | "INVALID_PAYLINE"
  | "MISSING_PAYLINE"
  | "PAYLINE_GRID_MISMATCH"
  | "INVALID_ROW_INDEX"
  | "UNKNOWN_PAYTABLE_SYMBOL"
  | "INVALID_MATCH_COUNT"
  | "INVALID_PAYOUT_MULTIPLIER"
  | "INVALID_BET"
  | "INVALID_WILD_CONFIG"
  | "UNKNOWN_WILD_SYMBOL"
  | "INVALID_SUBSTITUTION_RULE"
  | "INVALID_WILD_CONTEXT"
  | "INVALID_PAYTABLE_REFERENCE"
  | "INVALID_SCATTER_CONFIG"
  | "UNKNOWN_SCATTER_SYMBOL"
  | "INVALID_SCATTER_THRESHOLD"
  | "INVALID_SCATTER_PAYOUT"
  | "INVALID_WAYS_CONFIG"
  | "INVALID_MINIMUM_REEL_COUNT"
  | "UNKNOWN_WAYS_SYMBOL"
  | "WAYS_ARITHMETIC_OVERFLOW"
  | "INVALID_CLUSTER_CONFIG"
  | "INVALID_MINIMUM_CLUSTER_SIZE"
  | "INVALID_ADJACENCY_MODE"
  | "UNKNOWN_SYMBOL_REFERENCE"
  | "INVALID_FAMILY_REFERENCE"
  | "INVALID_PAY_ANYWHERE_CONFIG"
  | "UNKNOWN_PAY_ANYWHERE_SYMBOL"
  | "INVALID_FEATURE_CONFIG"
  | "UNKNOWN_FEATURE_REFERENCE"
  | "INVALID_FEATURE_TRIGGER"
  | "INVALID_BONUS_POOL"
  | "INVALID_FEATURE_STATE"
  | "INVALID_FEATURE_ACTION"
  | "INVALID_BOARD_DYNAMICS_CONFIG"
  | "INVALID_RESIZE_OPERATION"
  | "INVALID_MYSTERY_CONFIG"
  | "INVALID_COLOSSAL_SYMBOL"
  | "INVALID_LOCK_OPERATION"
  | "INVALID_REEL_NUDGE"
  | "INVALID_LINKED_REELS"
  | "INVALID_VARIABLE_HEIGHT_CONFIG"
  | "INVALID_DUPLICATION_OPERATION"
  | "INVALID_LANE_SWEEP"
  | "INVALID_TAG_OPERATION"
  | "CASCADE_LIMIT_EXCEEDED"
  | "INVALID_MULTIPLIER_CONFIG"
  | "INVALID_CELL_MULTIPLIER"
  | "INVALID_TUMBLE_MULTIPLIER_CONFIG"
  | "INVALID_FEATURE_MULTIPLIER_CONFIG"
  | "INVALID_ASSIGNED_VALUE_CONFIG"
  | "INVALID_COLLECTION_CONFIG"
  | "INVALID_COLLECTION_ZONE"
  | "INVALID_MULTIPLIER_METER"
  | "INVALID_MULTIPLIER_MEMORY"
  | "INVALID_COLLECT_LADDER"
  | "INVALID_VALUE_ABSORPTION"
  | "INVALID_FEATURE_LOGIC_CONFIG"
  | "INVALID_LOGIC_METER_CONFIG"
  | "INVALID_THRESHOLD_CONFIG"
  | "INVALID_TIERED_OUTCOME_CONFIG"
  | "INVALID_WEIGHTED_OUTCOME_CONFIG"
  | "INVALID_CHANCE_GATE_CONFIG"
  | "INVALID_LOSING_SPIN_CONDITION"
  | "INVALID_LOGIC_ACTION"
  | "ACTION_RECURSION_LIMIT_EXCEEDED"
  | "INVALID_SIMULATION_CONFIG"
  | "SIMULATION_EXECUTION_ERROR"
  | "SIMULATION_GUARD_EXCEEDED"
  | "INVALID_VERIFICATION_CASE"
  | "SIMULATION_REPLAY_ERROR"
  | "SIMULATION_COMPARISON_ERROR"
  | "INVALID_VERIFICATION_SUITE"
  | "UNKNOWN_GAME_DEFINITION_REVISION"
  | "MALFORMED_EXPECTED_RESULT"
  | "INCONSISTENT_EXPECTED_DIMENSIONS"
  | "VERIFICATION_EXECUTION_ERROR"
  | "VERIFICATION_REPLAY_ERROR"
  | "VERIFICATION_BASELINE_INTEGRITY_ERROR";

export interface SerializedEngineError {
  readonly name: string;
  readonly code: EngineErrorCode;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export class SlotEngineError extends Error {
  public readonly code: EngineErrorCode;
  public readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: EngineErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = Object.freeze({ ...context });
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): SerializedEngineError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

export class InvalidGameConfigError extends SlotEngineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_GAME_CONFIG", message, context);
  }
}

export class InvalidSpinRequestError extends SlotEngineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_SPIN_REQUEST", message, context);
  }
}

export class InvalidSymbolReferenceError extends SlotEngineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_SYMBOL_REFERENCE", message, context);
  }
}

export class InvalidReelConfigError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_REEL_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class InvalidPaylineConfigError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_PAYLINE_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class InvalidPaytableError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_PAYTABLE",
  ) {
    super(code, message, context);
  }
}

export class UnsupportedGameSchemaError extends SlotEngineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("UNSUPPORTED_GAME_SCHEMA", message, context);
  }
}

export class EngineStateError extends SlotEngineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("ENGINE_STATE_ERROR", message, context);
  }
}

/* -------------------------------------------------------------------------- */
/* B03 — STRUCTURED RNG ERRORS                                                */
/* -------------------------------------------------------------------------- */

export class RngError extends SlotEngineError {
  constructor(
    code: EngineErrorCode = "RNG_ERROR",
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(code, message, context);
  }
}

export class InvalidSeedError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_SEED", message, context);
  }
}

export class InvalidRangeError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_RANGE", message, context);
  }
}

export class InvalidProbabilityError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_PROBABILITY", message, context);
  }
}

export class EmptySelectionError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("EMPTY_SELECTION", message, context);
  }
}

export class InvalidWeightError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_WEIGHT", message, context);
  }
}

export class ZeroTotalWeightError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("ZERO_TOTAL_WEIGHT", message, context);
  }
}

export class InvalidRngStateError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_RNG_STATE", message, context);
  }
}

export class UnsupportedRngAlgorithmError extends RngError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("UNSUPPORTED_RNG_ALGORITHM", message, context);
  }
}

/* -------------------------------------------------------------------------- */
/* B04 — STRUCTURED REEL ENGINE ERRORS                                        */
/* -------------------------------------------------------------------------- */

export class InvalidReelCountError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_REEL_COUNT");
  }
}

export class EmptyReelError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "EMPTY_REEL");
  }
}

export class ShortReelStripError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "SHORT_REEL_STRIP");
  }
}

export class InvalidStopIndexError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_STOP_INDEX");
  }
}

export class UnknownSymbolReferenceError extends InvalidSymbolReferenceError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context);
  }
}

export class InvalidReelWeightError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_REEL_WEIGHT");
  }
}

export class ZeroWeightReelError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "ZERO_WEIGHT_REEL");
  }
}

export class InvalidVisibleRowCountError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_VISIBLE_ROW_COUNT");
  }
}

export class InvalidReelResolutionError extends InvalidReelConfigError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_REEL_RESOLUTION");
  }
}

/* -------------------------------------------------------------------------- */
/* B05 — STRUCTURED PAYLINE ENGINE ERRORS                                     */
/* -------------------------------------------------------------------------- */

export class InvalidBoardError extends SlotEngineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("INVALID_BOARD", message, context);
  }
}

export class InvalidPaylineError extends InvalidPaylineConfigError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_PAYLINE",
  ) {
    super(message, context, code);
  }
}

export class MissingPaylineError extends InvalidPaylineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "MISSING_PAYLINE");
  }
}

export class PaylineGridMismatchError extends InvalidPaylineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "PAYLINE_GRID_MISMATCH");
  }
}

export class InvalidRowIndexError extends InvalidPaylineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_ROW_INDEX");
  }
}

/* -------------------------------------------------------------------------- */
/* B06 — STRUCTURED PAYTABLE ENGINE ERRORS                                    */
/* -------------------------------------------------------------------------- */

export class UnknownPaytableSymbolError extends InvalidPaytableError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "UNKNOWN_PAYTABLE_SYMBOL");
  }
}

export class InvalidMatchCountError extends InvalidPaytableError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_MATCH_COUNT");
  }
}

export class InvalidPayoutMultiplierError extends InvalidPaytableError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_PAYOUT_MULTIPLIER");
  }
}

export class InvalidBetError extends InvalidPaytableError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_BET");
  }
}

/* -------------------------------------------------------------------------- */
/* B07 — STRUCTURED WILD ENGINE ERRORS                                        */
/* -------------------------------------------------------------------------- */

export class InvalidWildConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_WILD_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class UnknownWildSymbolError extends InvalidWildConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "UNKNOWN_WILD_SYMBOL");
  }
}

export class InvalidSubstitutionRuleError extends InvalidWildConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_SUBSTITUTION_RULE");
  }
}

export class InvalidWildContextError extends InvalidWildConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_WILD_CONTEXT");
  }
}

export class InvalidPaytableReferenceError extends InvalidWildConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_PAYTABLE_REFERENCE");
  }
}

/* -------------------------------------------------------------------------- */
/* B08 — STRUCTURED SCATTER ENGINE ERRORS                                     */
/* -------------------------------------------------------------------------- */

export class InvalidScatterConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_SCATTER_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class UnknownScatterSymbolError extends InvalidScatterConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "UNKNOWN_SCATTER_SYMBOL");
  }
}

export class InvalidScatterThresholdError extends InvalidScatterConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_SCATTER_THRESHOLD");
  }
}

export class InvalidScatterPayoutError extends InvalidScatterConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_SCATTER_PAYOUT");
  }
}

/* -------------------------------------------------------------------------- */
/* B09 — STRUCTURED WAYS-TO-WIN ENGINE ERRORS                                 */
/* -------------------------------------------------------------------------- */

export class InvalidWaysConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_WAYS_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class InvalidMinimumReelCountError extends InvalidWaysConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_MINIMUM_REEL_COUNT");
  }
}

export class UnknownWaysSymbolError extends InvalidWaysConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "UNKNOWN_WAYS_SYMBOL");
  }
}

export class WaysArithmeticOverflowError extends InvalidWaysConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "WAYS_ARITHMETIC_OVERFLOW");
  }
}

/* -------------------------------------------------------------------------- */
/* B10 — STRUCTURED CLUSTER ENGINE ERRORS                                     */
/* -------------------------------------------------------------------------- */

export class InvalidClusterConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_CLUSTER_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class InvalidMinimumClusterSizeError extends InvalidClusterConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_MINIMUM_CLUSTER_SIZE");
  }
}

export class InvalidAdjacencyModeError extends InvalidClusterConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_ADJACENCY_MODE");
  }
}

export class InvalidFamilyReferenceError extends InvalidClusterConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_FAMILY_REFERENCE");
  }
}

/* -------------------------------------------------------------------------- */
/* B11 — STRUCTURED PAY-ANYWHERE ENGINE ERRORS                                */
/* -------------------------------------------------------------------------- */

export class InvalidPayAnywhereConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_PAY_ANYWHERE_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class UnknownPayAnywhereSymbolError extends InvalidPayAnywhereConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "UNKNOWN_PAY_ANYWHERE_SYMBOL");
  }
}

/* -------------------------------------------------------------------------- */
/* B12 — STRUCTURED FEATURE ENGINE ERRORS                                     */
/* -------------------------------------------------------------------------- */

export class InvalidFeatureConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_FEATURE_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class UnknownFeatureReferenceError extends InvalidFeatureConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "UNKNOWN_FEATURE_REFERENCE");
  }
}

export class InvalidFeatureTriggerError extends InvalidFeatureConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_FEATURE_TRIGGER");
  }
}

export class InvalidBonusPoolError extends InvalidFeatureConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_BONUS_POOL");
  }
}

export class InvalidFeatureStateError extends InvalidFeatureConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_FEATURE_STATE");
  }
}

export class InvalidFeatureActionError extends InvalidFeatureConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_FEATURE_ACTION");
  }
}

/* -------------------------------------------------------------------------- */
/* B13 — STRUCTURED BOARD DYNAMICS ENGINE ERRORS                              */
/* -------------------------------------------------------------------------- */

export class InvalidBoardDynamicsConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_BOARD_DYNAMICS_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class InvalidResizeOperationError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_RESIZE_OPERATION");
  }
}

export class InvalidMysteryConfigurationError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_MYSTERY_CONFIG");
  }
}

export class InvalidColossalSymbolError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_COLOSSAL_SYMBOL");
  }
}

export class InvalidLockOperationError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_LOCK_OPERATION");
  }
}

export class InvalidReelNudgeError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_REEL_NUDGE");
  }
}

export class InvalidLinkedReelsError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_LINKED_REELS");
  }
}

export class InvalidVariableHeightConfigurationError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_VARIABLE_HEIGHT_CONFIG");
  }
}

export class InvalidDuplicationOperationError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_DUPLICATION_OPERATION");
  }
}

export class InvalidLaneSweepError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_LANE_SWEEP");
  }
}

export class InvalidTagOperationError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_TAG_OPERATION");
  }
}

export class CascadeLimitExceededError extends InvalidBoardDynamicsConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "CASCADE_LIMIT_EXCEEDED");
  }
}

/* -------------------------------------------------------------------------- */
/* B14 — STRUCTURED MULTIPLIER & SYMBOL VALUE ENGINE ERRORS                   */
/* -------------------------------------------------------------------------- */

export class InvalidMultiplierConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_MULTIPLIER_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class InvalidCellMultiplierError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_CELL_MULTIPLIER");
  }
}

export class InvalidTumbleMultiplierConfigError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_TUMBLE_MULTIPLIER_CONFIG");
  }
}

export class InvalidFeatureMultiplierConfigError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_FEATURE_MULTIPLIER_CONFIG");
  }
}

export class InvalidAssignedValueConfigError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_ASSIGNED_VALUE_CONFIG");
  }
}

export class InvalidCollectionConfigurationError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_COLLECTION_CONFIG");
  }
}

export class InvalidCollectionZoneError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_COLLECTION_ZONE");
  }
}

export class InvalidMultiplierMeterError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_MULTIPLIER_METER");
  }
}

export class InvalidMultiplierMemoryError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_MULTIPLIER_MEMORY");
  }
}

export class InvalidCollectLadderError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_COLLECT_LADDER");
  }
}

export class InvalidValueAbsorptionError extends InvalidMultiplierConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_VALUE_ABSORPTION");
  }
}

/* -------------------------------------------------------------------------- */
/* B15 — STRUCTURED METERS & FEATURE LOGIC ENGINE ERRORS                      */
/* -------------------------------------------------------------------------- */

export class InvalidFeatureLogicConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_FEATURE_LOGIC_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class InvalidLogicMeterError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_LOGIC_METER_CONFIG");
  }
}

export class InvalidThresholdConfigurationError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_THRESHOLD_CONFIG");
  }
}

export class InvalidTieredOutcomeConfigurationError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_TIERED_OUTCOME_CONFIG");
  }
}

export class InvalidWeightedOutcomeError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_WEIGHTED_OUTCOME_CONFIG");
  }
}

export class InvalidChanceGateError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_CHANCE_GATE_CONFIG");
  }
}

export class InvalidLosingSpinConditionError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_LOSING_SPIN_CONDITION");
  }
}

export class InvalidLogicActionError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_LOGIC_ACTION");
  }
}

export class ActionRecursionLimitExceededError extends InvalidFeatureLogicConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "ACTION_RECURSION_LIMIT_EXCEEDED");
  }
}

/* -------------------------------------------------------------------------- */
/* B16 — STRUCTURED MATH SIMULATION & STATISTICS ENGINE ERRORS                */
/* -------------------------------------------------------------------------- */

export class InvalidSimulationConfigurationError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "INVALID_SIMULATION_CONFIG",
  ) {
    super(code, message, context);
  }
}

export class SimulationExecutionError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "SIMULATION_EXECUTION_ERROR",
  ) {
    super(code, message, context);
  }
}

export class SimulationGuardExceededError extends SimulationExecutionError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "SIMULATION_GUARD_EXCEEDED");
  }
}

export class InvalidVerificationCaseError extends InvalidSimulationConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}, code: EngineErrorCode = "INVALID_VERIFICATION_CASE") {
    super(message, context, code);
  }
}

export class SimulationReplayError extends SimulationExecutionError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "SIMULATION_REPLAY_ERROR");
  }
}

export class SimulationComparisonError extends InvalidSimulationConfigurationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "SIMULATION_COMPARISON_ERROR");
  }
}

/* -------------------------------------------------------------------------- */
/* B17 — STRUCTURED DETERMINISTIC VERIFICATION ENGINE ERRORS                  */
/* -------------------------------------------------------------------------- */

export class InvalidVerificationSuiteError extends InvalidVerificationCaseError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INVALID_VERIFICATION_SUITE");
  }
}

export class UnknownGameDefinitionRevisionError extends InvalidVerificationCaseError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "UNKNOWN_GAME_DEFINITION_REVISION");
  }
}

export class MalformedExpectedResultError extends InvalidVerificationCaseError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "MALFORMED_EXPECTED_RESULT");
  }
}

export class InconsistentExpectedDimensionsError extends InvalidVerificationCaseError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "INCONSISTENT_EXPECTED_DIMENSIONS");
  }
}

export class VerificationExecutionError extends SlotEngineError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    code: EngineErrorCode = "VERIFICATION_EXECUTION_ERROR",
  ) {
    super(code, message, context);
  }
}

export class VerificationReplayError extends VerificationExecutionError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context, "VERIFICATION_REPLAY_ERROR");
  }
}

export class VerificationBaselineIntegrityError extends SlotEngineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("VERIFICATION_BASELINE_INTEGRITY_ERROR", message, context);
  }
}







/** B18 errors are recoverable without committing incomplete gameplay state. */
export class RuntimeError extends SlotEngineError {
  constructor(code: RuntimeErrorCode, message: string, context: Record<string, unknown> = {}, public readonly recoverable = true) { super(code, message, context); }
  public override toJSON(): SerializedEngineError & { readonly recoverable: boolean } { return { ...super.toJSON(), recoverable: this.recoverable }; }
}
