/** Authored regression expectations, never generated from engine actuals. */
import { createVerificationBaseline, type VerificationCase } from "../../src/engine";
export const A = "sym-low-a", K = "sym-low-k", Q = "sym-low-q", S = "sym-high-star", W = "sym-wild", SC = "sym-scatter";
export const ZERO_GRID = [[A, K, Q], [A, K, Q], [A, K, Q], [K, Q, S], [Q, S, A]];
export const exactCase: VerificationCase = {
  caseId: "WF-001", description: "Three authored 3-of-a-kind lines: K=3, A=2, Q=4 with bet 5 / 5 lines.",
  seed: "b17-authored", bet: 5, fixedReelStops: [0, 0, 0, 0, 0],
  tags: ["deterministic", "critical", "regression"], suiteIds: ["smoke", "win-evaluation"],
  expected: { reelStops: [0, 0, 0, 0, 0], boardGrid: ZERO_GRID, totalWin: 9, winningCombinationsCount: 3, triggeredFeatureIds: [] },
};
export const lossCase: VerificationCase = {
  caseId: "WF-002", bet: 5, seed: "b17-authored-loss", fixedReelStops: [0, 5, 1, 0, 0],
  tags: ["regression"], suiteIds: ["smoke", "round-control"], expected: { totalWin: 0 },
};
export const authoredBaseline = createVerificationBaseline({ suiteId: "regression", version: "1.0.0", metadata: { author: "B17 explicit cases" }, cases: [exactCase, lossCase] });
