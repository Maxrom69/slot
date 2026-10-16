"use client";

import { Field, Select, TextArea, TextInput } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { STYLE_PRESETS, THEME_PRESETS, type DraftValidation, type NewGameDraft } from "@/lib/creation/draft";
import type { FolderSummary } from "@/lib/workspace/types";
import { ReferenceImageArea } from "./ArtworkImport";
import { Chip, FieldError, SectionCard } from "./fields";

export function GameSettingsPanel({ draft, errors, showErrors, folders, patch, onError, onImportBusyChange }: {
  draft: NewGameDraft;
  errors: DraftValidation["errors"];
  showErrors: boolean;
  folders: FolderSummary[];
  patch: (partial: Partial<NewGameDraft>, coalesceKey?: string) => void;
  onError: (message: string) => void;
  onImportBusyChange?: (busy: boolean) => void;
}) {
  const err = (key: keyof DraftValidation["errors"]) => showErrors ? errors[key] : undefined;
  return <div className="min-w-0 space-y-4">
    <SectionCard title="Game details" icon="file" number="01">
      <Field label="Game title" required>
        <TextInput id="game-title" aria-label="Game title" value={draft.title} placeholder="Name your next game" maxLength={80}
          aria-invalid={Boolean(err("title"))} aria-describedby={err("title") ? "game-title-error" : undefined}
          className="creation-input" onChange={(event) => patch({ title: event.target.value }, "title")} />
        <span id="game-title-error"><FieldError message={err("title")} /></span>
      </Field>
      <Field label="Theme" required>
        <TextInput id="game-theme" aria-label="Theme" value={draft.theme} placeholder="e.g. ancient ruins, cosmic adventure…" maxLength={80}
          aria-invalid={Boolean(err("theme"))} className="creation-input" onChange={(event) => patch({ theme: event.target.value }, "theme")} />
        <FieldError message={err("theme")} />
      </Field>
      <div>
        <p className="mb-2 text-[10px] text-ink-300/70">Or use a starting point</p>
        <div className="flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((preset) => <Chip key={preset.theme} active={draft.theme === preset.theme}
            onClick={() => patch({ theme: preset.theme, styleGuide: preset.style, stylePreset: preset.preset })}
            title={`Use ${preset.theme} theme and style notes`}>{preset.theme}</Chip>)}
        </div>
      </div>
      <Field label="Folder" hint="Optional. Use / for nested folders; leave empty for root.">
        <div className="relative">
          <Icon name="folder" size={14} className="pointer-events-none absolute top-[11px] left-3 text-ink-400" />
          <TextInput aria-label="Folder" list="folder-suggestions" value={draft.folderPath} placeholder="Your Games /"
            maxLength={200} className="creation-input pl-9" onChange={(event) => patch({ folderPath: event.target.value }, "folder")} />
        </div>
        <datalist id="folder-suggestions">{folders.map((folder) => <option key={folder.id} value={folder.path} />)}</datalist>
        <FieldError message={err("folder")} />
      </Field>
      <details className="group">
        <summary className="focus-ring flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-ink-300 hover:text-ink-100">
          <Icon name="plus" size={12} className="group-open:hidden" /><Icon name="minus" size={12} className="hidden group-open:block" /> Add a project description
        </summary>
        <TextArea aria-label="Description" rows={2} maxLength={800} value={draft.description} placeholder="A short brief for your team"
          className="creation-input mt-2" onChange={(event) => patch({ description: event.target.value }, "description")} />
      </details>
    </SectionCard>

    <SectionCard title="Art direction" icon="palette" number="02">
      <Field label="Visual style">
        <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-ink-950/40 p-2">
          <span className={`style-swatch style-swatch-${draft.stylePreset} grid h-8 w-9 shrink-0 place-items-center rounded-md`}><Icon name="diamond" size={19} /></span>
          <Select aria-label="Visual style" value={draft.stylePreset} className="creation-input border-0 bg-transparent p-0 shadow-none"
            onChange={(event) => patch({ stylePreset: event.target.value as NewGameDraft["stylePreset"] })}>
            {STYLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </Select>
        </div>
      </Field>
      <Field label="Style guide" hint="Palette, lighting, materials, proportions — your creative brief.">
        <TextArea aria-label="Style guide" rows={3} maxLength={800} value={draft.styleGuide}
          placeholder="e.g. earthy tones, mysterious lighting, jewel accents…" className="creation-input"
          onChange={(event) => patch({ styleGuide: event.target.value }, "styleGuide")} />
      </Field>
      <ReferenceImageArea image={draft.referenceImage} onChange={(referenceImage) => patch({ referenceImage })}
        onError={onError} onBusyChange={onImportBusyChange} />
    </SectionCard>
  </div>;
}
