"use client";

import { Icon } from "@/components/ui/Icon";
import { elementTypeMeta } from "@/lib/blueprint/elements";
import type { GameBlueprint, LayerDef, SceneObject } from "@/lib/blueprint/types";
import { isLinked } from "@/lib/design/model";
import { membersOf } from "@/lib/design/selectors";
import type { CanvasPrefs } from "./CanvasStage";

interface Props {
  blueprint: GameBlueprint;
  layers: LayerDef[];
  objects: SceneObject[];
  sceneId: string;
  scenes: Array<{ id: string; name: string; kind: string }>;
  selection: string[];
  prefs: CanvasPrefs;
  onScene: (id: string) => void;
  onLayer: (id: string, patch: Partial<Pick<LayerDef, "visible" | "locked" | "opacity">>) => void;
  onPlace: (kind: "symbol" | "element" | "animation", id: string) => void;
  onSelectObject: (id: string) => void;
  onPrefs: (patch: Partial<CanvasPrefs>) => void;
}

export function ScenePanel(p: Props) {
  const symbolOptions = p.blueprint.symbols.slice(0, 40);
  const elementOptions = p.blueprint.elements;
  const animationOptions = p.blueprint.animations ?? [];
  const displayLayers = [...p.layers].sort((a, b) => Number(a.locked) - Number(b.locked) || a.order - b.order);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <section>
        <h2 className="mb-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Scene</h2>
        <div className="space-y-0.5">
          {p.scenes.map((scene) => (
            <button key={scene.id} type="button" aria-pressed={scene.id === p.sceneId} onClick={() => p.onScene(scene.id)}
              className={`focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] transition ${
                scene.id === p.sceneId ? "bg-white/[0.07] text-ink-100" : "text-ink-300 hover:bg-white/5 hover:text-ink-100"
              }`}>
              <span className="truncate">{scene.name}</span>
              <span className="shrink-0 font-mono text-[9.5px] text-ink-400">
                {(scene.id === p.sceneId ? p.objects.length : p.blueprint.scenes.find((s) => s.id === scene.id)?.objects?.length ?? 0)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Layers Overview</h2>
        <ul className="space-y-1">
          {displayLayers.map((layer) => {
            const count = p.objects.filter((o) => o.layerId === layer.id).length;
            return (
              <li key={layer.id} className="rounded-md border border-white/[0.06] bg-white/[0.015] px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`} aria-pressed={layer.visible}
                    onClick={() => p.onLayer(layer.id, { visible: !layer.visible })}
                    className="focus-ring rounded p-0.5 text-ink-300 hover:text-ink-100">
                    <Icon name={layer.visible ? "check" : "x"} size={12} />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-200">{layer.name}</span>
                  <span className="font-mono text-[9.5px] text-ink-400">{count}</span>
                  <button type="button" aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`} aria-pressed={layer.locked}
                    onClick={() => p.onLayer(layer.id, { locked: !layer.locked })}
                    className="focus-ring rounded p-0.5 text-ink-400 hover:text-ink-100">
                    <Icon name={layer.locked ? "lock" : "pointer"} size={12} />
                  </button>
                </div>
                <label className="mt-1 flex items-center gap-1.5 text-[9.5px] text-ink-400">
                  Opacity
                  <input type="range" min={0} max={1} step={0.05} value={layer.opacity} disabled={!layer.visible}
                    aria-label={`${layer.name} opacity`} onChange={(event) => p.onLayer(layer.id, { opacity: Number(event.target.value) })}
                    className="h-1 flex-1 accent-blue-500" />
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Place on canvas</h2>
        <p className="mb-1.5 text-[10px] leading-relaxed text-ink-400">Adds an instance of an existing symbol or element to the scene layout.</p>
        <div className="flex flex-wrap gap-1">
          {symbolOptions.map((symbol) => (
            <button key={symbol.id} type="button" onClick={() => p.onPlace("symbol", symbol.id)} title={`Place ${symbol.name}`}
              className="focus-ring grid h-8 w-8 place-items-center rounded-md border border-white/10 bg-ink-850 text-[15px] text-ink-200 transition hover:border-white/25">
              {symbol.glyph}
            </button>
          ))}
        </div>
        <ul className="mt-2 space-y-0.5">
          {elementOptions.map((element) => (
            <li key={element.id}>
              <button type="button" onClick={() => p.onPlace("element", element.id)}
                className="focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11.5px] text-ink-300 transition hover:bg-white/5 hover:text-ink-100">
                <span className="truncate">{element.name}</span>
                <span className="shrink-0 text-[9px] text-ink-400">{elementTypeMeta(element.type).label}</span>
              </button>
            </li>
          ))}
        </ul>
        {animationOptions.length > 0 ? (
          <div className="mt-3 border-t border-white/[0.06] pt-2.5">
            <h3 className="mb-1 text-[9px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
              Animations (Standalone Layers)
            </h3>
            <ul className="space-y-0.5">
              {animationOptions.map((anim) => (
                <li key={anim.id}>
                  <button
                    type="button"
                    data-testid={`place-animation-${anim.id}`}
                    onClick={() => p.onPlace("animation", anim.id)}
                    className="focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] text-ink-300 transition hover:bg-white/5 hover:text-ink-100"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <Icon name="play" size={10} className="shrink-0 text-accent-400" />
                      <span className="truncate">{anim.name ?? `${anim.target} (${anim.kind})`}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-ink-400">
                      {anim.animationType ?? anim.trigger}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Objects</h2>
        {p.objects.length === 0 ? (
          <p className="text-[10.5px] text-ink-400">Nothing on this scene yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {[...p.objects].reverse().map((object) => (
              <li key={object.id}>
                <button type="button" onClick={() => p.onSelectObject(object.id)} aria-current={p.selection.includes(object.id)}
                  className={`focus-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition ${
                    p.selection.includes(object.id) ? "bg-white/[0.07] text-ink-100" : "text-ink-300 hover:bg-white/5 hover:text-ink-100"
                  }`}>
                  <Icon name={object.kind === "text" ? "text" : object.kind === "shape" ? "square" : object.kind === "stroke" ? "line" : "image"} size={11} className="shrink-0 text-ink-400" />
                  <span className="min-w-0 flex-1 truncate">{object.name}</span>
                  {!object.visible ? <Icon name="x" size={10} className="shrink-0 text-ink-400" /> : null}
                  {object.locked ? <Icon name="lock" size={10} className="shrink-0 text-ink-400" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-auto rounded-md border border-white/[0.06] p-2.5">
        <h2 className="mb-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Grid</h2>
        <label className="flex items-center gap-2 text-[10.5px] text-ink-300">
          Spacing
          <input type="range" min={8} max={200} step={4} value={p.prefs.gridSize} aria-label="Grid spacing"
            onChange={(event) => p.onPrefs({ gridSize: Number(event.target.value) })} className="h-1 flex-1 accent-blue-500" />
          <span className="w-10 text-right font-mono">{p.prefs.gridSize}px</span>
        </label>
        <label className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-300">
          <input type="checkbox" checked={p.prefs.gridSnap} onChange={(event) => p.onPrefs({ gridSnap: event.target.checked })} className="accent-blue-500" />
          Snap objects to the grid
        </label>
      </section>
    </div>
  );
}

export const hasArtwork = (bp: GameBlueprint, assetId: string | null) => {
  const asset = assetId ? bp.assets.find((a) => a.id === assetId) : null;
  return isLinked(asset);
};

export const membersOfSet = membersOf;
