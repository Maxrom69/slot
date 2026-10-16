import fs from "node:fs";
import path from "node:path";

interface TableStore {
  folders: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  project_assets: Record<string, unknown>[];
}

type TableName = keyof TableStore;

const TABLE_DEFAULTS: Record<TableName, () => Record<string, unknown>> = {
  folders: () => {
    const now = new Date().toISOString();
    return {
      id: "",
      name: "",
      parent_path: "",
      path: "",
      created_at: now,
      updated_at: now,
    };
  },
  projects: () => {
    const now = new Date().toISOString();
    return {
      id: "",
      title: "",
      theme: "",
      style_guide: "",
      description: "",
      status: "draft",
      folder_path: "",
      thumbnail_uri: null,
      columns: 5,
      rows: 3,
      payline_count: 20,
      rtp_target: 96,
      volatility: "medium",
      is_demo: false,
      deleted_at: null,
      revision: 0,
      blueprint: {},
      created_at: now,
      updated_at: now,
    };
  },
  project_assets: () => {
    const now = new Date().toISOString();
    return {
      id: "",
      project_id: "",
      name: "",
      mime: "image/png",
      size_bytes: 0,
      data_base64: "",
      created_at: now,
    };
  },
};

const DB_FILE =
  process.env.SLOT_STUDIO_LOCAL_DB_PATH ||
  path.join(/*turbopackIgnore: true*/ process.cwd(), ".local", "slot-studio-db.json");

function loadStoreFromDisk(): TableStore {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ DB_FILE)) {
      const raw = fs.readFileSync(/*turbopackIgnore: true*/ DB_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<TableStore>;
      return {
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        project_assets: Array.isArray(parsed.project_assets) ? parsed.project_assets : [],
      };
    }
  } catch {
    // Fallback to empty store if corrupt
  }
  return { folders: [], projects: [], project_assets: [] };
}

function saveStoreToDisk(store: TableStore): void {
  try {
    const dir = path.dirname(/*turbopackIgnore: true*/ DB_FILE);
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp.${process.pid}`;
    fs.writeFileSync(/*turbopackIgnore: true*/ tmpFile, JSON.stringify(store), "utf8");
    fs.renameSync(/*turbopackIgnore: true*/ tmpFile, /*turbopackIgnore: true*/ DB_FILE);
  } catch {
    // Ignore write errors in read-only environments
  }
}

function cloneStore(store: TableStore): TableStore {
  return JSON.parse(JSON.stringify(store)) as TableStore;
}

function normalizeValueForStorage(col: string, val: unknown): unknown {
  if (val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (col === "blueprint" && typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (!inQuotes && ch === "(") {
      depth += 1;
      current += ch;
    } else if (!inQuotes && ch === ")") {
      depth -= 1;
      current += ch;
    } else if (!inQuotes && depth === 0 && ch === ",") {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function cleanIdentifier(raw: string): string {
  const parts = raw
    .trim()
    .split(".")
    .map((p) => p.trim().replace(/^"|"$/g, ""));
  return parts[parts.length - 1];
}

function stripOuterParens(expr: string): string {
  let s = expr.trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    let inQuotes = false;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === "(") depth += 1;
      else if (!inQuotes && ch === ")") {
        depth -= 1;
        if (depth === 0 && i < s.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (wrapsAll) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}

function splitLogicalTopLevel(expr: string, operator: "and" | "or"): string[] | null {
  const s = expr.trim();
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let lastIdx = 0;
  const opLen = operator.length;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "(") depth += 1;
    else if (!inQuotes && ch === ")") depth -= 1;
    else if (!inQuotes && depth === 0) {
      const prevChar = i > 0 ? s[i - 1] : " ";
      const nextChar = i + opLen < s.length ? s[i + opLen] : " ";
      if (
        /[\s)]/.test(prevChar) &&
        /[\s(]/.test(nextChar) &&
        s.slice(i, i + opLen).toLowerCase() === operator
      ) {
        parts.push(s.slice(lastIdx, i).trim());
        i += opLen - 1;
        lastIdx = i + 1;
      }
    }
  }

  if (parts.length === 0) return null;
  parts.push(s.slice(lastIdx).trim());
  return parts;
}

function sqlLikeToRegExp(pattern: string): RegExp {
  let regex = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "%") regex += ".*";
    else if (ch === "_") regex += ".";
    else if (/[\\^$.*+?()[\]{}|]/.test(ch)) regex += `\\${ch}`;
    else regex += ch;
  }
  regex += "$";
  return new RegExp(regex);
}

function evaluateWhere(
  row: Record<string, unknown>,
  whereClause: string | undefined,
  params: unknown[],
): boolean {
  if (!whereClause || !whereClause.trim()) return true;
  const expr = stripOuterParens(whereClause);
  if (!expr) return true;

  const orParts = splitLogicalTopLevel(expr, "or");
  if (orParts) {
    return orParts.some((part) => evaluateWhere(row, part, params));
  }

  const andParts = splitLogicalTopLevel(expr, "and");
  if (andParts) {
    return andParts.every((part) => evaluateWhere(row, part, params));
  }

  const isNullMatch = /^(.+?)\s+is\s+null$/i.exec(expr);
  if (isNullMatch) {
    const col = cleanIdentifier(isNullMatch[1]);
    return row[col] === null || row[col] === undefined;
  }

  const isNotNullMatch = /^(.+?)\s+is\s+not\s+null$/i.exec(expr);
  if (isNotNullMatch) {
    const col = cleanIdentifier(isNotNullMatch[1]);
    return row[col] !== null && row[col] !== undefined;
  }

  const inMatch = /^(.+?)\s+in\s*\((.+)\)$/i.exec(expr);
  if (inMatch) {
    const col = cleanIdentifier(inMatch[1]);
    const tokens = splitTopLevelCommas(inMatch[2]);
    const values = tokens.map((tok) => {
      const m = /^\$(\d+)$/.exec(tok.trim());
      return m ? params[Number(m[1]) - 1] : tok.replace(/^'|'$/g, "");
    });
    return values.includes(row[col]);
  }

  const likeMatch = /^(.+?)\s+like\s+\$(\d+)$/i.exec(expr);
  if (likeMatch) {
    const col = cleanIdentifier(likeMatch[1]);
    const pattern = String(params[Number(likeMatch[2]) - 1] ?? "");
    const value = String(row[col] ?? "");
    return sqlLikeToRegExp(pattern).test(value);
  }

  const eqMatch = /^(.+?)\s*=\s*\$(\d+)$/i.exec(expr);
  if (eqMatch) {
    const col = cleanIdentifier(eqMatch[1]);
    const paramVal = params[Number(eqMatch[2]) - 1];
    return row[col] === paramVal;
  }

  return true;
}

function projectColumns(
  rows: Record<string, unknown>[],
  selectSpec: string,
  rowMode?: string,
): { rows: unknown[] } {
  const columns = splitTopLevelCommas(selectSpec);

  // Aggregate check: coalesce(sum("project_assets"."size_bytes"), 0)::int
  if (columns.length === 1 && /coalesce\s*\(\s*sum\(/i.test(columns[0])) {
    const colMatch = /sum\(\s*([^)]+)\s*\)/i.exec(columns[0]);
    const colName = colMatch ? cleanIdentifier(colMatch[1]) : "size_bytes";
    const sum = rows.reduce((acc, r) => acc + (Number(r[colName]) || 0), 0);
    return {
      rows: rowMode === "array" ? [[sum]] : [{ total: sum }],
    };
  }

  const colNames = columns.map((c) => cleanIdentifier(c));
  if (rowMode === "array") {
    return {
      rows: rows.map((r) => colNames.map((col) => r[col] ?? null)),
    };
  }
  return {
    rows: rows.map((r) => {
      const obj: Record<string, unknown> = {};
      for (const col of colNames) {
        obj[col] = r[col] ?? null;
      }
      return obj;
    }),
  };
}

export class LocalPgPool {
  private store: TableStore | null = null;
  private inTransaction = false;

  private getStore(): TableStore {
    if (!this.inTransaction) {
      this.store = loadStoreFromDisk();
    } else if (!this.store) {
      this.store = loadStoreFromDisk();
    }
    return this.store;
  }

  private persist(): void {
    if (this.store && !this.inTransaction) {
      saveStoreToDisk(this.store);
    }
  }

  async connect(): Promise<LocalPgPool & { release: () => void }> {
    const self = this;
    return Object.assign(self, {
      release() {
        // no-op for local pool
      },
    });
  }

  async query(
    queryInput: string | { text: string; rowMode?: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number }> {
    const text = (typeof queryInput === "string" ? queryInput : queryInput.text).trim();
    const rowMode = typeof queryInput === "string" ? undefined : queryInput.rowMode;
    const params = values ?? (typeof queryInput === "object" && queryInput.values ? queryInput.values : []);

    // Transaction control statements
    if (/^begin\b/i.test(text)) {
      this.store = loadStoreFromDisk();
      this.inTransaction = true;
      return { rows: [], rowCount: 0 };
    }
    if (/^commit\b/i.test(text)) {
      this.inTransaction = false;
      if (this.store) saveStoreToDisk(this.store);
      return { rows: [], rowCount: 0 };
    }
    if (/^rollback\b/i.test(text) && !/to\s+savepoint/i.test(text)) {
      this.inTransaction = false;
      this.store = loadStoreFromDisk();
      return { rows: [], rowCount: 0 };
    }
    if (/^(savepoint|release\s+savepoint|rollback\s+to\s+savepoint)\b/i.test(text)) {
      return { rows: [], rowCount: 0 };
    }

    // Health check: select 1
    if (/^select\s+1\b/i.test(text)) {
      return {
        rows: rowMode === "array" ? [[1]] : [{ "?column?": 1 }],
        rowCount: 1,
      };
    }

    const store = this.getStore();

    // SELECT
    if (/^select\s+/i.test(text)) {
      const selectMatch =
        /^select\s+([\s\S]+?)\s+from\s+"([^"]+)"([\s\S]*)$/i.exec(text);
      if (!selectMatch) {
        return { rows: [], rowCount: 0 };
      }
      const selectSpec = selectMatch[1];
      const tableName = selectMatch[2] as TableName;
      let tail = selectMatch[3] ?? "";

      // Strip FOR UPDATE
      tail = tail.replace(/\s+for\s+update\s*$/i, "");

      // Extract LIMIT
      let limit: number | null = null;
      const limitMatch = /\s+limit\s+\$(\d+)\s*$/i.exec(tail) || /\s+limit\s+(\d+)\s*$/i.exec(tail);
      if (limitMatch) {
        limit = text.includes(`limit $${limitMatch[1]}`)
          ? Number(params[Number(limitMatch[1]) - 1])
          : Number(limitMatch[1]);
        tail = tail.slice(0, limitMatch.index);
      }

      // Extract ORDER BY
      let orderCol: string | null = null;
      let orderDesc = false;
      const orderMatch = /\s+order\s+by\s+(.+?)(?:\s+(asc|desc))?\s*$/i.exec(tail);
      if (orderMatch) {
        orderCol = cleanIdentifier(orderMatch[1]);
        orderDesc = (orderMatch[2] ?? "asc").toLowerCase() === "desc";
        tail = tail.slice(0, orderMatch.index);
      }

      // Extract WHERE
      let whereClause: string | undefined;
      const whereMatch = /^\s*where\s+([\s\S]+)$/i.exec(tail);
      if (whereMatch) {
        whereClause = whereMatch[1];
      }

      const tableRows = store[tableName] ?? [];
      let matched = tableRows.filter((row) => evaluateWhere(row, whereClause, params));

      if (orderCol) {
        const col = orderCol;
        matched = [...matched].sort((a, b) => {
          const va = String(a[col] ?? "");
          const vb = String(b[col] ?? "");
          return orderDesc ? vb.localeCompare(va) : va.localeCompare(vb);
        });
      }

      if (limit !== null && Number.isFinite(limit)) {
        matched = matched.slice(0, limit);
      }

      const projected = projectColumns(matched, selectSpec, rowMode);
      return { rows: projected.rows, rowCount: projected.rows.length };
    }

    // INSERT
    if (/^insert\s+into\s+/i.test(text)) {
      const insertMatch =
        /^insert\s+into\s+"([^"]+)"\s*\(([^)]+)\)\s*values\s*([\s\S]+)$/i.exec(text);
      if (!insertMatch) return { rows: [], rowCount: 0 };

      const tableName = insertMatch[1] as TableName;
      const cols = splitTopLevelCommas(insertMatch[2]).map((c) => cleanIdentifier(c));
      let valuesAndTail = insertMatch[3].trim();

      let returningSpec: string | null = null;
      const returningMatch = /\s+returning\s+([\s\S]+)$/i.exec(valuesAndTail);
      if (returningMatch) {
        returningSpec = returningMatch[1].trim();
        valuesAndTail = valuesAndTail.slice(0, returningMatch.index).trim();
      }

      let onConflictDoNothing = false;
      if (/\s+on\s+conflict\s+do\s+nothing$/i.test(valuesAndTail)) {
        onConflictDoNothing = true;
        valuesAndTail = valuesAndTail.replace(/\s+on\s+conflict\s+do\s+nothing$/i, "").trim();
      }

      const tupleStrings = splitTopLevelCommas(valuesAndTail);
      const insertedRows: Record<string, unknown>[] = [];
      const tableRows = store[tableName];

      for (const tupleStr of tupleStrings) {
        const inner = stripOuterParens(tupleStr);
        const tokens = splitTopLevelCommas(inner);
        const defaults = TABLE_DEFAULTS[tableName]();
        const newRow: Record<string, unknown> = { ...defaults };

        cols.forEach((col, idx) => {
          const tok = (tokens[idx] ?? "").trim();
          if (/^default$/i.test(tok)) {
            newRow[col] = defaults[col];
          } else if (/^null$/i.test(tok)) {
            newRow[col] = null;
          } else {
            const pMatch = /^\$(\d+)$/.exec(tok);
            const rawVal = pMatch ? params[Number(pMatch[1]) - 1] : tok;
            newRow[col] = normalizeValueForStorage(col, rawVal);
          }
        });

        const existingIdx = tableRows.findIndex((r) => r.id === newRow.id);
        if (existingIdx !== -1) {
          if (onConflictDoNothing) continue;
          tableRows[existingIdx] = newRow;
        } else {
          tableRows.push(newRow);
        }
        insertedRows.push(newRow);
      }

      this.persist();

      if (returningSpec) {
        const projected = projectColumns(insertedRows, returningSpec, rowMode);
        return { rows: projected.rows, rowCount: insertedRows.length };
      }
      return { rows: [], rowCount: insertedRows.length };
    }

    // UPDATE
    if (/^update\s+/i.test(text)) {
      const updateMatch = /^update\s+"([^"]+)"\s+set\s+([\s\S]+)$/i.exec(text);
      if (!updateMatch) return { rows: [], rowCount: 0 };

      const tableName = updateMatch[1] as TableName;
      let setAndTail = updateMatch[2].trim();

      let returningSpec: string | null = null;
      const returningMatch = /\s+returning\s+([\s\S]+)$/i.exec(setAndTail);
      if (returningMatch) {
        returningSpec = returningMatch[1].trim();
        setAndTail = setAndTail.slice(0, returningMatch.index).trim();
      }

      let whereClause: string | undefined;
      const whereMatch = /\s+where\s+([\s\S]+)$/i.exec(setAndTail);
      if (whereMatch) {
        whereClause = whereMatch[1].trim();
        setAndTail = setAndTail.slice(0, whereMatch.index).trim();
      }

      const assignments = splitTopLevelCommas(setAndTail);
      const tableRows = store[tableName] ?? [];
      const updatedRows: Record<string, unknown>[] = [];

      for (const row of tableRows) {
        if (!evaluateWhere(row, whereClause, params)) continue;
        for (const assign of assignments) {
          const m = /^(.+?)\s*=\s*(.+)$/.exec(assign.trim());
          if (!m) continue;
          const col = cleanIdentifier(m[1]);
          const valTok = m[2].trim();
          if (/^null$/i.test(valTok)) {
            row[col] = null;
          } else {
            const pMatch = /^\$(\d+)$/.exec(valTok);
            const rawVal = pMatch ? params[Number(pMatch[1]) - 1] : valTok;
            row[col] = normalizeValueForStorage(col, rawVal);
          }
        }
        updatedRows.push(row);
      }

      this.persist();

      if (returningSpec) {
        const projected = projectColumns(updatedRows, returningSpec, rowMode);
        return { rows: projected.rows, rowCount: updatedRows.length };
      }
      return { rows: [], rowCount: updatedRows.length };
    }

    // DELETE
    if (/^delete\s+from\s+/i.test(text)) {
      const deleteMatch = /^delete\s+from\s+"([^"]+)"([\s\S]*)$/i.exec(text);
      if (!deleteMatch) return { rows: [], rowCount: 0 };

      const tableName = deleteMatch[1] as TableName;
      let tail = (deleteMatch[2] ?? "").trim();

      let returningSpec: string | null = null;
      const returningMatch = /\s+returning\s+([\s\S]+)$/i.exec(tail);
      if (returningMatch) {
        returningSpec = returningMatch[1].trim();
        tail = tail.slice(0, returningMatch.index).trim();
      }

      let whereClause: string | undefined;
      const whereMatch = /^where\s+([\s\S]+)$/i.exec(tail);
      if (whereMatch) {
        whereClause = whereMatch[1].trim();
      }

      const tableRows = store[tableName] ?? [];
      const deletedRows: Record<string, unknown>[] = [];
      const keptRows: Record<string, unknown>[] = [];

      for (const row of tableRows) {
        if (evaluateWhere(row, whereClause, params)) {
          deletedRows.push(row);
        } else {
          keptRows.push(row);
        }
      }

      store[tableName] = keptRows;
      this.persist();

      if (returningSpec) {
        const projected = projectColumns(deletedRows, returningSpec, rowMode);
        return { rows: projected.rows, rowCount: deletedRows.length };
      }
      return { rows: [], rowCount: deletedRows.length };
    }

    return { rows: [], rowCount: 0 };
  }
}
