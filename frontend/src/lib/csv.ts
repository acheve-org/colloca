import { withQuery } from './api';

/** URL that downloads `path` as CSV with the same params as the on-screen query. */
export function csvUrl(path: string, params: Record<string, unknown>): string {
  return withQuery(path, { ...params, format: 'csv' });
}
