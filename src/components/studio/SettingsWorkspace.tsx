"use client";

import { useState } from "react";
import { StudioShell } from "@/components/shell/StudioShell";
import {
  Badge,
  Button,
  Panel,
  PropertyRow,
  Section,
  Select,
  Toggle,
} from "@/components/ui";
import { getAIService } from "@/lib/ai/boundary";
import { StudioEditorProvider } from "@/lib/editor/EditorProvider";
import { DEFAULT_STUDIO_SHORTCUTS } from "@/lib/keyboard/shortcuts";

interface StudioPreferences {
  defaultGridPreset: "5x3" | "5x4" | "6x3" | "6x4";
  defaultEvaluation: "lines" | "ways" | "cluster";
  autosaveEnabled: boolean;
  showGridByDefault: boolean;
  snappingByDefault: boolean;
  showSafeAreaByDefault: boolean;
}

const DEFAULT_PREFERENCES: StudioPreferences = {
  defaultGridPreset: "5x3",
  defaultEvaluation: "lines",
  autosaveEnabled: true,
  showGridByDefault: true,
  snappingByDefault: true,
  showSafeAreaByDefault: true,
};

const SETTINGS_STORAGE_KEY = "slots-studio:settings:v1";

export function SettingsWorkspace() {
  return (
    <StudioEditorProvider initialProject={null}>
      <SettingsWorkspaceInner />
    </StudioEditorProvider>
  );
}

function loadInitialPreferences(): StudioPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StudioPreferences>;
      return { ...DEFAULT_PREFERENCES, ...parsed };
    }
  } catch {
    // keep defaults
  }
  return DEFAULT_PREFERENCES;
}

function SettingsWorkspaceInner() {
  const [prefs, setPrefs] = useState<StudioPreferences>(loadInitialPreferences);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const aiService = getAIService();
  const aiCapability = aiService.getCapabilityState();

  const updatePrefs = (patch: Partial<StudioPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        setSavedNotice("Preferences saved locally");
      } catch {
        setSavedNotice("Could not write to localStorage");
      }
      return next;
    });
  };

  const resetDefaults = () => {
    setPrefs(DEFAULT_PREFERENCES);
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(DEFAULT_PREFERENCES),
      );
      setSavedNotice("Reset to studio defaults");
    } catch {
      // ignore
    }
  };

  const rightPanel = (
    <div className="space-y-4">
      <Section title="Future AI Boundary">
        <div className="space-y-2 text-xs">
          <PropertyRow label="Service Status">
            <Badge tone="muted">{aiCapability.status}</Badge>
          </PropertyRow>
          <PropertyRow label="Available">
            <span className="font-mono text-ink-300">
              {String(aiCapability.available)}
            </span>
          </PropertyRow>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            {aiCapability.reason}
          </p>
        </div>
      </Section>

      <Section title="Architecture Info">
        <PropertyRow label="Section">
          <span className="font-mono text-xs text-ink-200">SECTION 1 · Frontend</span>
        </PropertyRow>
        <PropertyRow label="Engine Target">
          <span className="font-mono text-xs text-ink-200">SECTION 2 · Backend</span>
        </PropertyRow>
      </Section>
    </div>
  );

  return (
    <StudioShell
      activeSection="settings"
      sectionTitle="Studio Settings"
      rightPanel={rightPanel}
      rightPanelTitle="System Boundary"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Workstation Preferences"
          subtitle="Persisted locally in your browser"
          actions={
            <Button variant="ghost" onClick={resetDefaults}>
              Reset Defaults
            </Button>
          }
        >
          <div className="space-y-3">
            <PropertyRow label="Default Grid">
              <Select
                aria-label="Default grid preset"
                value={prefs.defaultGridPreset}
                onChange={(e) =>
                  updatePrefs({
                    defaultGridPreset: e.target.value as StudioPreferences["defaultGridPreset"],
                  })
                }
                className="w-36 text-xs"
              >
                <option value="5x3">5 × 3</option>
                <option value="5x4">5 × 4</option>
                <option value="6x3">6 × 3</option>
                <option value="6x4">6 × 4</option>
              </Select>
            </PropertyRow>

            <PropertyRow label="Default Evaluation">
              <Select
                aria-label="Default evaluation"
                value={prefs.defaultEvaluation}
                onChange={(e) =>
                  updatePrefs({
                    defaultEvaluation: e.target.value as StudioPreferences["defaultEvaluation"],
                  })
                }
                className="w-36 text-xs"
              >
                <option value="lines">Lines</option>
                <option value="ways">Ways</option>
                <option value="cluster">Cluster</option>
              </Select>
            </PropertyRow>

            <div className="space-y-2.5 pt-2">
              <Toggle
                label="Enable Editor Autosave"
                hint="Automatically persist blueprint changes locally"
                checked={prefs.autosaveEnabled}
                onChange={(autosaveEnabled) => updatePrefs({ autosaveEnabled })}
              />
              <Toggle
                label="Show Canvas Grid by Default"
                checked={prefs.showGridByDefault}
                onChange={(showGridByDefault) => updatePrefs({ showGridByDefault })}
              />
              <Toggle
                label="Enable Snapping by Default"
                checked={prefs.snappingByDefault}
                onChange={(snappingByDefault) => updatePrefs({ snappingByDefault })}
              />
              <Toggle
                label="Show Safe Area Overlay by Default"
                checked={prefs.showSafeAreaByDefault}
                onChange={(showSafeAreaByDefault) =>
                  updatePrefs({ showSafeAreaByDefault })
                }
              />
            </div>

            {savedNotice ? (
              <p className="pt-2 text-xs text-emerald-300">{savedNotice}</p>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Keyboard Shortcuts"
          subtitle="Registered bindings in the Studio Keyboard Shortcut Manager"
        >
          <div className="divide-y divide-white/[0.06]">
            {DEFAULT_STUDIO_SHORTCUTS.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center justify-between gap-3 py-2 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-100">{sc.label}</span>
                    {!sc.available ? <Badge tone="muted">Reserved</Badge> : null}
                  </div>
                  <div className="text-[11px] text-ink-400">{sc.description}</div>
                </div>
                <kbd className="rounded border border-white/15 bg-ink-950 px-2 py-1 font-mono text-[11px] text-ink-200">
                  {sc.display}
                </kbd>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </StudioShell>
  );
}
