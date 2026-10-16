import type {
  ElementDef,
  ExportConfig,
  FeatureConfig,
  GameBlueprint,
  LayerDef,
  MathConfig,
  PaylineConfigurationData,
  PaylineDef,
  PaytableConfigurationData,
  ProjectMeta,
  ReelConfig,
  ReelConfigurationData,
  SceneObject,
  SymbolDef,
} from "@/lib/blueprint/types";
import { applyPaylineConfigurationToBlueprint } from "@/lib/paylines/operations";
import { applyPaytableConfigurationToBlueprint } from "@/lib/paytable/operations";
import { applyReelConfigurationToBlueprint } from "@/lib/reels/operations";
import {
  changeBlueprintGridSize,
  deleteElementFromBlueprint,
  deleteSymbolFromBlueprint,
  reconcileBlueprintState,
} from "@/lib/integration/operations";
import type { GridChangeOptions } from "@/lib/integration/types";

export const COMMAND_TYPES = [
  "ADD_ELEMENT",
  "UPDATE_ELEMENT",
  "DELETE_ELEMENT",
  "MOVE_ELEMENT",
  "RESIZE_ELEMENT",
  "ROTATE_ELEMENT",
  "REORDER_LAYER",
  "TOGGLE_VISIBILITY",
  "TOGGLE_LOCK",
  "ADD_SYMBOL",
  "UPDATE_SYMBOL",
  "DELETE_SYMBOL",
  "UPDATE_REEL",
  "CHANGE_GRID_SIZE",
  "UPDATE_PAYLINE",
  "UPDATE_PAYTABLE",
  "UPDATE_MATH",
  "UPDATE_FEATURE",
  "UPDATE_META",
  "UPDATE_EXPORT",
  "REPLACE_BLUEPRINT",
] as const;

export type EditorCommandType = (typeof COMMAND_TYPES)[number];

export interface CommandPayloadMap {
  ADD_ELEMENT: {
    element?: ElementDef;
    sceneId?: string;
    sceneObject?: SceneObject;
  };
  UPDATE_ELEMENT: {
    id: string;
    sceneId?: string;
    elementPatch?: Partial<ElementDef>;
    objectPatch?: Partial<SceneObject>;
  };
  DELETE_ELEMENT: {
    id: string;
    sceneId?: string;
  };
  MOVE_ELEMENT: {
    id: string;
    sceneId?: string;
    x: number;
    y: number;
  };
  RESIZE_ELEMENT: {
    id: string;
    sceneId?: string;
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  ROTATE_ELEMENT: {
    id: string;
    sceneId?: string;
    rotation: number;
  };
  REORDER_LAYER: {
    layerId: string;
    targetIndex: number;
  };
  TOGGLE_VISIBILITY: {
    id: string;
    sceneId?: string;
    visible?: boolean;
  };
  TOGGLE_LOCK: {
    id: string;
    sceneId?: string;
    locked?: boolean;
  };
  ADD_SYMBOL: {
    symbol: SymbolDef;
    symbolSetId?: string | null;
  };
  UPDATE_SYMBOL: {
    symbolId: string;
    patch: Partial<SymbolDef>;
  };
  DELETE_SYMBOL: {
    symbolId: string;
    replacementSymbolId?: string;
  };
  UPDATE_REEL: {
    patch?: Partial<ReelConfig>;
    reelConfiguration?: ReelConfigurationData;
  };
  CHANGE_GRID_SIZE: GridChangeOptions;
  UPDATE_PAYLINE: {
    paylineId?: string;
    patch?: Partial<PaylineDef>;
    paylines?: PaylineDef[];
    paylineConfiguration?: PaylineConfigurationData;
  };
  UPDATE_PAYTABLE: {
    paytableConfiguration: PaytableConfigurationData;
  };
  UPDATE_MATH: {
    patch: Partial<MathConfig>;
  };
  UPDATE_FEATURE: {
    featureId: string;
    patch: Partial<FeatureConfig>;
  };
  UPDATE_META: {
    patch: Partial<ProjectMeta>;
  };
  UPDATE_EXPORT: {
    patch: Partial<ExportConfig>;
  };
  REPLACE_BLUEPRINT: {
    blueprint: GameBlueprint;
  };
}

export interface EditorCommand<T extends EditorCommandType = EditorCommandType> {
  id: string;
  type: T;
  label: string;
  timestamp: string;
  payload: CommandPayloadMap[T];
}

export interface CommandHistoryEntry {
  command: EditorCommand;
  before: GameBlueprint;
  after: GameBlueprint;
}

const DEFAULT_COMMAND_LABELS: Record<EditorCommandType, string> = {
  ADD_ELEMENT: "Add element",
  UPDATE_ELEMENT: "Update element",
  DELETE_ELEMENT: "Delete element",
  MOVE_ELEMENT: "Move element",
  RESIZE_ELEMENT: "Resize element",
  ROTATE_ELEMENT: "Rotate element",
  REORDER_LAYER: "Reorder layer",
  TOGGLE_VISIBILITY: "Toggle visibility",
  TOGGLE_LOCK: "Toggle lock",
  ADD_SYMBOL: "Add symbol",
  UPDATE_SYMBOL: "Update symbol",
  DELETE_SYMBOL: "Delete symbol",
  UPDATE_REEL: "Update reel configuration",
  CHANGE_GRID_SIZE: "Change grid size",
  UPDATE_PAYLINE: "Update payline configuration",
  UPDATE_PAYTABLE: "Update paytable configuration",
  UPDATE_MATH: "Update math configuration",
  UPDATE_FEATURE: "Update feature configuration",
  UPDATE_META: "Update project metadata",
  UPDATE_EXPORT: "Update export configuration",
  REPLACE_BLUEPRINT: "Replace blueprint state",
};

export function createEditorCommand<T extends EditorCommandType>(
  type: T,
  payload: CommandPayloadMap[T],
  label?: string,
): EditorCommand<T> {
  return {
    id: `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    label: label ?? DEFAULT_COMMAND_LABELS[type],
    timestamp: new Date().toISOString(),
    payload,
  };
}

function updateSceneObjects(
  bp: GameBlueprint,
  sceneId: string | undefined,
  updater: (objects: SceneObject[]) => SceneObject[],
): GameBlueprint {
  const targetSceneId = sceneId ?? bp.scenes[0]?.id;
  if (!targetSceneId) return bp;
  return {
    ...bp,
    scenes: bp.scenes.map((scene) =>
      scene.id === targetSceneId
        ? { ...scene, objects: updater(scene.objects ?? []) }
        : scene,
    ),
  };
}

/**
 * Pure command reducer: executes one typed EditorCommand against a GameBlueprint
 * and returns a new immutable GameBlueprint.
 */
export function executeEditorCommand(
  bp: GameBlueprint,
  command: EditorCommand,
): GameBlueprint {
  const now = new Date().toISOString();
  const touchMeta = (next: GameBlueprint): GameBlueprint => ({
    ...next,
    meta: { ...next.meta, updatedAt: now },
  });

  switch (command.type) {
    case "ADD_ELEMENT": {
      const payload = command.payload as CommandPayloadMap["ADD_ELEMENT"];
      let next = bp;
      if (payload.element) {
        const filtered = next.elements.filter((el) => el.id !== payload.element!.id);
        next = { ...next, elements: [...filtered, payload.element] };
      }
      if (payload.sceneObject) {
        next = updateSceneObjects(next, payload.sceneId, (objs) => [
          ...objs.filter((o) => o.id !== payload.sceneObject!.id),
          payload.sceneObject!,
        ]);
      }
      return touchMeta(next);
    }

    case "UPDATE_ELEMENT": {
      const payload = command.payload as CommandPayloadMap["UPDATE_ELEMENT"];
      let next = bp;
      if (payload.elementPatch) {
        next = {
          ...next,
          elements: next.elements.map((el) =>
            el.id === payload.id ? { ...el, ...payload.elementPatch, id: el.id } : el,
          ),
        };
      }
      if (payload.objectPatch) {
        next = updateSceneObjects(next, payload.sceneId, (objs) =>
          objs.map((o) =>
            o.id === payload.id ? { ...o, ...payload.objectPatch, id: o.id } : o,
          ),
        );
      }
      return touchMeta(next);
    }

    case "DELETE_ELEMENT": {
      const payload = command.payload as CommandPayloadMap["DELETE_ELEMENT"];
      if (!payload.sceneId && bp.elements.some((el) => el.id === payload.id)) {
        return deleteElementFromBlueprint(bp, payload.id).blueprint;
      }
      const nextElements = bp.elements.filter((el) => el.id !== payload.id);
      const nextSymbolSets = bp.symbolSets.filter((set) => set.id !== payload.id);
      const next = updateSceneObjects(
        { ...bp, elements: nextElements, symbolSets: nextSymbolSets },
        payload.sceneId,
        (objs) => objs.filter((o) => o.id !== payload.id && o.refId !== payload.id),
      );
      return touchMeta(next);
    }

    case "MOVE_ELEMENT": {
      const payload = command.payload as CommandPayloadMap["MOVE_ELEMENT"];
      const next = updateSceneObjects(bp, payload.sceneId, (objs) =>
        objs.map((o) =>
          o.id === payload.id
            ? {
                ...o,
                x: payload.x,
                y: payload.y,
                transform: { ...(o.transform ?? { x: 0, y: 0 }), x: payload.x, y: payload.y },
              }
            : o,
        ),
      );
      return touchMeta(next);
    }

    case "RESIZE_ELEMENT": {
      const payload = command.payload as CommandPayloadMap["RESIZE_ELEMENT"];
      const next = updateSceneObjects(bp, payload.sceneId, (objs) =>
        objs.map((o) =>
          o.id === payload.id
            ? {
                ...o,
                width: Math.max(1, payload.width),
                height: Math.max(1, payload.height),
                ...(payload.x !== undefined ? { x: payload.x } : {}),
                ...(payload.y !== undefined ? { y: payload.y } : {}),
              }
            : o,
        ),
      );
      return touchMeta(next);
    }

    case "ROTATE_ELEMENT": {
      const payload = command.payload as CommandPayloadMap["ROTATE_ELEMENT"];
      const next = updateSceneObjects(bp, payload.sceneId, (objs) =>
        objs.map((o) =>
          o.id === payload.id ? { ...o, rotation: payload.rotation } : o,
        ),
      );
      return touchMeta(next);
    }

    case "REORDER_LAYER": {
      const payload = command.payload as CommandPayloadMap["REORDER_LAYER"];
      const currentIdx = bp.layers.findIndex((l) => l.id === payload.layerId);
      if (currentIdx === -1) return bp;
      const copy: LayerDef[] = [...bp.layers];
      const [moved] = copy.splice(currentIdx, 1);
      const clampedTarget = Math.max(0, Math.min(copy.length, payload.targetIndex));
      copy.splice(clampedTarget, 0, moved);
      const reindexed = copy.map((layer, index) => ({ ...layer, order: index }));
      return touchMeta({ ...bp, layers: reindexed });
    }

    case "TOGGLE_VISIBILITY": {
      const payload = command.payload as CommandPayloadMap["TOGGLE_VISIBILITY"];
      const hasLayer = bp.layers.some((l) => l.id === payload.id);
      if (hasLayer) {
        return touchMeta({
          ...bp,
          layers: bp.layers.map((l) =>
            l.id === payload.id
              ? { ...l, visible: payload.visible ?? !l.visible }
              : l,
          ),
        });
      }
      return touchMeta(
        updateSceneObjects(bp, payload.sceneId, (objs) =>
          objs.map((o) =>
            o.id === payload.id
              ? { ...o, visible: payload.visible ?? !o.visible }
              : o,
          ),
        ),
      );
    }

    case "TOGGLE_LOCK": {
      const payload = command.payload as CommandPayloadMap["TOGGLE_LOCK"];
      const hasLayer = bp.layers.some((l) => l.id === payload.id);
      if (hasLayer) {
        return touchMeta({
          ...bp,
          layers: bp.layers.map((l) =>
            l.id === payload.id
              ? { ...l, locked: payload.locked ?? !l.locked }
              : l,
          ),
        });
      }
      return touchMeta(
        updateSceneObjects(bp, payload.sceneId, (objs) =>
          objs.map((o) =>
            o.id === payload.id
              ? { ...o, locked: payload.locked ?? !o.locked }
              : o,
          ),
        ),
      );
    }

    case "ADD_SYMBOL": {
      const payload = command.payload as CommandPayloadMap["ADD_SYMBOL"];
      const sym = {
        ...payload.symbol,
        symbolSetId: payload.symbolSetId ?? payload.symbol.symbolSetId ?? null,
      };
      const nextSymbols = [
        ...bp.symbols.filter((s) => s.id !== sym.id),
        sym,
      ];
      let nextElements = [...bp.elements];
      if (sym.symbolSetId) {
        nextElements = nextElements.map((el) =>
          (el.id === sym.symbolSetId ||
            el.id === `el-set-${sym.symbolSetId}` ||
            el.id === `el-symbol-${sym.symbolSetId}`) &&
          !el.symbolIds.includes(sym.id)
            ? { ...el, symbolIds: [...el.symbolIds, sym.id] }
            : el,
        );
      }
      return reconcileBlueprintState({
        ...bp,
        symbols: nextSymbols,
        elements: nextElements,
      });
    }

    case "DELETE_SYMBOL": {
      const payload = command.payload as CommandPayloadMap["DELETE_SYMBOL"];
      return deleteSymbolFromBlueprint(bp, payload.symbolId, {
        replacementSymbolId: payload.replacementSymbolId,
      }).blueprint;
    }

    case "CHANGE_GRID_SIZE": {
      const payload = command.payload as CommandPayloadMap["CHANGE_GRID_SIZE"];
      return changeBlueprintGridSize(bp, payload).blueprint;
    }

    case "REPLACE_BLUEPRINT": {
      const payload = command.payload as CommandPayloadMap["REPLACE_BLUEPRINT"];
      return reconcileBlueprintState(payload.blueprint);
    }

    case "UPDATE_SYMBOL": {
      const payload = command.payload as CommandPayloadMap["UPDATE_SYMBOL"];
      const nextSymbols = bp.symbols.map((sym) =>
        sym.id === payload.symbolId
          ? { ...sym, ...payload.patch, id: sym.id }
          : sym,
      );
      const updatedSymbol = nextSymbols.find((s) => s.id === payload.symbolId);
      let nextPaytable = bp.paytable;
      if (updatedSymbol && payload.patch.payouts) {
        const otherRows = bp.paytable.filter((r) => r.symbolId !== payload.symbolId);
        const newRows = Object.entries(updatedSymbol.payouts).map(([count, payout]) => ({
          symbolId: updatedSymbol.id,
          ofAKind: Number(count),
          payout: Number(payout),
        }));
        nextPaytable = [...otherRows, ...newRows];
      }
      let nextSpecialSymbols = bp.specialSymbols ?? [];
      if (
        updatedSymbol &&
        (payload.patch.isWild !== undefined ||
          payload.patch.isScatter !== undefined ||
          payload.patch.isBonus !== undefined)
      ) {
        nextSpecialSymbols = nextSpecialSymbols.filter(
          (sp) =>
            sp.symbolId !== updatedSymbol.id ||
            (sp.behaviour !== "wild" &&
              sp.behaviour !== "scatter" &&
              sp.behaviour !== "bonus"),
        );
        if (updatedSymbol.isWild) {
          nextSpecialSymbols.push({
            id:
              updatedSymbol.id === "sym-wild"
                ? "special-wild"
                : `special-wild-${updatedSymbol.id}`,
            symbolId: updatedSymbol.id,
            behaviour: "wild",
            params: { substitutesScatter: false, multiplier: 1 },
          });
        }
        if (updatedSymbol.isScatter) {
          nextSpecialSymbols.push({
            id:
              updatedSymbol.id === "sym-scatter"
                ? "special-scatter"
                : `special-scatter-${updatedSymbol.id}`,
            symbolId: updatedSymbol.id,
            behaviour: "scatter",
            params: { triggerCount: 3, awardsFreeSpins: 10 },
          });
        }
        if (updatedSymbol.isBonus) {
          nextSpecialSymbols.push({
            id:
              updatedSymbol.id === "sym-bonus"
                ? "special-bonus"
                : `special-bonus-${updatedSymbol.id}`,
            symbolId: updatedSymbol.id,
            behaviour: "bonus",
            params: { triggerCount: 3, feature: "pick_bonus" },
          });
        }
      }
      const nextPaytableConfig =
        updatedSymbol && bp.paytableConfiguration
          ? {
              ...bp.paytableConfiguration,
              symbolRows: bp.paytableConfiguration.symbolRows.map((row) => {
                if (row.symbolId !== updatedSymbol.id) return row;
                const numericPayouts: Record<number, number> = { ...row.payouts };
                if (payload.patch.payouts) {
                  for (const [k, v] of Object.entries(updatedSymbol.payouts)) {
                    numericPayouts[Number(k)] = Number(v);
                  }
                }
                return {
                  ...row,
                  symbolName: updatedSymbol.name,
                  symbolCode: updatedSymbol.code,
                  tier: updatedSymbol.tier,
                  glyph: updatedSymbol.glyph,
                  isWild: Boolean(updatedSymbol.isWild),
                  isScatter: Boolean(updatedSymbol.isScatter),
                  isBonus: Boolean(updatedSymbol.isBonus),
                  payouts: numericPayouts,
                };
              }),
              entries: nextPaytable,
            }
          : bp.paytableConfiguration;
      return reconcileBlueprintState({
        ...bp,
        symbols: nextSymbols,
        specialSymbols: nextSpecialSymbols,
        paytable: nextPaytable,
        paytableConfiguration: nextPaytableConfig,
      });
    }

    case "UPDATE_REEL": {
      const payload = command.payload as CommandPayloadMap["UPDATE_REEL"];
      let next = bp;
      if (payload.reelConfiguration) {
        next = applyReelConfigurationToBlueprint(next, payload.reelConfiguration);
      }
      if (payload.patch) {
        const nextReels: ReelConfig = {
          ...next.reels,
          ...payload.patch,
        };
        const nextPreset: "5x3" | "5x4" | "6x3" | "6x4" | "custom" =
          nextReels.columns === 5 && nextReels.rows === 3
            ? "5x3"
            : nextReels.columns === 5 && nextReels.rows === 4
              ? "5x4"
              : nextReels.columns === 6 && nextReels.rows === 3
                ? "6x3"
                : nextReels.columns === 6 && nextReels.rows === 4
                  ? "6x4"
                  : "custom";
        next = {
          ...next,
          grid: next.grid
            ? {
                ...next.grid,
                preset: nextPreset,
                columns: nextReels.columns,
                rows: nextReels.rows,
              }
            : {
                preset: nextPreset,
                columns: nextReels.columns,
                rows: nextReels.rows,
              },
          reels: nextReels,
          ...(next.reelConfiguration
            ? {
                reelConfiguration: {
                  ...next.reelConfiguration,
                  columns: nextReels.columns,
                  rows: nextReels.rows,
                  evaluation: nextReels.evaluation,
                  spinDirection: nextReels.spinDirection,
                  ...(payload.patch.strips ? { strips: payload.patch.strips } : {}),
                  ...(payload.patch.weightsEnabled !== undefined
                    ? { weightsEnabled: payload.patch.weightsEnabled }
                    : {}),
                  ...(payload.patch.reels ? { reels: payload.patch.reels } : {}),
                },
              }
            : {}),
        };
      }
      return touchMeta(next);
    }

    case "UPDATE_PAYLINE": {
      const payload = command.payload as CommandPayloadMap["UPDATE_PAYLINE"];
      if (payload.paylineConfiguration) {
        return applyPaylineConfigurationToBlueprint(bp, payload.paylineConfiguration, {
          allowMalformed: true,
        });
      }
      let nextPaylines = bp.paylines;
      if (payload.paylines) {
        nextPaylines = payload.paylines;
      } else if (payload.paylineId && payload.patch) {
        nextPaylines = bp.paylines.map((line) =>
          line.id === payload.paylineId
            ? { ...line, ...payload.patch, id: line.id }
            : line,
        );
      }
      return touchMeta({
        ...bp,
        paylines: nextPaylines,
        ...(bp.paylineConfiguration
          ? {
              paylineConfiguration: {
                ...bp.paylineConfiguration,
                paylines: bp.paylineConfiguration.paylines.map((item) => {
                  const updated = nextPaylines.find((l) => l.id === item.id);
                  return updated
                    ? {
                        ...item,
                        pattern: [...updated.pattern],
                        active: updated.active,
                        ...(updated.color ? { color: updated.color } : {}),
                        ...(updated.name ? { name: updated.name } : {}),
                      }
                    : item;
                }),
              },
            }
          : {}),
      });
    }

    case "UPDATE_PAYTABLE": {
      const payload = command.payload as CommandPayloadMap["UPDATE_PAYTABLE"];
      return applyPaytableConfigurationToBlueprint(bp, payload.paytableConfiguration);
    }

    case "UPDATE_MATH": {
      const payload = command.payload as CommandPayloadMap["UPDATE_MATH"];
      return touchMeta({
        ...bp,
        math: { ...bp.math, ...payload.patch },
      });
    }

    case "UPDATE_FEATURE": {
      const payload = command.payload as CommandPayloadMap["UPDATE_FEATURE"];
      return touchMeta({
        ...bp,
        features: bp.features.map((feat) =>
          feat.id === payload.featureId
            ? { ...feat, ...payload.patch, id: feat.id }
            : feat,
        ),
      });
    }

    case "UPDATE_META": {
      const payload = command.payload as CommandPayloadMap["UPDATE_META"];
      return touchMeta({
        ...bp,
        meta: { ...bp.meta, ...payload.patch, id: bp.meta.id },
      });
    }

    case "UPDATE_EXPORT": {
      const payload = command.payload as CommandPayloadMap["UPDATE_EXPORT"];
      return touchMeta({
        ...bp,
        exportConfig: { ...bp.exportConfig, ...payload.patch },
      });
    }

    default:
      return bp;
  }
}
