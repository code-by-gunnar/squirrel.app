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
