/** B16 validation, deterministic identity and exact reporting helpers. No game rules. */
import { InvalidSimulationConfigurationError, SimulationExecutionError } from "../errors";
import type { SimulationConfig, WinSourceKind } from "./index";
export const SIMULATION_SOURCES: readonly WinSourceKind[] = ["payline", "ways", "cluster", "payAnywhere", "scatter", "featureValue"];
export function canonicalSimulationData(value: unknown): string {
  const visit = (v: unknown): unknown => {
    if (v instanceof Map) return [...v.entries()].sort(([a], [b]) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0).map(([k, child]) => [k, visit(child)]);
    if (v instanceof Set) return [...v].sort();
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, child]) => [k, visit(child)]));
    return v;
  };
  return JSON.stringify(visit(value)) ?? "undefined";
}
export function hashSimulationData(value: unknown): string {
  const payload = canonicalSimulationData(value);
  let a = 0xdeadbeef ^ payload.length, b = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) { const c = payload.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return `fnv-${(b >>> 0).toString(16).padStart(8, "0")}${(a >>> 0).toString(16).padStart(8, "0")}`;
}
function invalid(field: string, message: string): never { throw new InvalidSimulationConfigurationError(`${field}: ${message}`, { field }); }
export function validateSimulationOptions(c: SimulationConfig, hasClock: boolean): void {
  for (const name of ["spinCount", "batchSize", "maxOperationsGuard", "maxFeatureStepsPerRound"] as const) {
    const value = c[name]; if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) invalid(name, "must be a positive safe integer");
  }
  if (c.maxCascadeStepsPerSpin !== undefined && (!Number.isSafeInteger(c.maxCascadeStepsPerSpin) || c.maxCascadeStepsPerSpin < 0)) invalid("maxCascadeStepsPerSpin", "must be a non-negative safe integer");
  for (const name of ["bet", "initialBankroll"] as const) {
    const value = c[name]; if (value !== undefined && (!Number.isFinite(value) || value < 0 || (name === "bet" && value === 0) || Math.round(value * 10000) / 10000 !== value || !Number.isSafeInteger(Math.round(value * 10000)))) invalid(name, "must be safe non-negative currency with at most four decimal places");
  }
  if (c.losingSpinActions && c.losingSpinCondition) invalid("losingSpinActions", "supply one losing-spin policy, not two competing policies");
  if (c.losingSpinActions?.maxDepth !== undefined) invalid("losingSpinActions.maxDepth", "use a nested authored B15 operation when a custom recursion depth is needed");
  if (c.selectedMode !== undefined && c.selectedMode !== "base") invalid("selectedMode", "statistical rounds must begin in base mode; use an explicit feature-state verification case for a mid-feature start");
  if (c.mode !== undefined && !["statistical", "verification"].includes(c.mode)) invalid("mode", "unsupported execution mode");
  if (c.errorPolicy !== undefined && !["failFast", "collectAndContinue"].includes(c.errorPolicy)) invalid("errorPolicy", "unsupported error policy");
  for (const name of ["retainSpinTraces", "retainBoardSnapshots", "retainRawWinSamples", "collectDiagnostics"] as const) if (c[name] !== undefined && typeof c[name] !== "boolean") invalid(name, "must be boolean");
  if (c.maxExecutionTimeMs !== undefined && (!Number.isFinite(c.maxExecutionTimeMs) || c.maxExecutionTimeMs <= 0 || !hasClock)) invalid("maxExecutionTimeMs", "requires a positive duration and a host-injected monotonicNowMs clock");
  if (c.percentiles !== undefined && (!Array.isArray(c.percentiles) || c.percentiles.some((p) => !Number.isFinite(p) || p < 0 || p > 100) || new Set(c.percentiles).size !== c.percentiles.length)) invalid("percentiles", "must be unique finite percentiles in [0,100]");
  if (c.activePaylineIds && new Set(c.activePaylineIds).size !== c.activePaylineIds.length) invalid("activePaylineIds", "duplicate line IDs would double-count payouts");
  if (c.fixedStops !== undefined) {
    if (!Array.isArray(c.fixedStops) || !c.fixedStops.length) invalid("fixedStops", "must be a nonempty stop vector or schedule");
    const nested = Array.isArray(c.fixedStops[0]);
    if (c.fixedStops.some((v) => nested ? !Array.isArray(v) || !v.length || v.some((stop) => !Number.isInteger(stop)) : typeof v !== "number" || !Number.isInteger(v))) invalid("fixedStops", "malformed stop schedule");
  }
  if (c.winDistributionBuckets !== undefined) {
    const buckets = c.winDistributionBuckets;
    if (!Array.isArray(buckets) || !buckets.length) invalid("winDistributionBuckets", "must cover all nonnegative returns");
    const labels = new Set<string>(); let end: number | null = 0;
    for (const bucket of buckets) {
      if (!bucket || typeof bucket.label !== "string" || !bucket.label.trim() || labels.has(bucket.label) || end === null || bucket.minMultipleInclusive !== end || (bucket.maxMultipleExclusive !== null && (!Number.isFinite(bucket.maxMultipleExclusive) || bucket.maxMultipleExclusive <= end))) invalid("winDistributionBuckets", "buckets must be ordered, contiguous, uniquely labelled and nonoverlapping");
      labels.add(bucket.label); end = bucket.maxMultipleExclusive;
    }
    if (end !== null) invalid("winDistributionBuckets", "last bucket must be unbounded");
  }
}
export function safeSimulationUnits(amount: number): number {
  const units = Math.round((amount + Number.EPSILON) * 10000);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(units)) throw new SimulationExecutionError("Unsafe or non-finite simulation currency.", { amount });
  return units;
}
export function safeSimulationSum(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(a + b)) throw new SimulationExecutionError("Simulation fixed-point accumulation overflow.", { a, b });
  return a + b;
}
/** Reporting allocation only: never increases the authoritative settlement award. */
export function reconcileSimulationSources(raw: Readonly<Record<WinSourceKind, number>>, award: number): Readonly<Record<WinSourceKind, number>> {
  const target = safeSimulationUnits(award), units = SIMULATION_SOURCES.map((key) => Math.max(0, safeSimulationUnits(raw[key])));
  const total = units.reduce(safeSimulationSum, 0);
  if (target >= total) units[5] = safeSimulationSum(units[5]!, target - total);
  else {
    let remainder = target;
    for (let i = 0; i < units.length; i++) { units[i] = Math.min(remainder, Math.floor((units[i]! / total) * target)); remainder -= units[i]!; }
    // Stable rounding residue, not an additional payout.
    for (let i = 0; remainder > 0; i = (i + 1) % units.length) if (raw[SIMULATION_SOURCES[i]!] > 0) { units[i]! += 1; remainder -= 1; }
  }
  return Object.freeze(Object.fromEntries(SIMULATION_SOURCES.map((key, i) => [key, units[i]! / 10000])) as Record<WinSourceKind, number>);
}
