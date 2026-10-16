"use client";

import { useState, type Ref } from "react";
import { TextArea, TextInput } from "@/components/ui/Controls";

/**
 * Text input that only commits on blur/Enter, so typing produces one history
 * entry. Escape reverts. Blank names are rejected and revert to the stored value.
 */
export function CommitInput({ value, onCommit, label, maxLength = 80, inputRef, className = "", allowEmpty = false, placeholder }: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  maxLength?: number;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setText(value);
  }
  const commit = () => {
    const next = text.replace(/\s+/g, " ").trim();
    if (!next && !allowEmpty) setText(value);
    else if (next !== value) onCommit(next);
    else setText(value);
  };
  return (
    <TextInput ref={inputRef} aria-label={label} value={text} maxLength={maxLength} placeholder={placeholder} className={`creation-input ${className}`}
      onChange={(event) => setText(event.target.value)} onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setText(value);
          event.currentTarget.blur();
        }
      }} />
  );
}

export function CommitTextArea({ value, onCommit, label, maxLength = 800, rows = 3, placeholder }: {
  value: string; onCommit: (value: string) => void; label: string; maxLength?: number; rows?: number; placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setText(value);
  }
  return (
    <TextArea aria-label={label} rows={rows} value={text} maxLength={maxLength} placeholder={placeholder} className="creation-input"
      onChange={(event) => setText(event.target.value)} onBlur={() => (text !== value ? onCommit(text) : undefined)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setText(value);
          event.currentTarget.blur();
        }
      }} />
  );
}
