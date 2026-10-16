"use client";

import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { NumberField } from "@/components/creation/fields";
import type { BlendMode, LayerDef, SceneObject } from "@/lib/blueprint/types";
import type { AlignMode } from "@/lib/canvas/operations";
import { clean } from "@/lib/canvas/geometry";
import { CommitInput } from "@/components/design/CommitInput";
import { BLEND_MODES } from "@/lib/canvas/parse";

interface Props {
  objects: SceneObject[];
  layers: LayerDef[];
  selection: string[];
  background?: { color: string | null; assetId: string | null };
  defaultBackgroundColor?: string;
  onBackgroundColorChange?: (color: string | null) => void;
  onChange: (ids: string[], patch: Partial<SceneObject>, label: string, coalesceKey?: string) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
  onOrder: (order: "front" | "forward" | "backward" | "back") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSelectGroup?: (groupId: string) => void;
  onUngroup?: (groupIds: string[]) => void;
  onClose: () => void;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-3.5">
      <h3 className="mb-2 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">{title}</h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="color" aria-label={label} value={value ?? "#ffffff"} disabled={!value} onChange={(event) => onChange(event.target.value)}
        className="h-7 w-8 shrink-0 rounded border border-white/10 bg-transparent" />
      <input value={value ?? "none"} aria-label={`${label} value`} onChange={(event) => onChange(event.target.value || null)}
        className="focus-ring min-w-0 flex-1 rounded-md border border-white/10 bg-ink-950/60 px-2 py-1 font-mono text-[10.5px] text-ink-100" />
      <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange(null)} className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100">
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}

export function ObjectInspector(p: Props) {
  const picked = p.objects.filter((o) => p.selection.includes(o.id));
  const object = picked[0] ?? null;
  const multi = picked.length > 1;

  const isGroup = object?.kind === "group";
  const parentGroup = object?.groupId ? p.objects.find((o) => o.id === object.groupId) : null;
  const groupChildren = isGroup ? p.objects.filter((o) => o.groupId === object.id || o.parentId === object.id) : [];

  return (
    <aside aria-label="Object properties" className="flex h-full min-h-0 w-full flex-col bg-ink-900">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.07] px-3.5">
        <h2 className="text-[10px] font-semibold tracking-[0.16em] text-ink-300 uppercase">Properties</h2>
        <button type="button" onClick={p.onClose} aria-label="Close properties" className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100 xl:hidden">
          <Icon name="x" size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5">
        {!object ? (
          <div className="space-y-3">
            <p className="text-[11.5px] leading-relaxed text-ink-400">Nothing selected. Click an object, or drag on empty canvas to select several.</p>
            {p.onBackgroundColorChange ? (
              <Group title="Scene Background">
                <ColorField
                  label="Background colour"
                  value={p.background?.color ?? p.defaultBackgroundColor ?? "#0b111c"}
                  onChange={(color) => p.onBackgroundColorChange?.(color)}
                />
              </Group>
            ) : null}
            <Group title="Scene">
              <p className="text-[11px] leading-relaxed text-ink-300">
                The scene stores composition only. Spins, wins and evaluation are produced by the SECTION 2 engine, never here.
              </p>
            </Group>
          </div>
        ) : (
          <>
            {multi ? (
              <p className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-ink-300">
                {picked.length} objects selected. Transform applies to the group; per-object fields show the first.
              </p>
            ) : null}

            {/* Group Membership Info */}
            {isGroup ? (
              <div className="rounded-lg border border-accent-500/30 bg-accent-500/[0.07] p-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-accent-400">
                    <Icon name="group" size={13} />
                    Group Container ({groupChildren.length} items)
                  </span>
                  {p.onUngroup ? (
                    <Button
                      className="h-6 px-1.5 text-[10px]"
                      onClick={() => p.onUngroup?.([object.id])}
                      title="Ungroup this container"
                    >
                      <Icon name="ungroup" size={11} />
                      Ungroup
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : parentGroup ? (
              <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] p-2 text-[10.5px]">
                <span className="text-ink-400">
                  Part of <strong className="text-ink-200">{parentGroup.name}</strong>
                </span>
                <div className="flex items-center gap-1">
                  {p.onSelectGroup ? (
                    <button
                      type="button"
                      onClick={() => p.onSelectGroup?.(parentGroup.id)}
                      className="focus-ring rounded text-accent-400 hover:text-accent-300"
                    >
                      Select group
                    </button>
                  ) : null}
                  {p.onUngroup ? (
                    <button
                      type="button"
                      onClick={() => p.onUngroup?.([parentGroup.id])}
                      className="focus-ring rounded text-ink-400 hover:text-ink-200"
                    >
                      Ungroup
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <Group title={multi ? "Selection" : isGroup ? "Group Details" : "Object"}>
              <CommitInput value={object.name} label="Object name" onCommit={(name) => p.onChange([object.id], { name }, "Rename object")} />
              <Field label="Layer">
                <Select aria-label="Layer" value={object.layerId} className="creation-input"
                  onChange={(event) => p.onChange(p.selection, { layerId: event.target.value }, "Change layer")}>
                  {p.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                </Select>
              </Field>
              <div className="flex gap-1.5">
                <button type="button" aria-pressed={object.visible} onClick={() => p.onChange([object.id], { visible: !object.visible }, "Toggle visibility")}
                  className="focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md border border-white/10 py-1.5 text-[11px] text-ink-200 hover:border-white/25">
                  <Icon name={object.visible ? "check" : "x"} size={12} />Visible
                </button>
                <button type="button" aria-pressed={object.locked} onClick={() => p.onChange([object.id], { locked: !object.locked }, "Toggle lock")}
                  className="focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md border border-white/10 py-1.5 text-[11px] text-ink-200 hover:border-white/25">
                  <Icon name="lock" size={12} />{object.locked ? "Locked" : "Lock"}
                </button>
              </div>
            </Group>

            <Group title="Transform">
              <div className="grid grid-cols-2 gap-2">
                <Field label="X"><NumberField label="X position" min={-20000} max={20000} value={Math.round(object.x)} onChange={(x) => p.onChange(p.selection, { x }, "Move object", `x:${object.id}`)} /></Field>
                <Field label="Y"><NumberField label="Y position" min={-20000} max={20000} value={Math.round(object.y)} onChange={(y) => p.onChange(p.selection, { y }, "Move object", `y:${object.id}`)} /></Field>
                <Field label="Width"><NumberField label="Width" min={1} max={20000} value={Math.round(object.width)} onChange={(width) => p.onChange(p.selection, { width }, "Resize object", `w:${object.id}`)} /></Field>
                <Field label="Height"><NumberField label="Height" min={1} max={20000} value={Math.round(object.height)} onChange={(height) => p.onChange(p.selection, { height }, "Resize object", `h:${object.id}`)} /></Field>
              </div>
              <Field label="Rotation (°)">
                <NumberField label="Rotation" min={-3600} max={3600} step={0.5} value={clean(object.rotation)} onChange={(rotation) => p.onChange(p.selection, { rotation }, "Rotate object", `r:${object.id}`)} />
              </Field>
              <Field label={`Opacity ${Math.round(object.opacity * 100)}%`}>
                <input type="range" min={0} max={1} step={0.01} value={object.opacity} aria-label="Opacity"
                  onChange={(event) => p.onChange(p.selection, { opacity: Number(event.target.value) }, "Change opacity", `o:${object.id}`)}
                  className="h-1 w-full accent-blue-500" />
              </Field>
              <Field label="Blend Mode">
                <Select
                  aria-label="Blend Mode"
                  value={object.blendMode || "normal"}
                  className="creation-input capitalize"
                  onChange={(event) => p.onChange(p.selection, { blendMode: event.target.value as BlendMode }, "Change blend mode")}
                >
                  {BLEND_MODES.map((mode) => (
                    <option key={mode} value={mode} className="capitalize">
                      {mode.replace("-", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Blur (px)"><NumberField label="Blur" min={0} max={100} value={object.blur} onChange={(blur) => p.onChange(p.selection, { blur }, "Change blur", `b:${object.id}`)} /></Field>
            </Group>

            {object.kind === "animation" ? (
              <Group title="Animation Layer">
                <div className="space-y-1.5 rounded-md border border-accent-500/30 bg-accent-500/[0.06] p-2.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-400">Animation ID</span>
                    <span className="font-mono text-[10px] text-ink-100">{object.animationId ?? object.refId ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-400">Layer Role</span>
                    <span className="text-accent-400 font-medium">Standalone Animated Layer</span>
                  </div>
                  <p className="text-[10px] text-ink-400">
                    Moveable, resizable, reorderable, visible/hidden, and lockable scene layer.
                  </p>
                </div>
              </Group>
            ) : null}

            {object.kind === "text" ? (
              <Group title="Text">
                <CommitInput value={object.text ?? ""} label="Text content" allowEmpty onCommit={(text) => p.onChange([object.id], { text }, "Edit text")} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Size"><NumberField label="Font size" min={4} max={1000} value={object.fontSize} onChange={(fontSize) => p.onChange([object.id], { fontSize }, "Change font size", `fs:${object.id}`)} /></Field>
                  <Field label="Weight">
                    <Select aria-label="Font weight" value={String(object.fontWeight)} className="creation-input"
                      onChange={(event) => p.onChange([object.id], { fontWeight: Number(event.target.value) }, "Change font weight")}>
                      {[400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}
                    </Select>
                  </Field>
                </div>
                <SegmentedAlign value={object.align} onChange={(align) => p.onChange([object.id], { align }, "Change alignment")} />
              </Group>
            ) : null}

            {object.kind === "shape" || object.kind === "text" || object.kind === "stroke" ? (
              <Group title="Appearance">
                {object.kind === "stroke" ? null : <ColorField label="Fill" value={object.fill} onChange={(fill) => p.onChange(p.selection, { fill }, "Change fill")} />}
                <ColorField label="Stroke" value={object.stroke} onChange={(stroke) => p.onChange(p.selection, { stroke }, "Change stroke")} />
                <Field label="Stroke width"><NumberField label="Stroke width" min={0} max={200} value={object.strokeWidth} onChange={(strokeWidth) => p.onChange(p.selection, { strokeWidth }, "Change stroke width", `sw:${object.id}`)} /></Field>
                {object.shape === "rect" ? (
                  <Field label="Corner radius"><NumberField label="Corner radius" min={0} max={500} value={object.radius} onChange={(radius) => p.onChange([object.id], { radius }, "Change radius", `r:${object.id}`)} /></Field>
                ) : null}
              </Group>
            ) : null}

            <Group title="Arrange">
              <div className="grid grid-cols-2 gap-1.5">
                <Button className="h-7 text-[10.5px]" onClick={() => p.onOrder("front")}><Icon name="bringFront" size={12} />Front</Button>
                <Button className="h-7 text-[10.5px]" onClick={() => p.onOrder("forward")}>Forward</Button>
                <Button className="h-7 text-[10.5px]" onClick={() => p.onOrder("backward")}>Backward</Button>
                <Button className="h-7 text-[10.5px]" onClick={() => p.onOrder("back")}><Icon name="sendBack" size={12} />Back</Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {([["left", "Align left"], ["center", "Align centre"], ["right", "Align right"], ["top", "Align top"], ["middle", "Align middle"], ["bottom", "Align bottom"]] as [AlignMode, string][]).map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => p.onAlign(mode)} title={label}
                    className="focus-ring rounded border border-white/10 px-1.5 py-1 text-[9.5px] text-ink-300 hover:text-ink-100">
                    {mode}
                  </button>
                ))}
                <button type="button" disabled={picked.length < 3} title={picked.length < 3 ? "Select three or more objects to distribute" : undefined}
                  onClick={() => p.onDistribute("x")} className="focus-ring rounded border border-white/10 px-1.5 py-1 text-[9.5px] text-ink-300 hover:text-ink-100 disabled:opacity-40">
                  Dist X
                </button>
                <button type="button" disabled={picked.length < 3} onClick={() => p.onDistribute("y")} className="focus-ring rounded border border-white/10 px-1.5 py-1 text-[9.5px] text-ink-300 hover:text-ink-100 disabled:opacity-40">
                  Dist Y
                </button>
              </div>
            </Group>

            <Group title="Actions">
              <div className="grid grid-cols-2 gap-1.5">
                <Button className="h-7 text-[10.5px]" onClick={p.onDuplicate}><Icon name="copy" size={12} />Duplicate</Button>
                <Button variant="danger" className="h-7 text-[10.5px]" onClick={p.onDelete}><Icon name="trash" size={12} />Delete</Button>
              </div>
              <p className="text-[10px] leading-relaxed text-ink-400">Delete is undoable with Ctrl/⌘ Z.</p>
            </Group>
          </>
        )}
      </div>
    </aside>
  );
}

function SegmentedAlign({ value, onChange }: { value: SceneObject["align"]; onChange: (value: SceneObject["align"]) => void }) {
  return (
    <div role="radiogroup" aria-label="Text alignment" className="inline-flex rounded-md border border-white/10 bg-ink-850 p-0.5">
      {(["left", "center", "right"] as const).map((option) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onChange(option)}
          className={`focus-ring rounded-[5px] px-2.5 py-1 text-[11px] capitalize transition ${value === option ? "bg-white/10 text-ink-100" : "text-ink-400 hover:text-ink-200"}`}>
          {option}
        </button>
      ))}
    </div>
  );
}
