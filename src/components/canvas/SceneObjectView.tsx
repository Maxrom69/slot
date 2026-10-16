"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import type { GameBlueprint, SceneObject, StylePalette } from "@/lib/blueprint/types";
import { isLinked } from "@/lib/design/model";

export interface Resolvers {
  symbols: Map<string, GameBlueprint["symbols"][number]>;
  elements: Map<string, GameBlueprint["elements"][number]>;
  assets: Map<string, GameBlueprint["assets"][number]>;
  animations: Map<string, GameBlueprint["animations"][number]>;
}

export function buildResolvers(bp: GameBlueprint): Resolvers {
  return {
    symbols: new Map(bp.symbols.map((s) => [s.id, s])),
    elements: new Map(bp.elements.map((e) => [e.id, e])),
    assets: new Map(bp.assets.map((a) => [a.id, a])),
    animations: new Map((bp.animations ?? []).map((a) => [a.id, a])),
  };
}

const wrap = (object: SceneObject): CSSProperties => ({
  position: "absolute",
  left: object.x,
  top: object.y,
  width: object.width,
  height: object.height,
  transform: object.rotation ? `rotate(${object.rotation}deg)` : undefined,
  opacity: object.opacity,
  filter: object.blur > 0 ? `blur(${object.blur}px)` : undefined,
  mixBlendMode: object.blendMode && object.blendMode !== "normal" ? (object.blendMode as CSSProperties["mixBlendMode"]) : undefined,
  pointerEvents: "none",
});

/** Deterministic stand-in for a symbol or element that has no artwork yet. */
function Placeholder({ object, palette, resolvers }: { object: SceneObject; palette: StylePalette; resolvers: Resolvers }) {
  const bg = `radial-gradient(110% 90% at 50% 0%, ${palette.accent}2e, ${palette.surface} 55%, ${palette.background})`;
  if (object.kind === "animation") {
    const anim = resolvers.animations.get(object.animationId ?? object.refId ?? "");
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center overflow-hidden p-2 text-center"
        style={{
          background: bg,
          boxShadow: `inset 0 0 0 2px ${palette.accent}66, 0 0 18px ${palette.glow}33`,
        }}
      >
        <Icon name="play" size={Math.max(14, Math.min(object.width, object.height) * 0.22)} />
        <span className="mt-1 max-w-full truncate font-bold text-ink-100" style={{ fontSize: Math.max(10, Math.min(object.height * 0.14, 18)) }}>
          {anim?.name ?? object.name}
        </span>
        <span className="mt-0.5 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[9.5px] text-ink-300">
          {anim?.animationType ?? "Standalone"} · {anim?.fps ?? 24}fps · {anim?.format ?? "css"}
        </span>
      </div>
    );
  }
  if (object.kind === "symbol") {
    const symbol = object.refId ? resolvers.symbols.get(object.refId) : undefined;
    return (
      <div className="grid h-full w-full place-items-center overflow-hidden" style={{ background: bg, boxShadow: `inset 0 0 0 1px ${palette.accent}33` }}>
        <span style={{ color: symbol?.tier === "special" ? palette.accentAlt : palette.glow, fontSize: Math.min(object.width, object.height) * 0.55, lineHeight: 1, fontWeight: 700 }}>
          {symbol?.glyph ?? "◆"}
        </span>
      </div>
    );
  }
  const element = object.refId ? resolvers.elements.get(object.refId) : undefined;
  const type = element?.type ?? "other_asset";
  if (type === "game_title") {
    return (
      <div className="grid h-full w-full place-items-center overflow-hidden px-2 text-center" style={{ background: bg }}>
        <span className="truncate font-extrabold" style={{ color: palette.accent, fontSize: Math.min(object.height * 0.5, 64), textShadow: `0 0 18px ${palette.glow}55` }}>
          {element?.name ?? object.name}
        </span>
      </div>
    );
  }
  if (type === "reel_frame") {
    return (
      <div className="grid h-full w-full place-items-center overflow-hidden" style={{ background: bg }}>
        <div className="h-[78%] w-[78%] rounded-lg" style={{ border: `3px solid ${palette.accent}`, boxShadow: `0 0 22px ${palette.accent}44, inset 0 0 18px ${palette.background}` }} />
      </div>
    );
  }
  if (type === "game_background") {
    return <div className="h-full w-full" style={{ background: `linear-gradient(160deg, ${palette.accent}55, ${palette.surface} 45%, ${palette.accentAlt}44)` }} />;
  }
  if (type === "button_set") {
    const labels = String(element?.params.buttons ?? "spin").split(",");
    return (
      <div className="grid h-full w-full place-items-center overflow-hidden" style={{ background: bg }}>
        <div className="flex flex-wrap items-center justify-center gap-1 p-2">
          {labels.slice(0, 4).map((label) => (
            <span key={label} className="rounded-full px-2 py-0.5 font-semibold uppercase" style={{ background: palette.accent, color: palette.background, fontSize: Math.max(8, object.height * 0.22) }}>
              {label}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden" style={{ background: bg, color: palette.glow }}>
      <Icon name="image" size={Math.min(object.width, object.height) * 0.4} />
    </div>
  );
}

function Shape({ object }: { object: SceneObject }) {
  const { width, height } = object;
  const common = {
    fill: object.fill ?? "none",
    stroke: object.stroke ?? "none",
    strokeWidth: object.strokeWidth,
  };
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
      {object.shape === "ellipse" ? <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common} />
        : object.shape === "triangle" ? <polygon points={`${width / 2},0 ${width},${height} 0,${height}`} {...common} />
          : <rect x={object.strokeWidth / 2} y={object.strokeWidth / 2} width={Math.max(0, width - object.strokeWidth)} height={Math.max(0, height - object.strokeWidth)} rx={object.radius} {...common} />}
    </svg>
  );
}

function Stroke({ object }: { object: SceneObject }) {
  const { width, height } = object;
  const points = object.points.length >= 2 ? object.points : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const path = points.map((p) => `${p.x * width},${p.y * height}`).join(" ");
  const last = points[points.length - 1];
  const prev = points[points.length - 2] ?? { x: last.x - 1, y: last.y };
  const angle = (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI;
  const head = Math.max(8, object.strokeWidth * 4);
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
      {object.points.length > 2 ? (
        <polyline points={path} fill="none" stroke={object.stroke ?? "#fff"} strokeWidth={object.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <line x1={points[0].x * width} y1={points[0].y * height} x2={last.x * width} y2={last.y * height} stroke={object.stroke ?? "#fff"} strokeWidth={object.strokeWidth} strokeLinecap="round" />
      )}
      {object.arrow ? (
        <polygon
          points={`0,${-head / 2} ${head},0 0,${head / 2}`}
          fill={object.stroke ?? "#fff"}
          transform={`translate(${last.x * width},${last.y * height}) rotate(${angle})`}
        />
      ) : null}
    </svg>
  );
}

function Text({ object, palette }: { object: SceneObject; palette: StylePalette }) {
  return (
    <div
      className="grid h-full w-full overflow-hidden"
      style={{
        justifyContent: object.align === "center" ? "center" : object.align === "right" ? "flex-end" : "flex-start",
        alignItems: "center",
        color: object.fill ?? palette.text,
        fontSize: object.fontSize,
        fontWeight: object.fontWeight,
        textAlign: object.align,
        lineHeight: 1.15,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {object.text ?? ""}
    </div>
  );
}

/** Renders one object from scene layout data. No object is hardcoded here. */
export function SceneObjectView({ object, blueprint, resolvers }: { object: SceneObject; blueprint: GameBlueprint; resolvers: Resolvers }) {
  if (object.kind === "group") return null;

  const palette = blueprint.style.palette;
  const fallbackAssetId =
    object.kind === "element" && object.refId
      ? (resolvers.elements.get(object.refId)?.assetId ?? null)
      : object.kind === "symbol" && object.refId
      ? (resolvers.symbols.get(object.refId)?.assetId ?? null)
      : null;
  const resolvedAssetId = object.assetId ?? fallbackAssetId;
  const linked = resolvedAssetId ? resolvers.assets.get(resolvedAssetId) : null;
  const art = isLinked(linked) ? linked.uri : null;

  return (
    <div data-object-id={object.id} style={wrap(object)}>
      {object.kind === "shape" ? <Shape object={object} />
        : object.kind === "stroke" ? <Stroke object={object} />
          : object.kind === "text" ? <Text object={object} palette={palette} />
            : art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={art} alt={object.name} draggable={false} className="artwork-checker h-full w-full object-contain" />
              )
                : <Placeholder object={object} palette={palette} resolvers={resolvers} />}
    </div>
  );
}
