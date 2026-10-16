"use client";

import { useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import {
  MAX_SCENES,
  MAX_SCENE_NAME_LENGTH,
  MIN_SCENES,
  validateSceneName,
  type PendingSceneSwitchPrompt,
  type SceneSelectorCardModel,
  type SceneSharedGlobalConfig,
  type UnsavedSwitchResolution,
} from "@/lib/scenes";

export interface SceneSelectorCardsProps {
  cards: SceneSelectorCardModel[];
  activeSceneId: string;
  activeSceneDirty: boolean;
  pendingSwitch: PendingSceneSwitchPrompt | null;
  sharedGlobalConfig?: SceneSharedGlobalConfig;
  saving?: boolean;
  compact?: boolean;
  onSelectScene: (sceneId: string) => void;
  onAddScene: (slotLabel?: string) => void;
  onDuplicateScene: (sceneId: string) => void;
  onRenameScene: (sceneId: string, newName: string) => { ok: boolean; error?: string };
  onDeleteScene: (sceneId: string) => void;
  onSaveActiveLayout: () => void;
  onResolveUnsavedSwitch: (resolution: UnsavedSwitchResolution) => void;
}

export function SceneSelectorCards({
  cards,
  activeSceneId,
  activeSceneDirty,
  pendingSwitch,
  sharedGlobalConfig,
  saving = false,
  compact = false,
  onSelectScene,
  onAddScene,
  onDuplicateScene,
  onRenameScene,
  onDeleteScene,
  onSaveActiveLayout,
  onResolveUnsavedSwitch,
}: SceneSelectorCardsProps) {
  const [renamingSceneId, setRenamingSceneId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const occupiedCards = cards.filter((c) => c.occupied && c.sceneId);
  const occupiedCount = occupiedCards.length;
  const canAddScene = occupiedCount < MAX_SCENES;
  const canDeleteScene = occupiedCount > MIN_SCENES;

  const startRename = (sceneId: string, currentName: string) => {
    setRenamingSceneId(sceneId);
    setRenameDraft(currentName.slice(0, MAX_SCENE_NAME_LENGTH));
    setRenameError(null);
  };

  const cancelRename = () => {
    setRenamingSceneId(null);
    setRenameDraft("");
    setRenameError(null);
  };

  const commitRename = (sceneId: string) => {
    const check = validateSceneName(renameDraft);
    if (!check.ok) {
      setRenameError(check.error ?? "Invalid scene name.");
      return;
    }
    const res = onRenameScene(sceneId, check.sanitized);
    if (!res.ok) {
      setRenameError(res.error ?? "Could not rename scene.");
      return;
    }
    setRenamingSceneId(null);
    setRenameDraft("");
    setRenameError(null);
  };

  return (
    <section
      aria-label="Scene selector cards"
      data-testid="scene-selector-bar"
      className={`border-b border-studio-border bg-studio-panel/90 backdrop-blur ${
        compact ? "px-3 py-2" : "px-4 py-2.5"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-studio-muted">
            Scenes &amp; Layout Composition
          </span>
          <Badge tone="accent">
            {occupiedCount}/{MAX_SCENES} Scenes
          </Badge>
          {sharedGlobalConfig && (
            <span
              data-testid="scene-shared-global-pill"
              className="hidden items-center gap-1.5 rounded border border-studio-border/80 bg-studio-surface/70 px-2 py-0.5 font-mono text-[10px] text-studio-muted xl:inline-flex"
              title="Reels, math configuration, and symbol definitions are shared globally across all scenes"
            >
              <span>
                Global Shared: {sharedGlobalConfig.reels.columns}&times;
                {sharedGlobalConfig.reels.rows} Reels
              </span>
              <span>&bull;</span>
              <span>RTP {sharedGlobalConfig.math.rtpTarget}%</span>
              <span>&bull;</span>
              <span>{sharedGlobalConfig.symbols.length} Symbols</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            disabled={!canAddScene}
            title={
              canAddScene
                ? "Add a new scene (up to 3 scenes)"
                : "Maximum of 3 scenes reached"
            }
            data-testid="scene-add-button"
            onClick={() => onAddScene()}
          >
            <Icon name="plus" size={12} />
            Add Scene
          </Button>
          <Button
            variant={activeSceneDirty ? "primary" : "outline"}
            disabled={saving}
            title="Save only the active scene's layout changes"
            data-testid="scene-save-layout-button"
            onClick={onSaveActiveLayout}
          >
            <Icon name="check" size={12} />
            {saving ? "Saving Layout..." : "Save Layout"}
          </Button>
        </div>
      </div>

      {/* 3 Scene Cards: Scene 1, Scene 2, Scene 3 */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {cards.map((card) => {
          if (!card.occupied || !card.sceneId) {
            return (
              <div
                key={card.slotLabel}
                data-testid={`scene-card-slot-${card.slotIndex}`}
                className="flex items-center justify-between rounded-md border border-dashed border-studio-border/80 bg-studio-bg/40 px-3 py-2 text-xs text-studio-muted transition hover:border-studio-accent/50"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-studio-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-studio-muted">
                    {card.slotLabel}
                  </span>
                  <span className="text-[11px] text-studio-subtle">
                    Empty scene slot
                  </span>
                </div>
                <Button
                  variant="ghost"
                  disabled={!canAddScene}
                  data-testid={`scene-slot-add-${card.slotIndex}`}
                  onClick={() => onAddScene(card.slotLabel)}
                >
                  <Icon name="plus" size={12} />
                  Add {card.slotLabel}
                </Button>
              </div>
            );
          }

          const sceneId = card.sceneId;
          const isRenaming = renamingSceneId === sceneId;

          return (
            <div
              key={sceneId}
              data-testid={`scene-card-${card.slotIndex}`}
              data-scene-id={sceneId}
              data-active={card.active ? "true" : "false"}
              data-dirty={card.isDirty ? "true" : "false"}
              onClick={() => {
                if (!isRenaming && sceneId !== activeSceneId) {
                  onSelectScene(sceneId);
                }
              }}
              className={`group relative flex flex-col justify-between rounded-md border px-3 py-2 transition ${
                card.active
                  ? "border-studio-accent bg-studio-accent/12 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]"
                  : "cursor-pointer border-studio-border bg-studio-surface/75 hover:border-studio-border-strong hover:bg-studio-elevated/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                      card.active
                        ? "bg-studio-accent text-studio-bg"
                        : "bg-studio-bg text-studio-muted"
                    }`}
                  >
                    {card.slotLabel}
                  </span>

                  {isRenaming ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        aria-label={`Rename ${card.slotLabel}`}
                        data-testid={`scene-rename-input-${card.slotIndex}`}
                        value={renameDraft}
                        maxLength={MAX_SCENE_NAME_LENGTH}
                        autoFocus
                        onChange={(e) => {
                          setRenameDraft(e.target.value);
                          setRenameError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(sceneId);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        className="h-6 w-32 px-1.5 py-0.5 text-xs"
                      />
                      <span className="font-mono text-[10px] text-studio-muted">
                        {renameDraft.trim().length}/{MAX_SCENE_NAME_LENGTH}
                      </span>
                      <button
                        type="button"
                        aria-label="Save scene name"
                        data-testid={`scene-rename-save-${card.slotIndex}`}
                        onClick={() => commitRename(sceneId)}
                        className="rounded bg-studio-accent px-1.5 py-0.5 text-[10px] font-semibold text-studio-bg hover:opacity-90"
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel rename"
                        onClick={cancelRename}
                        className="rounded bg-studio-bg px-1.5 py-0.5 text-[10px] text-studio-muted hover:text-studio-text"
                      >
                        Esc
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`scene-select-button-${card.slotIndex}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScene(sceneId);
                      }}
                      className="truncate text-left text-xs font-semibold text-studio-text"
                      title={`${card.slotLabel}: ${card.name}`}
                    >
                      {card.name}
                    </button>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {card.active && (
                    <Badge tone="accent">Active</Badge>
                  )}
                  {card.isDirty ? (
                    <Badge tone="warning">Unsaved</Badge>
                  ) : (
                    <Badge tone="muted">Saved</Badge>
                  )}
                </div>
              </div>

              {renameError && isRenaming && (
                <p
                  role="alert"
                  className="mt-1 text-[10px] text-studio-danger"
                >
                  {renameError}
                </p>
              )}

              <div className="mt-2 flex items-center justify-between gap-2 border-t border-studio-border/60 pt-1.5 text-[10px] text-studio-muted">
                <div className="flex items-center gap-2 truncate">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-studio-border"
                    style={{
                      backgroundColor: card.backgroundColor ?? "#0b1020",
                    }}
                    title={`Background: ${card.backgroundColor ?? "default"}`}
                  />
                  <span>{card.objectCount} obj</span>
                  <span>&bull;</span>
                  <span>
                    {card.visibleLayerCount}/{card.layerCount} layers
                  </span>
                  <span>&bull;</span>
                  <span>{card.composedImageCount} img</span>
                </div>

                <div
                  className="flex shrink-0 items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label={`Rename ${card.slotLabel}`}
                    data-testid={`scene-rename-btn-${card.slotIndex}`}
                    title={`Rename scene (max ${MAX_SCENE_NAME_LENGTH} characters)`}
                    onClick={() => startRename(sceneId, card.name)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-studio-muted transition hover:bg-studio-bg hover:text-studio-text"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplicate ${card.slotLabel}`}
                    data-testid={`scene-duplicate-btn-${card.slotIndex}`}
                    disabled={!canAddScene}
                    title={
                      canAddScene
                        ? `Duplicate ${card.name}`
                        : `Cannot duplicate: maximum ${MAX_SCENES} scenes`
                    }
                    onClick={() => onDuplicateScene(sceneId)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-studio-muted transition hover:bg-studio-bg hover:text-studio-text disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${card.slotLabel}`}
                    data-testid={`scene-delete-btn-${card.slotIndex}`}
                    disabled={!canDeleteScene}
                    title={
                      canDeleteScene
                        ? `Delete ${card.name}`
                        : "At least 1 scene must remain"
                    }
                    onClick={() => onDeleteScene(sceneId)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-studio-danger/80 transition hover:bg-studio-danger/15 hover:text-studio-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unsaved Changes Prompt when switching scenes with unsaved changes */}
      {pendingSwitch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved scene layout changes"
          data-testid="unsaved-scene-switch-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-studio-border bg-studio-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-studio-text">
                Unsaved Layout Changes in &ldquo;{pendingSwitch.fromSceneName}&rdquo;
              </h2>
              <Badge tone="warning">Unsaved Changes</Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-studio-muted">
              You have unsaved layout changes in{" "}
              <strong className="text-studio-text">
                {pendingSwitch.fromSceneName}
              </strong>
              . Before switching to{" "}
              <strong className="text-studio-text">
                {pendingSwitch.toSceneName}
              </strong>
              , choose whether to save this scene&apos;s layout, discard its
              unsaved edits, or cancel switching.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                data-testid="unsaved-switch-cancel"
                onClick={() => onResolveUnsavedSwitch("cancel")}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                data-testid="unsaved-switch-discard"
                onClick={() => onResolveUnsavedSwitch("discard")}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                data-testid="unsaved-switch-save"
                onClick={() => onResolveUnsavedSwitch("save")}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
