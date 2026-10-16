"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ElementDef, StylePalette, SymbolDef } from "@/lib/blueprint/types";
import { elementImage, membersOf, symbolImage } from "@/lib/design/selectors";
import type { DesignDoc } from "@/lib/design/types";

const SIZED: CSSProperties = { containerType: "inline-size" };

/** `relative` and `absolute` conflict in Tailwind v4 (relative wins), so only add it when the caller is not absolutely positioned. */
const positioned = (className: string) => (/\babsolute\b/.test(className) ? "" : "relative");

function Img({ uri, alt }: { uri: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={uri} alt={alt} loading="lazy" draggable={false} className="artwork-checker h-full w-full object-contain" />;
}

/** Symbol face: linked artwork, otherwise a deterministic glyph tile from the blueprint palette. */
export function SymbolThumb({ doc, symbol, palette, className = "" }: {
  doc: DesignDoc; symbol: SymbolDef; palette: StylePalette; className?: string;
}) {
  const asset = symbolImage(doc, symbol);
  return (
    <div className={`${positioned(className)} overflow-hidden ${className}`} style={SIZED}>
      {asset ? (
        <Img uri={asset.uri} alt={symbol.name} />
      ) : (
        <div className="absolute inset-0 grid place-items-center" role="img" aria-label={`${symbol.name} placeholder`}
          style={{ background: `radial-gradient(110% 100% at 50% 0%, ${palette.accent}33, ${palette.surface} 60%, ${palette.background})`, boxShadow: `inset 0 0 0 1px ${palette.accent}22` }}>
          <span className={symbol.tier === "low" ? "font-serif font-bold" : "font-semibold"}
            style={{ color: symbol.tier === "special" ? palette.accentAlt : palette.glow, fontSize: symbol.glyph.length > 2 ? "22cqw" : "46cqw", lineHeight: 1 }}>
            {symbol.glyph}
          </span>
        </div>
      )}
    </div>
  );
}

/** Blueprint-derived stand-in shown until artwork is linked. */
function Placeholder({ element, palette, title }: { element: ElementDef; palette: StylePalette; title: string }) {
  const bg = `radial-gradient(110% 90% at 50% 0%, ${palette.accent}2e, ${palette.surface} 55%, ${palette.background})`;
  switch (element.type) {
    case "game_title":
      return (
        <div className="absolute inset-0 grid place-items-center px-3 text-center" style={{ background: bg }}>
          <span className="line-clamp-3 text-[17px] leading-tight font-extrabold tracking-wide" style={{ color: palette.accent, textShadow: `0 0 18px ${palette.glow}55` }}>{title}</span>
        </div>
      );
    case "reel_frame":
      return (
        <div className="absolute inset-0 grid place-items-center p-5" style={{ background: bg }}>
          <div className="aspect-[5/3] w-full rounded-lg border-[3px]" style={{ borderColor: palette.accent, boxShadow: `0 0 22px ${palette.accent}44, inset 0 0 18px ${palette.background}` }} />
        </div>
      );
    case "game_background":
      return <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${palette.accent}55, ${palette.surface} 45%, ${palette.accentAlt}44), ${palette.background}` }} />;
    case "button_set": {
      const labels = String(element.params.buttons ?? "spin").split(",");
      return (
        <div className="absolute inset-0 grid place-items-center p-3" style={{ background: bg }}>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {labels.map((label) => (
              <span key={label} className="rounded-full px-2.5 py-1 text-[9px] font-semibold tracking-wider uppercase" style={{ background: palette.accent, color: palette.background }}>{label}</span>
            ))}
          </div>
        </div>
      );
    }
    default:
      return (
        <div className="absolute inset-0 grid place-items-center text-ink-400" style={{ background: bg }}>
          <Icon name="image" size={28} />
        </div>
      );
  }
}

export function ElementThumb({ doc, element, palette, title, className = "" }: {
  doc: DesignDoc; element: ElementDef; palette: StylePalette; title: string; className?: string;
}) {
  const members = element.type === "symbol_set" ? membersOf(doc, element) : [];
  if (element.type === "symbol_set") {
    const shown = members.slice(0, 4);
    return (
      <div className={`${positioned(className)} overflow-hidden ${className}`} style={{ background: `radial-gradient(110% 90% at 50% 0%, ${palette.accent}22, ${palette.background})` }}>
        {shown.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-ink-400"><Icon name="layers" size={28} /></div>
        ) : (
          <div className={`absolute inset-2 grid gap-1.5 ${shown.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {shown.map((symbol) => <SymbolThumb key={symbol.id} doc={doc} symbol={symbol} palette={palette} className="rounded-md" />)}
          </div>
        )}
      </div>
    );
  }
  if (element.type === "symbol") {
    const symbol = doc.symbols.find((s) => s.id === element.symbolIds[0]);
    return (
      <div className={`${positioned(className)} overflow-hidden ${className}`} style={{ background: palette.background }}>
        {symbol ? <SymbolThumb doc={doc} symbol={symbol} palette={palette} className="absolute inset-0" /> : <Placeholder element={element} palette={palette} title={title} />}
      </div>
    );
  }
  const image = elementImage(doc, element);
  return (
    <div className={`${positioned(className)} overflow-hidden ${className}`} style={{ background: palette.background }}>
      {image ? <Img uri={image.uri} alt={element.name} /> : <Placeholder element={element} palette={palette} title={title} />}
    </div>
  );
}
