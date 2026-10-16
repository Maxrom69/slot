/** Compile only authored/validated definition settings into existing engine inputs. */
import { adaptBlueprintToGameConfig, type GameConfig, type EngineEvaluationMode } from "../config";
import { normalizeGameDefinition, assertValidGameDefinition, type GameDefinition } from "../schema";
import { createFeatureEngine } from "../features";
import { createFeatureLogicEngine } from "../logic";
import { createMultiplierValueEngine } from "../multipliers";
import { RuntimeError } from "../errors";
import { MECHANIC_METHODS } from "../math";
import { fingerprintVerificationData } from "../verification";
import type { RuntimeDefinition, RuntimeGameDescriptor, RuntimeMechanics, RuntimeOperation } from "./contracts";

export function immutable<T>(value: T): T {
  const cloned = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(cloned); return cloned;
}
export function runtimeFail(message: string, path: string): never { throw new RuntimeError("RUNTIME_INVALID_CONFIG", message, { path }); }
export function validMoney(value: number, path: string, positive = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (positive && value === 0) || !Number.isSafeInteger(Math.round(value * 10000)) || Math.round((value + Number.EPSILON) * 10000) / 10000 !== value) runtimeFail("Money must use non-negative, safe 0.0001-credit units.", path);
}
export function assertSerializable(value: unknown, path = "configuration", ancestors = new Set<object>()): void {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || (typeof value === "number" && !Number.isFinite(value))) runtimeFail("Configuration must contain finite JSON data.", path);
  if (value && typeof value === "object") {
    if (ancestors.has(value)) runtimeFail("Circular configuration is invalid.", path);
    ancestors.add(value);
    for (const [key, child] of Object.entries(value)) assertSerializable(child, `${path}.${key}`, ancestors);
    ancestors.delete(value);
  }
}
export interface LoadedRuntimeGame {
  readonly source: RuntimeDefinition;
  readonly definition: GameDefinition;
  readonly config: GameConfig;
  readonly mechanics: RuntimeMechanics;
  readonly winModes: readonly EngineEvaluationMode[];
  readonly descriptor: RuntimeGameDescriptor;
}
export function compileRuntimeGame(source: RuntimeDefinition): LoadedRuntimeGame {
  assertSerializable(source);
  assertValidGameDefinition(source);
  // Pin a private copy before adapters can retain nested authored data. Never freeze caller input.
  source = immutable(source);
  const definition = normalizeGameDefinition(source);
  const adapted = adaptBlueprintToGameConfig(source);
  const config: GameConfig = { ...adapted, ...(adapted.scatterConfiguration ? { scatterConfiguration: { ...adapted.scatterConfiguration, enabled: adapted.scatterConfiguration.enabled && definition.winEvaluation.enabledModes.includes("scatters") } } : {}) };
  if (!definition.winEvaluation.allowSimultaneousLineAndScatterWins && definition.winEvaluation.enabledModes.includes("scatters") && definition.winEvaluation.enabledModes.length > 1) runtimeFail("This combined-win precedence policy has no shared executor implementation.", "winEvaluation.allowSimultaneousLineAndScatterWins");
  const authored = (source.extensions?.backendRuntime ?? {}) as Partial<RuntimeMechanics>;
  if (source.extensions?.backendRuntime !== undefined && authored.version !== 1) runtimeFail("backendRuntime requires version 1.", "extensions.backendRuntime.version");
  const keys = ["version", "featureConfig", "tumbleConfig", "multiplierConfig", "meters", "losingSpinCondition", "operations", "currency"];
  if (!authored || typeof authored !== "object" || Array.isArray(authored)) runtimeFail("Malformed runtime mechanics.", "extensions.backendRuntime");
  for (const key of Object.keys(authored)) if (!keys.includes(key)) runtimeFail("Unknown runtime configuration field.", `extensions.backendRuntime.${key}`);
  const features = authored.featureConfig ? [] : definition.canonicalFeatures.filter((f) => f.enabled).map((f) => {
    if (f.type !== "freeSpins") runtimeFail("This feature requires an explicit existing B12 FeatureSpec in backendRuntime.featureConfig.", `canonicalFeatures.${f.id}`);
    const fs = definition.freeSpinsConfiguration;
    if (!f.trigger || !("symbolId" in f.trigger) || !("minCount" in f.trigger) || !f.trigger.symbolId) runtimeFail("Feature requires an explicit trigger symbol.", `canonicalFeatures.${f.id}.trigger`);
    if (fs.reelConfigurationReference !== null || fs.multiplierMode === "progressive") runtimeFail("Alternate reel references and progressive feature multipliers require an explicit B12/B14 runtime policy.", "freeSpinsConfiguration");
    const initialSpins = fs.featureId === f.id ? fs.initialSpins : Number(f.configuration.spins ?? fs.initialSpins);
    if (initialSpins > fs.maxSpins) runtimeFail("Initial free spins exceed the configured maximum.", "freeSpinsConfiguration.maxSpins");
    return { id: f.id, name: f.name, mode: "freeSpins" as const, startingMultiplier: fs.multiplierMode === "none" ? 1 : fs.featureId === f.id ? fs.baseMultiplier : Number(f.configuration.multiplier ?? fs.baseMultiplier),
      triggers: [{ id: `${f.id}-trigger`, source: "symbolCount" as const, targetFeatureId: f.id, symbolIds: [f.trigger.symbolId], threshold: f.trigger.minCount }],
      freeSpins: { initialSpins, retriggerEnabled: fs.retriggers, retriggerSymbolIds: [f.trigger.symbolId], retriggerThreshold: f.trigger.minCount, retriggerSpins: fs.retriggerSpinsAwarded, maxRetriggerBatches: Number(f.configuration.maxRetriggerBatches ?? Math.max(0, Math.floor((fs.maxSpins - initialSpins) / Math.max(1, fs.retriggerSpinsAwarded)))) },
    };
  });
  // An explicit B12 config is authoritative; do not attempt to synthesize its mechanics.
  const mechanics: RuntimeMechanics = { ...authored, version: 1, featureConfig: authored.featureConfig ?? { baseReels: config.reels, visibleRows: config.grid.rows, features },
    ...(definition.boardDynamics.cascades.enabled && !authored.tumbleConfig ? { tumbleConfig: { reelStrips: config.reels } } : {}),
  };
  const ops: RuntimeOperation[] = [...(mechanics.operations ?? [])];
  const has = (method: string) => ops.some((op) => op.method === method);
  const mystery = definition.boardDynamics.mysterySymbols;
  if (mystery.enabled && !has("resolveMysteries")) ops.push({ id: "canonical-mystery", scope: "step", at: "beforeWins", target: "board", method: "resolveMysteries", args: [{ mysterySymbolIds: mystery.mysterySymbolIds, candidatePool: mystery.targetSymbolIds, mode: "independent" }, { $ref: "rng" }] });
  if (definition.linkedReels.enabled && !has("applyLinkedReels")) ops.push({ id: "canonical-links", scope: "step", at: "beforeWins", target: "board", method: "applyLinkedReels", args: [definition.linkedReels.links] });
  // Policy-free capability flags do not specify when/where to transform a board.
  for (const [enabled, method] of [[definition.boardDynamics.boardResize.enabled,"resizeBoard"], [definition.boardDynamics.symbolInjection.enabled,"placeSymbols"], [definition.boardDynamics.symbolRemoval.enabled,"removeCells"], [definition.boardDynamics.colossalSymbols.enabled,"placeSymbols"], [definition.boardDynamics.lockedCells.enabled,"applyLocks"], [definition.reelNudges.enabled,"nudgeReel"]] as const) {
    if (enabled && !has(method)) runtimeFail("Enabled mechanic needs an authored operation policy; it is not silently ignored.", method);
  }
  if (definition.multiplierConfiguration.enabled && !ops.some((op) => op.target === "multiplier") && !authored.multiplierConfig) runtimeFail("Enabled multiplier configuration needs an explicit B14 policy.", "multiplierConfiguration");
  const ids = new Set<string>();
  for (const op of ops) {
    const methods: readonly string[] = MECHANIC_METHODS[op.target] ?? [];
    if (!op.id || ids.has(op.id) || !methods.includes(op.method) || !["step", "round", "session"].includes(op.scope) || !["beforeWins", "afterValues", "beforeFeatures", "afterLogic"].includes(op.at) || !Array.isArray(op.args)) runtimeFail("Invalid or duplicate mechanic operation.", "operations");
    if (op.modes && (!Array.isArray(op.modes) || op.modes.some((mode) => !["base","freeSpins","holdAndWin","bonus","custom"].includes(mode)))) runtimeFail("Invalid operation mode filter.", `operations.${op.id}.modes`);
    if (op.featureIds && (!Array.isArray(op.featureIds) || op.featureIds.some((id) => !mechanics.featureConfig?.features.some((f) => f.id === id)))) runtimeFail("Unknown operation feature filter.", `operations.${op.id}.featureIds`);
    if (op.target === "feature" && ["buyFeature","runFeatureStep","evaluateTriggers"].includes(op.method)) runtimeFail("Runtime owns feature stepping/triggers; feature buy needs its own wager policy and is not a playable operation.", `operations.${op.id}`);
    ids.add(op.id);
  }
  const effective = immutable({ ...mechanics, operations: ops });
  const symbols = new Set(config.symbols.map((s) => s.id));
  const featureIds = new Set(effective.featureConfig?.features.map((f) => f.id));
  const scan = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const p = `${path}.${key}`;
      if ((key === "symbolId" || key === "replacementSymbolId" || key === "wildSymbolId") && typeof child === "string" && !symbols.has(child)) runtimeFail("Unknown runtime symbol ID.", p);
      if (/SymbolIds$|^symbolIds$/.test(key) && Array.isArray(child)) for (const id of child) if (!symbols.has(id)) runtimeFail("Unknown runtime symbol ID.", p);
      if (["featureId", "targetFeatureId", "upgradeTargetFeatureId"].includes(key) && typeof child === "string" && !featureIds.has(child)) runtimeFail("Unknown runtime feature ID.", p);
      if (["alternateReels", "reelStrips", "baseReels"].includes(key) && Array.isArray(child)) for (const reel of child) if (Array.isArray(reel)) for (const id of reel) if (!symbols.has(id)) runtimeFail("Unknown reel symbol ID.", p);
      if (["candidatePool", "refillPool"].includes(key) && Array.isArray(child)) for (const entry of child) { const id = typeof entry === "object" && entry ? entry.value : entry; if (typeof id === "string" && !symbols.has(id)) runtimeFail("Unknown pool symbol ID.", p); }
      scan(child, p);
    }
  };
  scan(effective, "backendRuntime");
  createFeatureEngine(effective.featureConfig!);
  const logic = createFeatureLogicEngine(); let logicState = logic.createInitialState();
  for (const meter of effective.meters ?? []) logicState = logic.initializeMeter(logicState, meter).nextState;
  if (effective.multiplierConfig?.tumbleMultiplier) {
    const mult = createMultiplierValueEngine(), state = mult.createInitialState();
    mult.initializeTumbleMultiplier(state.multiplierState, state.valueState, effective.multiplierConfig.tumbleMultiplier);
  }
  if (effective.currency) { if (!effective.currency.code?.trim()) runtimeFail("Currency code is required.", "currency.code"); validMoney(effective.currency.denomination, "currency.denomination", true); }
  const winModes = definition.winEvaluation.enabledModes.filter((mode) => mode !== "scatters").map((mode) => mode === "payAnywhere" ? "pay_anywhere" : mode === "fixedPaylines" ? "lines" : mode === "clusters" ? "cluster" : mode) as EngineEvaluationMode[];
  if ((!winModes.length && !definition.winEvaluation.enabledModes.includes("scatters")) || winModes.some((mode) => !["lines","ways","cluster","pay_anywhere"].includes(mode))) runtimeFail("Unsupported enabled win model.", "winEvaluation.enabledModes");
  config.math.betLevels.forEach((bet) => validMoney(bet, "math.betLevels", true));
  const descriptor: RuntimeGameDescriptor = immutable({ gameId: config.gameId, definitionRevision: `${definition.metadata.version}:${config.engineVersion}`, definitionHash: fingerprintVerificationData({ source, effective }), engineVersion: config.engineVersion, betLevels: config.math.betLevels, currency: effective.currency ?? null });
  return { source: immutable(source), definition, config, mechanics: effective, winModes, descriptor };
}
