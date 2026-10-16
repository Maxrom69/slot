"use client";

import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";

/** Inert extension point: no chat, input, agent code, fake progress or model calls. */
export function AgentTab({ onSwitchToManual }: { onSwitchToManual: () => void }) {
  return <div className="mx-auto flex max-w-xl flex-col items-center py-14 text-center">
    <div className="mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.025] text-ink-300"><Icon name="lock" size={23} /></div>
    <span className="rounded-full border border-accent-400/20 bg-accent-400/[0.05] px-3 py-1 text-[9px] font-semibold tracking-[0.15em] text-accent-400 uppercase">Reserved for a future phase</span>
    <h2 className="mt-5 text-[23px] font-semibold tracking-tight text-ink-100">AI Assistant — Coming Soon</h2>
    <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-ink-300">The assistant is not available in this release. Nothing is generated or executed on this tab.</p>
    <div className="creation-panel mt-6 w-full rounded-xl border border-white/[0.07] p-5 text-left">
      <p className="text-[12px] font-medium text-ink-200">You don’t need AI to build a game.</p>
      <ul className="mt-3 space-y-2.5 text-[11.5px] text-ink-300">{["Configure reels, symbols, backgrounds and controls", "Import your artwork and reference images", "Create, organize and export a Game Blueprint"].map((line) => <li key={line} className="flex items-center gap-2"><Icon name="check" size={13} className="text-accent-400" />{line}</li>)}</ul>
    </div>
    <Button variant="primary" className="mt-6 px-4 py-2.5" onClick={onSwitchToManual}><Icon name="pencil" size={14} />Continue with Manual<Icon name="arrow-right" size={13} /></Button>
  </div>;
}
