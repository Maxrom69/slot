"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, Select, TextInput } from "@/components/ui/Controls";
import type { FolderSummary } from "@/lib/workspace/types";

export function PromptDialog({
  open,
  title,
  label,
  description,
  initialValue,
  confirmLabel = "Save",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  label: string;
  description?: string;
  initialValue: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [prevKey, setPrevKey] = useState(`${open}:${initialValue}`);
  const currentKey = `${open}:${initialValue}`;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    if (open) setValue(initialValue);
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!value.trim()}
            onClick={() => onConfirm(value)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label} required>
        <TextInput
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) onConfirm(value);
          }}
        />
      </Field>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  destructive = true,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-xs leading-relaxed text-ink-300">{message}</p>
    </Modal>
  );
}

export function MoveDialog({
  open,
  projectTitle,
  currentPath,
  folders,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  projectTitle: string;
  currentPath: string;
  folders: FolderSummary[];
  onCancel: () => void;
  onConfirm: (path: string) => void;
}) {
  const [path, setPath] = useState(currentPath);
  const [newFolder, setNewFolder] = useState("");
  const [prevKey, setPrevKey] = useState(`${open}:${currentPath}`);
  const currentKey = `${open}:${currentPath}`;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    if (open) {
      setPath(currentPath);
      setNewFolder("");
    }
  }

  const target = newFolder.trim()
    ? [path, newFolder.trim()].filter(Boolean).join("/")
    : path;

  return (
    <Modal
      open={open}
      title="Move to folder"
      description={`Choose a destination for “${projectTitle}”.`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm(target)}>
            Move here
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Destination folder">
          <Select value={path} onChange={(event) => setPath(event.target.value)}>
            <option value="">Your Games (root)</option>
            {folders
              .slice()
              .sort((a, b) => a.path.localeCompare(b.path))
              .map((folder) => (
                <option key={folder.id} value={folder.path}>
                  {folder.path}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label="…or create a sub-folder"
          hint="Created inside the destination selected above."
        >
          <TextInput
            value={newFolder}
            placeholder="e.g. Halloween"
            onChange={(event) => setNewFolder(event.target.value)}
          />
        </Field>
        <p className="rounded-md border border-white/[0.07] bg-ink-950/60 px-2.5 py-2 font-mono text-[11px] text-ink-300">
          → {target || "Your Games (root)"}
        </p>
      </div>
    </Modal>
  );
}

export function NewFolderDialog({
  open,
  parentPath,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  parentPath: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  return (
    <PromptDialog
      open={open}
      title="New folder"
      label="Folder name"
      description={`Created in ${parentPath || "Your Games (root)"}.`}
      initialValue=""
      confirmLabel="Create folder"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
