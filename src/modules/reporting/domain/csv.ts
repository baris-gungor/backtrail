export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | Date | null;
}

const escape = (value: string | number | Date | null): string => {
  if (value === null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** RFC 4180 CSV with a header row and CRLF line ends. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escape(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => escape(c.value(row))).join(','));
  return lines.join('\r\n') + '\r\n';
}
