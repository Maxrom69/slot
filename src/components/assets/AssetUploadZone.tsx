"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { validateAndPrepareUpload, type ValidatedUpload } from "@/lib/assets/upload-helper";

interface Props {
  uploading: boolean;
  onUpload: (files: ValidatedUpload[]) => Promise<void>;
  onError: (message: string) => void;
}

export function AssetUploadZone({ uploading, onUpload, onError }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const validated: ValidatedUpload[] = [];
    const errors: string[] = [];

    for (const f of list) {
      try {
        const item = await validateAndPrepareUpload(f);
        validated.push(item);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Failed to process “${f.name}”.`);
      }
    }

    if (errors.length > 0) {
      onError(errors.join(" "));
    }

    if (validated.length > 0) {
      await onUpload(validated);
    }
  };

  return (
    <div
      data-asset-upload-zone
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          if (!uploading) setIsDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (!uploading && e.dataTransfer.files) {
          void handleFiles(e.dataTransfer.files);
        }
      }}
      className={`relative rounded-xl border border-dashed p-6 text-center transition ${
        isDragOver
          ? "border-accent-500/80 bg-accent-500/[0.08]"
          : "border-white/15 bg-ink-900/60 hover:border-white/30 hover:bg-ink-900"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-label="Upload project assets"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,application/json,audio/mpeg,audio/wav,audio/ogg"
        onChange={(e) => {
          if (e.target.files) {
            void handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      <div className="mx-auto flex max-w-md flex-col items-center">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-ink-300">
          <Icon name="upload" size={20} />
        </span>

        <p className="mt-3 text-[13px] font-medium text-ink-100">
          Drag and drop assets here, or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="focus-ring font-semibold text-accent-400 hover:text-blue-300 disabled:opacity-40"
          >
            browse your files
          </button>
        </p>

        <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
          Supported: <strong>Transparent PNG</strong>, <strong>JPEG</strong>, <strong>WebP</strong>,{" "}
          <strong>Vector SVG</strong>, <strong>Animation metadata (JSON)</strong>, and <strong>Audio</strong>.
          <br />
          Maximum 15 MB per source file. Dimensions validated up to 20,000 × 20,000 px.
        </p>

        {uploading ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] text-sky-200">
            <span className="h-2 w-2 animate-ping rounded-full bg-sky-400" />
            Uploading and validating assets…
          </div>
        ) : null}
      </div>
    </div>
  );
}
