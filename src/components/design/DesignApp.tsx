"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Toasts } from "@/components/ui/Toasts";
import { elementTypeMeta } from "@/lib/blueprint/elements";
import { glyphsForTheme } from "@/lib/blueprint/palette";
import type { ElementType, GameBlueprint, ProjectStatus, ValueTier } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { downloadImage, downloadSetArchive } from "@/lib/client/downloads";
import { useDesignEditor, type DesignEditor } from "@/lib/client/useDesignEditor";
import { applyDesign, designDocFromBlueprint } from "@/lib/design/migrate";
import {
  addElement, addSymbols, addVariant, deleteElement, deleteSymbol, deletionImpact, duplicateElement, duplicateSymbol, duplicateVariant, editVariant,
  importArtwork, moveSymbolInSet, removeVariant, renameElement, renameSymbol, replaceElementArtwork, setElementImage, setSymbolImage, setSymbolTier, symbolDeletionImpact,
  updateElement, updateSymbol,
} from "@/lib/design/operations";
import {
  elementImage, findElement, findSymbol, matchesQuery, selectSets, selectStandalone, symbolImage,
  type StandaloneFilter,
} from "@/lib/design/selectors";
import type { DesignDoc, ElementPatch, ImageTarget, ImportSetOptions, NewElementInput, Selection, SymbolPatch } from "@/lib/design/types";
import type { DesignActions } from "./actions";
import { AddElementDialog } from "./AddElementDialog";
import { DeleteDialog, type DeleteTarget } from "./DeleteDialog";
import { ElementDetail } from "./ElementDetail";
import { ElementWorkspace } from "./ElementWorkspace";
import { ImportDialog, type ImportRow } from "./ImportDialog";
import { Inspector } from "./Inspector";
import { LeftNav } from "./LeftNav";
import { TopBar } from "./TopBar";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";

export interface DesignAppProps {
  project: { id: string; title: string; theme: string; status: ProjectStatus; folderPath: string };
  blueprint: GameBlueprint;
  revision: number;
  initialElementId: string | null;
}

type Dialog =
  | { kind: "none" }
  | { kind: "add"; type?: ElementType }
  | { kind: "import"; intoSet?: { id: string; name: string }; files?: File[] }
  | { kind: "delete"; target: DeleteTarget };

interface ViewPrefs { zoom: number; mode: "grid" | "list"; collapsed: string[] }
/** Snapshot read by the single global key handler, so it never re-binds or goes stale. */
interface LatestState {
  dialogOpen: boolean;
  actions: DesignActions;
  editor: DesignEditor;
  selectedElementId: string | null;
  sel: Selection;
  detailId: string | null;
  order: string[];
  collapsed: Set<string>;
  view: ViewPrefs;
  closeDetail: () => void;
  updateView: (patch: Partial<ViewPrefs>) => void;
  doc: DesignDoc;
}
const DEFAULT_VIEW: ViewPrefs = { zoom: 190, mode: "grid", collapsed: [] };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const KIND_LABEL: Record<ElementType, string> = {
  symbol_set: "symbol set", symbol: "symbol", game_title: "game title", reel_frame: "reel frame",
  game_background: "game background", button_set: "button set", uploaded: "uploaded element",
  custom: "custom element", other_asset: "uploaded asset",
};

export function DesignApp({ project, blueprint, revision, initialElementId }: DesignAppProps) {
  const router = useRouter();
  const glyphs = useMemo(() => glyphsForTheme(project.theme || project.title), [project.theme, project.title]);
  const initialDoc = useMemo(() => designDocFromBlueprint(blueprint), [blueprint]);
  const editor = useDesignEditor({ projectId: project.id, initialDoc, initialRevision: revision, glyphs });
  const { doc } = editor;
  const palette = blueprint.style.palette;

  const [selection, setSelection] = useState<Selection>(initialElementId ? { kind: "element", id: initialElementId } : null);
  const [detailId, setDetailId] = useState<string | null>(initialElementId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StandaloneFilter>("all");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [navOpen, setNavOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const scrollTargetRef = useRef<string | null>(null);
  const viewKey = `studio.design.view.${project.id}`;
  const [view, setView] = useState<ViewPrefs>(() => {
    if (typeof window === "undefined") return DEFAULT_VIEW;
    try {
      const raw = window.localStorage.getItem(viewKey);
      if (!raw) return DEFAULT_VIEW;
      const stored = JSON.parse(raw) as Partial<ViewPrefs>;
      return {
        zoom: clamp(Number(stored.zoom) || DEFAULT_VIEW.zoom, 110, 320),
        mode: stored.mode === "list" ? "list" : "grid",
        collapsed: Array.isArray(stored.collapsed) ? stored.collapsed.filter((s): s is string => typeof s === "string").slice(0, 300) : [],
      };
    } catch {
      return DEFAULT_VIEW;
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<ImageTarget | null>(null);
  const detailPushed = useRef(false);

  /* ----------------------------- view preferences ---------------------------- */
  const updateView = useCallback((patch: Partial<ViewPrefs>) => {
    const next = { ...view, ...patch };
    setView(next);
    try { window.localStorage.setItem(viewKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [view, viewKey]);

  /* --------------------------------- derived --------------------------------- */
  const allSets = useMemo(() => selectSets(doc), [doc]);
  const allStandalone = useMemo(() => selectStandalone(doc), [doc]);
  const sets = useMemo(() => allSets.filter((v) => matchesQuery(query, v.element.name, v.element.group, ...v.symbols.map((s) => `${s.name} ${s.code}`))), [allSets, query]);
  const standalone = useMemo(() => allStandalone.filter((e) => (filter === "all" || e.type === filter) && matchesQuery(query, e.name, e.group, elementTypeMeta(e.type).label)), [allStandalone, filter, query]);
  const check = useMemo(() => validateBlueprint(applyDesign(blueprint, doc)), [blueprint, doc]);
  const collapsed = useMemo(() => new Set(view.collapsed), [view.collapsed]);
  const referenceUri = useMemo(() => doc.assets.find((a) => a.id === blueprint.style.referenceAssetId)?.uri ?? null, [doc.assets, blueprint.style.referenceAssetId]);
  const sel = useMemo<Selection>(() => {
    if (!selection) return null;
    if (selection.kind === "element") return findElement(doc, selection.id) ? selection : null;
    const found = findSymbol(doc, selection.id);
    return found ? { kind: "symbol", id: selection.id, elementId: found.owner?.id ?? selection.elementId } : null;
  }, [selection, doc]);
  const selectedElementId = sel?.kind === "element" ? sel.id : sel?.kind === "symbol" ? sel.elementId : null;
  const detailElement = detailId ? findElement(doc, detailId) : null;

  useEffect(() => {
    const targetId = scrollTargetRef.current;
    if (!targetId) return;
    scrollTargetRef.current = null;
    document.querySelector(`[data-element-id="${CSS.escape(targetId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [doc, selection]);

  /* ------------------------------ detail navigation --------------------------- */
  const openDetail = useCallback((id: string) => {
    setDetailId(id);
    setSelection({ kind: "element", id });
    const basePath = typeof window !== "undefined" ? window.location.pathname : `/projects/${project.id}`;
    window.history.pushState({ designDetail: true }, "", `${basePath}?element=${encodeURIComponent(id)}`);
    detailPushed.current = true;
    document.getElementById("design-main")?.scrollTo({ top: 0 });
  }, [project.id]);
  const closeDetail = useCallback(() => {
    if (detailPushed.current) {
      detailPushed.current = false;
      window.history.back();
      return;
    }
    setDetailId(null);
    const basePath = typeof window !== "undefined" ? window.location.pathname : `/projects/${project.id}`;
    if (basePath.includes("/elements/")) {
      router.push(`/projects/${encodeURIComponent(project.id)}/design`);
      return;
    }
    window.history.replaceState(window.history.state, "", basePath);
  }, [project.id, router]);
  useEffect(() => {
    const onPop = () => {
      const id = new URL(window.location.href).searchParams.get("element");
      setDetailId(id);
      if (id) setSelection((current) => (current?.kind === "element" && current.id === id ? current : { kind: "element", id }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* ----------------------------------- helpers -------------------------------- */
  const expand = useCallback((id: string) => {
    if (collapsed.has(id)) updateView({ collapsed: view.collapsed.filter((c) => c !== id) });
  }, [collapsed, updateView, view.collapsed]);
  const choose = useCallback((next: Selection, scroll?: string) => {
    if (scroll) scrollTargetRef.current = scroll;
    setSelection(next);
  }, []);
  const nameOfTarget = (target: ImageTarget) =>
    target.kind === "symbol" ? (doc.symbols.find((s) => s.id === target.id)?.name ?? "symbol") : (findElement(doc, target.id)?.name ?? "element");

  const leave = useCallback(async (path: string) => {
    await editor.flush();
    if (!editor.isClean() && !window.confirm("Your latest changes could not be saved. Leave anyway?")) return;
    router.push(path);
  }, [editor, router]);
  const exportBlueprint = useCallback(async () => {
    await editor.flush();
    if (!editor.isClean() && !window.confirm("Your latest changes could not be saved, so the export will not include them. Export anyway?")) return;
    window.location.href = `/api/projects/${project.id}/export`;
  }, [editor, project.id]);

  /* ----------------------------------- actions -------------------------------- */
  const uploadOne = useCallback(async (file: File) => {
    const [result] = await editor.uploadImages([file]);
    if (!result?.asset) {
      editor.pushToast(result?.error ?? "The image could not be uploaded.", "error");
      return null;
    }
    return result.asset;
  }, [editor]);

  const onReplaceChosen = useCallback(async (file: File | undefined) => {
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (!file || !target) return;
    const asset = await uploadOne(file);
    if (!asset) return;
    const name = nameOfTarget(target);
    editor.apply(`Replace image of ${name}`, (d) =>
      target.kind === "symbol"
        ? setSymbolImage(d, target.id, asset)
        : replaceElementArtwork(d, target.id, asset, { source: "upload", notes: `Uploaded ${asset.name}` }),
    );
    editor.pushToast(`Image linked to “${name}”`, "success");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, uploadOne, doc]);

  const actions: DesignActions = {
    select: (next) => choose(next),
    edit: (id) => { choose({ kind: "element", id }); setInspectorOpen(true); setFocusNonce((n) => n + 1); },
    open: (id) => openDetail(id),
    duplicate: (id) => {
      const name = findElement(doc, id)?.name ?? "element";
      const newId = editor.run(`Duplicate ${name}`, (d) => {
        const result = duplicateElement(d, id);
        return result ? { doc: result.doc, value: result.id } : { doc: d, value: "" };
      });
      if (newId) { choose({ kind: "element", id: newId }, newId); editor.pushToast(`Duplicated “${name}”`, "success"); }
    },
    requestDelete: (target) => {
      if (target.kind === "element") {
        const element = findElement(doc, target.id);
        const impact = deletionImpact(doc, target.id);
        if (element && impact) setDialog({ kind: "delete", target: { kind: "element", id: element.id, name: element.name, label: KIND_LABEL[element.type], impact } });
      } else {
        const found = findSymbol(doc, target.id);
        const impact = symbolDeletionImpact(doc, target.id);
        if (found && impact) setDialog({ kind: "delete", target: { kind: "symbol", id: found.symbol.id, name: found.symbol.name, label: "symbol", impact } });
      }
    },
    replaceImage: (target) => { replaceTarget.current = target; fileInput.current?.click(); },
    removeImage: (target) => {
      const name = nameOfTarget(target);
      editor.apply(`Remove image of ${name}`, (d) => (target.kind === "symbol" ? setSymbolImage(d, target.id, null) : setElementImage(d, target.id, null)));
    },
    download: (target) => {
      void (async () => {
        try {
          if (target.kind === "symbol") {
            const symbol = doc.symbols.find((s) => s.id === target.id);
            const asset = symbol ? symbolImage(doc, symbol) : null;
            if (!symbol || !asset) throw new Error("No image linked yet.");
            await downloadImage(asset.uri, symbol.name);
            return;
          }
          const element = findElement(doc, target.id);
          if (!element) return;
          if (element.type === "symbol_set") { await downloadSetArchive(doc, element); return; }
          const image = elementImage(doc, element);
          if (!image) throw new Error("No image linked yet.");
          await downloadImage(image.uri, element.name);
        } catch (error) {
          editor.pushToast(error instanceof Error ? error.message : "Download failed.", "error");
        }
      })();
    },
    rename: (id, name) => { const old = findElement(doc, id)?.name ?? "element"; editor.apply(`Rename ${old}`, (d) => renameElement(d, id, name)); },
    renameSymbol: (id, name) => { const old = doc.symbols.find((s) => s.id === id)?.name ?? "symbol"; editor.apply(`Rename ${old}`, (d) => renameSymbol(d, id, name)); },
    updateElement: (id, patch: ElementPatch, label) => { editor.apply(label, (d) => updateElement(d, id, patch)); },
    updateSymbol: (id, patch: SymbolPatch, label) => { editor.apply(label, (d) => updateSymbol(d, id, patch)); },
    addVariant: (symbolId) => {
      const name = doc.symbols.find((s) => s.id === symbolId)?.name ?? "symbol";
      const id = editor.run(`Add variant to ${name}`, (d) => {
        const r = addVariant(d, symbolId, {});
        return { doc: r.doc, value: r.id };
      });
      if (id) editor.pushToast("Variant added with its own stable id", "success");
    },
    renameVariant: (symbolId, variantId, name) => { editor.apply("Rename variant", (d) => editVariant(d, symbolId, variantId, { name })); },
    duplicateVariant: (symbolId, variantId) => {
      const id = editor.run("Duplicate variant", (d) => {
        const r = duplicateVariant(d, symbolId, variantId);
        return { doc: r.doc, value: r.id };
      });
      if (id) editor.pushToast("Variant duplicated with a new stable id", "success");
    },
    removeVariant: (symbolId, variantId) => { editor.apply("Remove variant", (d) => removeVariant(d, symbolId, variantId)); },
    setVariantImage: (symbolId, variantId, image) => { editor.apply("Set variant image", (d) => editVariant(d, symbolId, variantId, { image })); },
    setSymbolTier: (id, tier: ValueTier) => { editor.apply("Change symbol value tier", (d) => setSymbolTier(d, id, tier)); },
    addSymbol: (setId) => {
      const ids = editor.run("Add symbol", (d, ctx) => { const r = addSymbols(d, setId, [{}], ctx); return { doc: r.doc, value: r.ids }; });
      if (ids?.[0]) { expand(setId); choose({ kind: "symbol", id: ids[0], elementId: setId }); }
    },
    importIntoSet: (setId) => { const set = findElement(doc, setId); if (set) setDialog({ kind: "import", intoSet: { id: set.id, name: set.name } }); },
    duplicateSymbol: (symbolId) => {
      const name = doc.symbols.find((s) => s.id === symbolId)?.name ?? "symbol";
      const result = editor.run(`Duplicate ${name}`, (d) => {
        const r = duplicateSymbol(d, symbolId);
        return r ? { doc: r.doc, value: r.id } : { doc: d, value: "" };
      });
      if (result) editor.pushToast("Symbol duplicated with a new stable id", "success");
    },
    moveSymbol: (setId, symbolId, delta) => { editor.apply(delta > 0 ? "Move symbol down" : "Move symbol up", (d) => moveSymbolInSet(d, setId, symbolId, delta)); },
    manageSet: (setId) => { void editor.flush().then(() => { router.push(`/projects/${project.id}/sets/${setId}`); }); },
    openSymbol: (symbolId) => { void editor.flush().then(() => { router.push(`/projects/${project.id}/symbols/${encodeURIComponent(symbolId)}`); }); },
  };

  const handleAdd = (input: NewElementInput) => {
    const id = editor.run(`Add ${input.name || "element"}`, (d, ctx) => { const r = addElement(d, input, ctx); return { doc: r.doc, value: r.id }; });
    setDialog({ kind: "none" });
    if (!id) return;
    if (detailId) closeDetail();
    expand(id);
    choose({ kind: "element", id }, id);
    editor.pushToast(`Added “${findElementName(id)}”`, "success");
  };
  const findElementName = (id: string) => findElement(editor.doc, id)?.name ?? "element";

  const handleImport = async (rows: ImportRow[], setOptions: ImportSetOptions) => {
    const results = await editor.uploadImages(rows.map((r) => r.file));
    const failed = results.filter((r) => !r.asset);
    const items = results.flatMap((r, i) => (r.asset ? [{ asset: r.asset, name: rows[i].name || r.file.name, elementType: rows[i].type }] : []));
    if (failed.length) editor.pushToast(`${failed.length} image${failed.length === 1 ? "" : "s"} could not be imported — ${failed[0].error}`, "error");
    if (items.length === 0) return;
    const into = dialog.kind === "import" ? dialog.intoSet : undefined;
    if (into) {
      const ids = editor.run(`Import ${items.length} symbol${items.length === 1 ? "" : "s"}`, (d, ctx) => {
        const r = addSymbols(d, into.id, items.map((i) => ({ name: i.name, asset: i.asset })), ctx);
        return { doc: r.doc, value: r.ids };
      });
      if (ids?.[0]) choose({ kind: "symbol", id: ids[0], elementId: into.id });
    } else {
      const ids = editor.run(`Import ${items.length} file${items.length === 1 ? "" : "s"}`, (d, ctx) => {
        const r = importArtwork(d, items, setOptions, ctx);
        return { doc: r.doc, value: r.ids };
      });
      if (ids?.[0]) { if (detailId) closeDetail(); choose({ kind: "element", id: ids[0] }, ids[0]); }
    }
    editor.pushToast(`Imported ${items.length} image${items.length === 1 ? "" : "s"}`, "success");
    setDialog({ kind: "none" });
  };

  const confirmDelete = () => {
    if (dialog.kind !== "delete") return;
    const { target } = dialog;
    setDialog({ kind: "none" });
    editor.apply(`Delete ${target.name}`, (d) => (target.kind === "element" ? deleteElement(d, target.id) : deleteSymbol(d, target.id)));
    if (target.kind === "element") {
      setSelection((current) => (current && (current.kind === "element" ? current.id : current.elementId) === target.id ? null : current));
      if (detailId === target.id) closeDetail();
    }
    editor.pushToast(`Deleted “${target.name}”`, "info", true);
  };

  /* ------------------------------------ keyboard ------------------------------ */
  const latest = useRef<LatestState | null>(null);
  const order = useMemo(() => [...sets.map((v) => v.element.id), ...standalone.map((e) => e.id)], [sets, standalone]);
  useEffect(() => {
    latest.current = { dialogOpen: dialog.kind !== "none", actions, editor, selectedElementId, sel, detailId, order, collapsed, view, closeDetail, updateView, doc };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const L = latest.current;
      if (!L || L.dialogOpen) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      const onButton = !!target?.closest("button:not([data-select-target]), a, summary, [role='menuitem']");
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key;
      if (meta && key.toLowerCase() === "s") { event.preventDefault(); void L.editor.flush(); return; }
      if (typing) return;
      if (meta && key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) L.editor.redo(); else L.editor.undo(); return; }
      if (meta && key.toLowerCase() === "y") { event.preventDefault(); L.editor.redo(); return; }
      if (meta && key.toLowerCase() === "d") { if (L.selectedElementId) { event.preventDefault(); L.actions.duplicate(L.selectedElementId); } return; }
      if (meta || event.altKey) return;
      if (onButton && ["Enter", " ", "Delete", "Backspace"].includes(key)) return;
      const index = L.selectedElementId ? L.order.indexOf(L.selectedElementId) : -1;
      switch (key) {
        case "/": event.preventDefault(); searchRef.current?.focus(); break;
        case "n": case "N": event.preventDefault(); setDialog({ kind: "add" }); break;
        case "Escape": if (L.detailId) L.closeDetail(); else setSelection(null); break;
        case "Enter": if (L.selectedElementId && !L.detailId) { event.preventDefault(); L.actions.open(L.selectedElementId); } break;
        case "F2": if (L.selectedElementId) { event.preventDefault(); L.actions.edit(L.selectedElementId); } break;
        case "Delete": case "Backspace":
          if (L.sel) { event.preventDefault(); L.actions.requestDelete(L.sel.kind === "symbol" ? { kind: "symbol", id: L.sel.id } : { kind: "element", id: L.sel.id }); }
          break;
        case "ArrowDown": case "ArrowUp": {
          if (L.detailId || L.order.length === 0) break;
          event.preventDefault();
          const next = L.order[clamp(index + (key === "ArrowDown" ? 1 : -1), 0, L.order.length - 1)] ?? L.order[0];
          scrollTargetRef.current = next;
          setSelection({ kind: "element", id: next });
          break;
        }
        case "ArrowRight": case "ArrowLeft": {
          const id = L.selectedElementId;
          if (!id || L.detailId || findElement(L.doc, id)?.type !== "symbol_set") break;
          event.preventDefault();
          const isCollapsed = L.collapsed.has(id);
          if (key === "ArrowRight" && isCollapsed) L.updateView({ collapsed: L.view.collapsed.filter((c) => c !== id) });
          if (key === "ArrowLeft" && !isCollapsed) L.updateView({ collapsed: [...L.view.collapsed, id] });
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ------------------------------------- view --------------------------------- */
  const subtitle = `${project.folderPath || "Your Games"} · ${project.theme} · ${allSets.length} sets · ${allStandalone.length} standalone`;
  return (
    <div className="creation-studio flex h-dvh flex-col overflow-hidden"
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDialog({ kind: "import", files: Array.from(event.dataTransfer.files) });
      }}>
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftNav project={project} palette={palette} sets={allSets} standalone={allStandalone} selection={sel} check={check} open={navOpen}
          onClose={() => setNavOpen(false)} onNavigate={(path) => { setNavOpen(false); void leave(path); }}
          onPick={(id) => { setNavOpen(false); if (detailId) openDetail(id); else { expand(id); choose({ kind: "element", id }, id); } }}
          onExport={() => void exportBlueprint()} />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar title={project.title} subtitle={subtitle} saveState={editor.saveState} saveError={editor.saveError} uploading={editor.uploading}
            canUndo={editor.canUndo} canRedo={editor.canRedo} zoom={view.zoom} mode={view.mode} modeDisabled={Boolean(detailId)}
            onUndo={editor.undo} onRedo={editor.redo} onRetry={() => void editor.retry()} onZoom={(zoom) => updateView({ zoom: clamp(zoom, 110, 320) })}
            onMode={(mode) => updateView({ mode })} onImport={() => setDialog({ kind: "import" })} onAdd={() => setDialog({ kind: "add" })}
            onToggleNav={() => setNavOpen((o) => !o)} onToggleInspector={() => setInspectorOpen((o) => !o)} />

          {editor.saveState === "conflict" ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-[11.5px] text-rose-100">
              <Icon name="alert" size={14} />
              <p className="min-w-0 flex-1">This project was changed in another tab or window. Your latest edits here have not been saved.</p>
              <Button className="h-7 text-[11px]" onClick={() => window.location.reload()}>Reload latest</Button>
              <Button variant="danger" className="h-7 text-[11px]" onClick={editor.overwrite}>Overwrite with my version</Button>
            </div>
          ) : null}
          {editor.saveState === "error" ? (
            <div role="alert" className="flex items-center gap-3 border-b border-amber-400/25 bg-amber-400/10 px-4 py-2 text-[11.5px] text-amber-100">
              <Icon name="alert" size={14} /><p>Changes could not be saved: {editor.saveError}</p>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <main id="design-main" className="min-w-0 flex-1 overflow-y-auto"
              onClick={(event) => { if (!(event.target as HTMLElement).closest("[data-element-id],[data-symbol-id],button,input,a,select,label,textarea")) setSelection(null); }}>
              {detailId ? (
                <ElementDetail
                  doc={doc}
                  element={detailElement}
                  palette={palette}
                  title={project.title}
                  zoom={view.zoom}
                  selection={sel}
                  actions={actions}
                  onBack={closeDetail}
                  projectId={project.id}
                  blueprint={blueprint}
                  saveState={editor.saveState}
                  onSave={() => void editor.flush()}
                  onApply={(label, fn) => editor.apply(label, fn)}
                />
              ) : (
                <ElementWorkspace doc={doc} palette={palette} title={project.title} sets={sets} standalone={standalone}
                  totals={{ sets: allSets.length, standalone: allStandalone.length }} selection={sel} collapsed={collapsed} zoom={view.zoom} mode={view.mode}
                  query={query} filter={filter} searchRef={searchRef} actions={actions} onQuery={setQuery} onFilter={setFilter}
                  onToggleSet={(id) => updateView({ collapsed: collapsed.has(id) ? view.collapsed.filter((c) => c !== id) : [...view.collapsed, id] })}
                  onSetAll={(expanded) => updateView({ collapsed: expanded ? [] : allSets.map((v) => v.element.id) })}
                  onAdd={(type) => setDialog({ kind: "add", type })} onImport={() => setDialog({ kind: "import" })} />
              )}
            </main>
            {inspectorOpen ? <button type="button" aria-label="Close inspector" className="fixed inset-0 z-30 bg-black/60 xl:hidden" onClick={() => setInspectorOpen(false)} /> : null}
            <Inspector doc={doc} palette={palette} paletteName={blueprint.style.paletteName} title={project.title} canvas={blueprint.canvas} referenceUri={referenceUri}
              selection={sel} check={check} actions={actions} focusNonce={focusNonce} open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
          </div>
        </div>
      </div>

      <input ref={fileInput} type="file" hidden aria-label="Replacement image" accept="image/png,image/jpeg,image/webp"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void onReplaceChosen(file); }} />

      <AddElementDialog open={dialog.kind === "add"} initialType={dialog.kind === "add" ? dialog.type : undefined}
        onClose={() => setDialog({ kind: "none" })} onAdd={handleAdd} uploadImage={uploadOne} />
      <ImportDialog open={dialog.kind === "import"} intoSet={dialog.kind === "import" ? dialog.intoSet : null} initialFiles={dialog.kind === "import" ? dialog.files : undefined}
        onClose={() => setDialog({ kind: "none" })} onImport={handleImport} />
      <DeleteDialog target={dialog.kind === "delete" ? dialog.target : null} onCancel={() => setDialog({ kind: "none" })} onConfirm={confirmDelete} />
      <Toasts toasts={editor.toasts} onDismiss={editor.dismissToast} onUndo={editor.undo} canUndo={editor.canUndo} />
    </div>
  );
}
