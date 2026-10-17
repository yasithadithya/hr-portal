/**
 * Small RFC 4180 CSV parser (quoted fields, escaped quotes, commas/newlines inside quotes,
 * CRLF or LF, optional UTF-8 BOM). Used by imports; XLSX is converted to CSV client-side.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/**
 * Parses CSV with a header row into records keyed by normalised header
 * (lower-case, spaces → underscores). `line` is the 1-based line number in the file.
 */
export function parseCsvRecords(text: string): { line: number; record: Record<string, string> }[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.map((r, i) => ({
    line: i + 2,
    record: Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').trim()])),
  }));
}

/** Quotes a value for CSV output when needed. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
