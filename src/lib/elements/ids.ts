/**
 * Stable id management. Ids are never reused within a library: every
 * generator reserves from the live id set, so duplication and deletion can
 * never produce a collision or a dangling reference.
 */

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export function isStableId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Smallest free `${prefix}-${n}`, reserved in `taken`. */
export function newStableId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  const id = `${prefix}-${n}`;
  taken.add(id);
  return id;
}

/** Unique copy id derived from the source id. */
export function copyStableId(sourceId: string, taken: Set<string>): string {
  const base = sourceId.replace(/-copy(-\d+)?$/i, "");
  let candidate = `${base}-copy`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-copy-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/** "Name copy", "Name copy 2", … capped at 80 chars. */
export function copyName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = base.replace(/\s+copy(\s+\d+)?$/i, "");
  let candidate = `${root} copy`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${root} copy ${n}`;
    n += 1;
  }
  return candidate.slice(0, 80);
}

export function cleanName(raw: unknown, fallback: string, max = 80): string {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return text || fallback;
}

export function cleanTags(raw: unknown, max = 12): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
