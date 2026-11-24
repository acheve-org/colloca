import { beginRequest } from './activity.svelte';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Query string from a params object: drops "", null and undefined, keeps false and 0. */
export function qs(params: Record<string, unknown> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === null || v === undefined) continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

export function withQuery(path: string, params?: Record<string, unknown>): string {
  const q = params ? qs(params) : '';
  return q ? `${path}${path.includes('?') ? '&' : '?'}${q}` : path;
}

/** Where to go when the server says the session is over (only used when a password protects Colloca). */
export function toLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  const here = window.location.pathname + window.location.search + window.location.hash;
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}

/** Job polling runs every second for as long as a job lives: it is not a slow request. */
const isPolling = (path: string) => /\/jobs(\?|$)/.test(path);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const end = isPolling(path) ? null : beginRequest();
  try {
    const res = await fetch(path, init);
    if (res.status === 401) toLogin();
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        if (j && j.detail !== undefined) {
          detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
        }
      } catch {
        // body was not JSON: keep statusText
      }
      throw new ApiError(detail, res.status);
    }
    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  } finally {
    end?.();
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const get = <T>(path: string, params?: Record<string, unknown>) =>
  request<T>(withQuery(path, params));
export const post = <T>(path: string, body?: unknown, params?: Record<string, unknown>) =>
  request<T>(withQuery(path, params), json('POST', body ?? {}));
export const patch = <T>(path: string, body: unknown) => request<T>(path, json('PATCH', body));
export const del = (path: string) => request<null>(path, { method: 'DELETE' });
export const upload = <T>(path: string, form: FormData, params?: Record<string, unknown>) =>
  request<T>(withQuery(path, params), { method: 'POST', body: form });
