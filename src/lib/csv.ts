export type CsvCell = string | number | null | undefined;

/** Escape a single CSV field per RFC 4180 (quote when it contains "," " or newlines). */
function escapeField(value: CsvCell): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV document from a header row and data rows. Uses CRLF line endings
 * for maximal spreadsheet compatibility; add a UTF-8 BOM at delivery so Excel
 * detects the encoding.
 */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeField).join(","))
    .join("\r\n");
}

/**
 * Parse an RFC-4180 CSV document into rows of string cells. Handles quoted
 * fields (with embedded commas, newlines, and "" escaped quotes), CRLF or LF
 * line endings, and strips a leading UTF-8 BOM. A trailing newline does not
 * produce a phantom empty row. The inverse of `toCsv`.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue; // CR is skipped; the following LF ends the row
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush trailing content that wasn't terminated by a newline.
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  // Drop a trailing fully-empty row (e.g. from a final newline).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
