"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { getElementAnimations } from "@/lib/animations";
import { elementTypeMeta } from "@/lib/blueprint/elements";
import type { ElementDef, StylePalette, SymbolDef } from "@/lib/blueprint/types";
import type { BlueprintValidation } from "@/lib/blueprint/validate";
import { ASPECTS, BUTTONS, FRAME_STYLES } from "@/lib/creation/draft";
import { SET_TYPES, VALUE_TIERS, valueOfTier } from "@/lib/design/model";
import { assetOf, elementImage, elementStatus, findElement, findSymbol, membersOf, symbolImage } from "@/lib/design/selectors";
import type { DesignDoc, Selection } from "@/lib/design/types";
import type { DesignActions } from "./actions";
import { SetTypeBadge, StatusBadge, TierBadge, TypeBadge } from "./Badges";
import { CommitInput, CommitTextArea } from "./CommitInput";
import { ExtrasEditor, TagsInput } from "./ElementFields";
import { ElementThumb, SymbolThumb } from "./Thumb";

const RESERVED = "Reserved — AI features are not part of this version.";

interface Props {
  doc: DesignDoc;
  palette: StylePalette;
  paletteName: string;
  title: string;
  canvas: { width: number; height: number };
  referenceUri: string | null;
  selection: Selection;
  check: BlueprintValidation;
  actions: DesignActions;
  focusNonce: number;
  open: boolean;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-4">
      <h3 className="mb-2.5 text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-400">{label}</dt>
          <dd className="min-w-0 truncate text-right text-ink-200" title={typeof value === "string" ? value : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReservedAi() {
  return (
    <div className="rounded-lg border border-dashed border-white/10 p-3">
      <p className="text-[9.5px] font-semibold tracking-[0.14em] text-ink-400 uppercase">AI actions · reserved</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {["Regenerate image", "Generate variations"].map((label) => (
          <button key={label} type="button" disabled title={RESERVED}
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-white/[0.07] px-2 py-1 text-[10.5px] text-ink-400/60">
            <Icon name="sparkles" size={12} />{label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-400">Not available in this version. Everything in the studio works without AI.</p>
    </div>
  );
}

function ImageControls({ hasImage, name, actions, target }: {
  hasImage: boolean; name: string | null; actions: DesignActions; target: { kind: "element" | "symbol"; id: string };
}) {
  return (
    <>
      <p className="text-[11px] text-ink-300">{hasImage ? <>Linked: <span className="text-ink-100">{name}</span></> : "No image linked yet."}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.replaceImage(target)}><Icon name="replace" size={13} />{hasImage ? "Replace image" : "Add image"}</Button>
        <Button className="h-7 px-2.5 text-[11px]" disabled={!hasImage} onClick={() => actions.removeImage(target)}><Icon name="x" size={13} />Remove</Button>
        <Button className="h-7 px-2.5 text-[11px]" disabled={!hasImage} onClick={() => actions.download(target)}><Icon name="download" size={13} />Download</Button>
      </div>
    </>
  );
}

function ElementPanel({ element, p, nameRef }: { element: ElementDef; p: Props; nameRef: React.RefObject<HTMLInputElement | null> }) {
  const { doc, actions } = p;
  const isSet = element.type === "symbol_set";
  const members = membersOf(doc, element);
  const image = elementImage(doc, element);
  const meta = elementTypeMeta(element.type);
  const buttons = String(element.params.buttons ?? "spin").split(",").filter(Boolean);
  const symbol = element.type === "symbol" ? doc.symbols.find((s) => s.id === element.symbolIds[0]) : undefined;
  const setParams = (params: Record<string, string | number>, label: string) => actions.updateElement(element.id, { params }, label);

  return (
    <div className="space-y-4">
      <ElementThumb doc={doc} element={element} palette={p.palette} title={p.title} className="aspect-[5/4] w-full rounded-lg border border-white/10" />
      <Field label="Name"><CommitInput value={element.name} label="Element name" inputRef={nameRef} onCommit={(name) => actions.rename(element.id, name)} /></Field>
      <div className="flex flex-wrap items-center gap-1.5">
        {isSet ? (
          <>
            <SetTypeBadge type={element.symbolSet?.symbolType ?? "custom"} />
            <TierBadge tier={element.symbolSet?.valueTier ?? "medium"} />
          </>
        ) : <TypeBadge element={element} />}
        <StatusBadge status={elementStatus(doc, element)} />
      </div>

      {isSet ? (
        <Section title="Symbol set">
          <Field label="Symbol type">
            <Select aria-label="Symbol type" className="creation-input" value={element.symbolSet?.symbolType ?? "custom"}
              onChange={(e) => actions.updateElement(element.id, { symbolSet: { symbolType: e.target.value as never } }, `Change symbol type of ${element.name}`)}>
              {SET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Value tier">
            <Select aria-label="Value tier" className="creation-input" value={element.symbolSet?.valueTier ?? "medium"}
              onChange={(e) => actions.updateElement(element.id, { symbolSet: { valueTier: e.target.value as never } }, `Change value tier of ${element.name}`)}>
              {VALUE_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
          <Facts rows={[["ID", element.id], ["Symbols", String(members.length)], ["With artwork", `${members.filter((s) => symbolImage(doc, s)).length} of ${members.length}`]]} />
          <Field label="Style guide">
            <CommitTextArea value={element.symbolSet?.styleGuide ?? ""} label="Style guide" placeholder="Visual style rules for this symbol set"
              onCommit={(styleGuide) => actions.updateElement(element.id, { symbolSet: { styleGuide } }, `Update style guide of ${element.name}`)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.addSymbol(element.id)}><Icon name="plus" size={13} />Add symbol</Button>
            <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.manageSet(element.id)}><Icon name="settings" size={13} />Manage set</Button>
            <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.importIntoSet(element.id)}><Icon name="upload" size={13} />Import images</Button>
            <Button className="h-7 px-2.5 text-[11px]" disabled={!members.some((s) => symbolImage(doc, s))} title="Download every symbol image as a .zip" onClick={() => actions.download({ kind: "element", id: element.id })}><Icon name="package" size={13} />Download .zip</Button>
          </div>
        </Section>
      ) : (
        <Section title="Image">
          <ImageControls hasImage={Boolean(image)} name={image?.name ?? null} actions={actions} target={{ kind: "element", id: element.id }} />
        </Section>
      )}

      {element.type === "symbol" && symbol ? (
        <Section title="Symbol">
          <Facts rows={[
            ["Symbol ID", symbol.id],
            ["Math ID", symbol.mathId ?? symbol.code],
            ["Wild / Scatter", `${symbol.isWild ? "Wild" : "—"} · ${symbol.isScatter ? "Scatter" : "—"}`],
            ["Variants", String((symbol.variants ?? []).length)],
          ]} />
          {symbol.tier === "special" ? (
            <Facts rows={[["Behaviour", doc.specialSymbols.find((s) => s.symbolId === symbol.id)?.behaviour ?? "special"], ["Code", symbol.code]]} />
          ) : (
            <Field label="Value tier">
              <Select aria-label="Symbol value tier" className="creation-input" value={valueOfTier(symbol.tier)}
                onChange={(e) => actions.setSymbolTier(symbol.id, e.target.value as never)}>
                {VALUE_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.openSymbol?.(symbol.id)}><Icon name="settings" size={13} />Edit symbol</Button>
          </div>
        </Section>
      ) : null}

      {element.type === "reel_frame" ? (
        <Section title="Frame">
          <Field label="Style">
            <Select aria-label="Frame style" className="creation-input" value={String(element.params.style ?? "Themed")}
              onChange={(e) => setParams({ style: e.target.value }, `Change frame style of ${element.name}`)}>
              {FRAME_STYLES.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
            </Select>
          </Field>
        </Section>
      ) : null}
      {element.type === "game_background" ? (
        <Section title="Background">
          <Field label="Aspect ratio">
            <Select aria-label="Aspect ratio" className="creation-input" value={String(element.params.aspect ?? "16:9")}
              onChange={(e) => setParams({ aspect: e.target.value }, `Change aspect of ${element.name}`)}>
              {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.hint}</option>)}
            </Select>
          </Field>
        </Section>
      ) : null}
      {element.type === "button_set" ? (
        <Section title="Buttons">
          <div className="flex flex-wrap gap-1.5">
            {BUTTONS.map((b) => {
              const on = buttons.includes(b.id);
              return (
                <button key={b.id} type="button" aria-pressed={on} disabled={b.required}
                  title={b.required ? "Spin is required" : undefined}
                  onClick={() => {
                    const next = on ? buttons.filter((x) => x !== b.id) : [...buttons, b.id];
                    setParams({ buttons: next.join(","), count: next.length }, `Change buttons of ${element.name}`);
                  }}
                  className={`focus-ring rounded-md border px-2 py-1 text-[10.5px] transition disabled:cursor-not-allowed ${on ? "border-accent-500/40 bg-accent-500/[0.12] text-blue-200" : "border-white/10 text-ink-300 hover:text-ink-100"}`}>
                  {b.label}
                </button>
              );
            })}
          </div>
        </Section>
      ) : null}
      {element.type === "other_asset" || element.type === "uploaded" || element.type === "custom" || element.type === "game_title" ? (
        <Section title="Organisation">
          <Field label="Group"><CommitInput value={element.group} label="Group" maxLength={60} onCommit={(group) => actions.updateElement(element.id, { group }, `Change group of ${element.name}`)} /></Field>
        </Section>
      ) : null}

      {element.type === "custom" ? (
        <Section title="Custom parameters">
          <ExtrasEditor value={element.params}
            onCommit={(next) => {
              const params: Record<string, string | number> = {};
              for (const [k, v] of Object.entries(next)) params[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
              actions.updateElement(element.id, { params }, `Edit parameters of ${element.name}`);
            }} />
        </Section>
      ) : null}

      <Section title="Metadata">
        {!isSet ? <Facts rows={[["ID", element.id]]} /> : null}
        <Field label="Description">
          <CommitTextArea value={isSet ? (element.symbolSet?.description ?? element.description ?? "") : (element.description ?? "")}
            label="Element description" placeholder="Description for this element"
            onCommit={(description) => actions.updateElement(
              element.id,
              isSet ? { description, symbolSet: { description } } : { description },
              `Edit description of ${element.name}`,
            )} />
        </Field>
        <Field label="Tags">
          <TagsInput value={isSet ? (element.symbolSet?.tags ?? element.tags ?? []) : (element.tags ?? [])}
            label={`Tags of ${element.name}`}
            onCommit={(tags) => actions.updateElement(
              element.id,
              isSet ? { tags, symbolSet: { tags } } : { tags },
              `Edit tags of ${element.name}`,
            )} />
        </Field>
      </Section>

      <Section title="Animation">
        <Facts rows={[["Configured animations", String(getElementAnimations(doc, element.id).length)]]} />
        <Field label="Animation Extra">
          <CommitTextArea
            value={element.animationExtra ?? ""}
            label="Animation Extra"
            placeholder="Animation Extra notes or parameters for this element"
            onCommit={(animationExtra) =>
              actions.updateElement(element.id, { animationExtra }, `Update Animation Extra of ${element.name}`)
            }
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.open(element.id)}>
            <Icon name="play" size={12} />
            Open Animation Panel
          </Button>
        </div>
      </Section>

      <Section title="Notes">
        <CommitTextArea value={element.notes} label="Notes" placeholder="Notes for your team" onCommit={(notes) => actions.updateElement(element.id, { notes }, `Edit notes of ${element.name}`)} />
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.open(element.id)}><Icon name="maximize" size={13} />Open detail</Button>
          <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.duplicate(element.id)}><Icon name="copy" size={13} />Duplicate</Button>
          <Button variant="danger" className="h-7 px-2.5 text-[11px]" onClick={() => actions.requestDelete({ kind: "element", id: element.id })}><Icon name="trash" size={13} />Delete</Button>
        </div>
        <p className="text-[10px] text-ink-400">{meta.description}</p>
        <ReservedAi />
      </Section>
    </div>
  );
}

function SymbolPanel({ symbol, owner, p, nameRef }: { symbol: SymbolDef; owner: ElementDef | null; p: Props; nameRef: React.RefObject<HTMLInputElement | null> }) {
  const { doc, actions } = p;
  const image = symbolImage(doc, symbol);
  const target = { kind: "symbol" as const, id: symbol.id };
  return (
    <div className="space-y-4">
      <SymbolThumb doc={doc} symbol={symbol} palette={p.palette} className="mx-auto aspect-square w-3/4 rounded-xl border border-white/10" />
      <Field label="Symbol name"><CommitInput value={symbol.name} label="Symbol name" inputRef={nameRef} onCommit={(name) => actions.renameSymbol(symbol.id, name)} /></Field>
      <div className="flex flex-wrap items-center gap-1.5">
        {owner?.symbolSet ? <SetTypeBadge type={owner.symbolSet.symbolType} /> : null}
        <TierBadge tier={valueOfTier(symbol.tier)} />
      </div>
      <Section title="Image">
        <ImageControls hasImage={Boolean(image)} name={image?.name ?? null} actions={actions} target={target} />
      </Section>
      <Section title="Configuration">
        <Facts rows={[
          ["ID", symbol.id],
          ["Code", symbol.code],
          ["Math ID", symbol.mathId ?? "—"],
          ["Belongs to", owner?.name ?? "Standalone"],
          ["Wild / Scatter", `${symbol.isWild ? "Wild" : "—"} · ${symbol.isScatter ? "Scatter" : "—"}`],
          ["Variants", String((symbol.variants ?? []).length)],
          ["Payouts", Object.entries(symbol.payouts).map(([k, v]) => `${k}× ${v}`).join(" · ")],
          ["Reel weight", String(symbol.reelWeight)],
        ]} />
        <p className="text-[10px] leading-relaxed text-ink-400">Payouts, reel weights, mathId and Wild/Scatter flags are declarative configuration evaluated only by the backend engine.</p>
      </Section>
      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.openSymbol?.(symbol.id)}><Icon name="settings" size={13} />Edit symbol</Button>
          <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.duplicateSymbol(symbol.id)}><Icon name="copy" size={13} />Duplicate symbol</Button>
          {owner ? <Button className="h-7 px-2.5 text-[11px]" onClick={() => actions.open(owner.id)}><Icon name="maximize" size={13} />Open set</Button> : null}
          <Button variant="danger" className="h-7 px-2.5 text-[11px]" onClick={() => actions.requestDelete({ kind: "symbol", id: symbol.id })}><Icon name="trash" size={13} />Delete symbol</Button>
        </div>
      </Section>
    </div>
  );
}

function ProjectPanel({ p }: { p: Props }) {
  const failing = p.check.checks.filter((c) => !c.ok);
  const reference = p.referenceUri;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-semibold text-ink-100">Project overview</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-400">Select an element or symbol to inspect and edit it.</p>
      </div>
      <Facts rows={[
        ["Palette", p.paletteName],
        ["Canvas", `${p.canvas.width} × ${p.canvas.height}`],
        ["Elements", String(p.doc.elements.length)],
        ["Symbols", String(p.doc.symbols.length)],
        ["Images linked", String(p.doc.assets.filter((a) => a.state === "linked").length)],
      ]} />
      <div className="flex gap-1.5" aria-label="Palette">
        {Object.entries(p.palette).slice(0, 5).map(([key, color]) => <span key={key} title={key} className="h-5 flex-1 rounded border border-white/10" style={{ background: color }} />)}
      </div>
      <Section title="Blueprint check">
        <p className={`flex items-center gap-1.5 text-[11px] ${p.check.ok ? "text-emerald-300" : p.check.integrityOk ? "text-amber-200" : "text-rose-300"}`}>
          <Icon name={p.check.ok ? "shield" : "info"} size={14} />
          {p.check.ok ? "Blueprint structure is valid" : p.check.integrityOk ? "Valid so far — unfinished items below" : "Needs attention"}
        </p>
        {failing.length > 0 ? <ul className="space-y-1 text-[10.5px] leading-relaxed text-ink-300">{failing.map((c) => <li key={c.id}>• {c.label}: {c.detail}</li>)}</ul> : null}
      </Section>
      {reference ? (
        <Section title="Style reference">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={reference} alt="Style reference" className="w-full rounded-lg border border-white/10" />
        </Section>
      ) : null}
    </div>
  );
}

export function Inspector(p: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const element = p.selection ? findElement(p.doc, p.selection.kind === "element" ? p.selection.id : p.selection.elementId) : null;
  const found = p.selection?.kind === "symbol" ? findSymbol(p.doc, p.selection.id) : null;

  useEffect(() => {
    if (p.focusNonce > 0) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [p.focusNonce]);

  void assetOf;
  return (
    <aside aria-label="Inspector"
      className={`fixed inset-y-0 right-0 z-40 flex w-[340px] max-w-[92vw] flex-col border-l border-white/[0.07] bg-ink-900 shadow-2xl shadow-black/60 transition-transform xl:static xl:z-auto xl:translate-x-0 xl:shadow-none ${p.open ? "translate-x-0" : "invisible translate-x-full xl:visible"}`}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <h2 className="text-[10.5px] font-semibold tracking-[0.16em] text-ink-300 uppercase">Inspector</h2>
        <button type="button" onClick={p.onClose} aria-label="Close inspector" className="focus-ring rounded-md p-1.5 text-ink-400 hover:text-ink-100 xl:hidden"><Icon name="x" size={15} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {p.selection?.kind === "symbol" && found ? <SymbolPanel key={found.symbol.id} symbol={found.symbol} owner={found.owner} p={p} nameRef={nameRef} />
          : element ? <ElementPanel key={element.id} element={element} p={p} nameRef={nameRef} />
            : <ProjectPanel p={p} />}
      </div>
    </aside>
  );
}
