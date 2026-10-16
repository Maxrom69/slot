"use client";

import { Icon } from "@/components/ui/Icon";
import type { ElementDef, ProjectStatus, StylePalette } from "@/lib/blueprint/types";
import type { BlueprintValidation } from "@/lib/blueprint/validate";
import type { SetView } from "@/lib/design/selectors";
import type { Selection } from "@/lib/design/types";
import { STATUS_TONE } from "@/lib/workspace/selectors";
import { STATUS_LABELS } from "@/lib/workspace/types";

interface Props {
  project: { id: string; title: string; theme: string; status: ProjectStatus; folderPath: string };
  palette: StylePalette;
  sets: SetView[];
  standalone: ElementDef[];
  selection: Selection;
  check: BlueprintValidation;
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onPick: (id: string) => void;
  onExport: () => void;
  activeNav?: "design" | "canvas" | "assets" | "reels" | "paylines" | "paytable" | "settings" | "blueprint";
}

function NavItem({ href, children, current, onNavigate }: { href: string; children: React.ReactNode; current?: boolean; onNavigate: (path: string) => void }) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={() => {
        if (!current) onNavigate(href);
      }}
      className={`focus-ring flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-[12px] transition ${
        current
          ? "border-accent-500/30 bg-accent-600/15 text-ink-100"
          : "border-transparent text-ink-300 hover:bg-white/5 hover:text-ink-100"
      }`}
    >
      {children}
    </button>
  );
}

export function LeftNav(p: Props) {
  const { project } = p;
  return (
    <>
      {p.open ? <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={p.onClose} /> : null}
      <aside aria-label="Project navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-white/[0.07] bg-ink-900 transition-transform lg:static lg:z-auto lg:translate-x-0 ${p.open ? "translate-x-0" : "invisible -translate-x-full lg:visible"}`}>
        <div className="px-3 pt-3">
          <div className="rounded-lg border border-white/[0.07] bg-ink-850 p-3">
            <div className="mb-2 flex h-1.5 overflow-hidden rounded-full" aria-hidden>
              {[p.palette.accent, p.palette.accentAlt, p.palette.glow, p.palette.surface].map((color) => <span key={color} className="flex-1" style={{ background: color }} />)}
            </div>
            <div className="truncate text-[13px] font-semibold text-ink-100" title={project.title}>{project.title}</div>
            <div className="mt-0.5 truncate text-[10.5px] text-ink-400">{project.folderPath || "Your Games"} · {project.theme}</div>
            <span className={`mt-2 inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${STATUS_TONE[project.status]}`}>{STATUS_LABELS[project.status]}</span>
          </div>
        </div>

        <nav className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          <div className="space-y-0.5">
            <NavItem href={`/projects/${project.id}`} onNavigate={p.onNavigate}><Icon name="folder" size={14} />Overview</NavItem>
            <NavItem href={`/projects/${project.id}/design`} current={!p.activeNav || p.activeNav === "design"} onNavigate={p.onNavigate}><Icon name="layers" size={14} />Design</NavItem>
            <NavItem href={`/projects/${project.id}/symbols`} onNavigate={p.onNavigate}><Icon name="diamond" size={14} />Symbols</NavItem>
            <NavItem href={`/projects/${project.id}/assets`} current={p.activeNav === "assets"} onNavigate={p.onNavigate}><Icon name="image" size={14} />Assets</NavItem>
            <NavItem href={`/projects/${project.id}/canvas`} current={p.activeNav === "canvas"} onNavigate={p.onNavigate}><Icon name="grid" size={14} />Canvas &amp; Layers</NavItem>
            <NavItem href={`/projects/${project.id}/scenes`} onNavigate={p.onNavigate}><Icon name="frame" size={14} />Scenes</NavItem>
            <NavItem href={`/projects/${project.id}/reels`} current={p.activeNav === "reels"} onNavigate={p.onNavigate}><Icon name="reels" size={14} />Reels</NavItem>
            <NavItem href={`/projects/${project.id}/paylines`} current={p.activeNav === "paylines"} onNavigate={p.onNavigate}><Icon name="line" size={14} />Paylines</NavItem>
            <NavItem href={`/projects/${project.id}/paytable`} current={p.activeNav === "paytable"} onNavigate={p.onNavigate}><Icon name="sparkles" size={14} />Paytable</NavItem>
            <NavItem href={`/projects/${project.id}/math`} onNavigate={p.onNavigate}><Icon name="settings" size={14} />Math &amp; Features</NavItem>
            <NavItem href={`/projects/${project.id}/preview`} onNavigate={p.onNavigate}><Icon name="eye" size={14} />Preview</NavItem>
            <NavItem href={`/projects/${project.id}/export`} onNavigate={p.onNavigate}><Icon name="download" size={14} />Export</NavItem>
            <NavItem href={`/projects/${project.id}/settings`} current={p.activeNav === "settings"} onNavigate={p.onNavigate}><Icon name="code" size={14} />Settings &amp; JSON</NavItem>
          </div>

          <div>
            <h2 className="mb-1.5 px-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Outline</h2>
            <ul className="space-y-0.5">
              {p.sets.map(({ element, symbols }) => (
                <li key={element.id}>
                  <button type="button" onClick={() => p.onPick(element.id)} aria-current={p.selection?.kind === "element" && p.selection.id === element.id}
                    className={`focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11.5px] transition ${p.selection?.kind === "element" && p.selection.id === element.id ? "bg-white/[0.07] text-ink-100" : "text-ink-300 hover:bg-white/5 hover:text-ink-100"}`}>
                    <span className="flex min-w-0 items-center gap-2"><Icon name="layers" size={12} className="shrink-0 text-ink-400" /><span className="truncate">{element.name}</span></span>
                    <span className="font-mono text-[9.5px] text-ink-400">{symbols.length}</span>
                  </button>
                </li>
              ))}
              {p.standalone.map((element) => (
                <li key={element.id}>
                  <button type="button" onClick={() => p.onPick(element.id)} aria-current={p.selection?.kind === "element" && p.selection.id === element.id}
                    className={`focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11.5px] transition ${p.selection?.kind === "element" && p.selection.id === element.id ? "bg-white/[0.07] text-ink-100" : "text-ink-300 hover:bg-white/5 hover:text-ink-100"}`}>
                    <Icon name="diamond" size={12} className="shrink-0 text-ink-400" /><span className="truncate">{element.name}</span>
                  </button>
                </li>
              ))}
              {p.sets.length + p.standalone.length === 0 ? <li className="px-2 py-1 text-[11px] text-ink-400">No elements yet</li> : null}
            </ul>
          </div>
        </nav>

        <div className="space-y-2 border-t border-white/[0.07] p-3">
          <p className={`flex items-center gap-1.5 text-[10.5px] ${p.check.ok ? "text-emerald-300" : p.check.integrityOk ? "text-amber-200" : "text-rose-300"}`}>
            <Icon name={p.check.ok ? "shield" : "info"} size={13} />
            {p.check.ok ? "Blueprint valid" : p.check.integrityOk ? `${p.check.issues.length} to finish` : "Needs attention"}
          </p>
          <button type="button" onClick={p.onExport} className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-ink-850 px-3 py-1.5 text-[11px] font-medium text-ink-200 transition hover:border-white/20 hover:text-ink-100">
            <Icon name="download" size={13} />Export blueprint
          </button>
        </div>
      </aside>
    </>
  );
}
