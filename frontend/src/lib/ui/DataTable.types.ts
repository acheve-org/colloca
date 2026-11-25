export interface Column<Row> {
  key: string;
  label: string;
  /** Right-aligned, tabular numerals. */
  num?: boolean;
  /** CSS width of the column (e.g. "6rem"). */
  width?: string;
  /** Defaults to true. */
  sortable?: boolean;
  /** Text/number shown in the cell and used for filtering and (by default) sorting. */
  value?: (r: Row) => string | number;
  /** Overrides `value` for sorting only. */
  sortValue?: (r: Row) => string | number;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

/** The default cell content for a column; use inside a `cell` snippet as fallback. */
export function cellValue<Row>(row: Row, col: Column<Row>): string | number {
  if (col.value) return col.value(row);
  const v = (row as Record<string, unknown>)[col.key];
  return v === undefined || v === null ? '' : (v as string | number);
}


/** Text folded for filtering: accents and case ignored. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}
