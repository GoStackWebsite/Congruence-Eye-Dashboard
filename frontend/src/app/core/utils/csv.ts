/** RFC 4180 CSV from rows + column definitions. */
export function toCsv<T>(rows: T[], cols: { label: string; value: (r: T) => unknown }[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(c.value(r))).join(','))].join('\n');
}
