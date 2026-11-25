import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Rail from '../src/lib/ui/Rail.svelte';
import { get } from '../src/lib/api';
import { loadSession, logout, session } from '../src/lib/session.svelte';

let assign: ReturnType<typeof vi.fn>;
let status: { required: boolean; authenticated: boolean } | 'down';

beforeEach(() => {
  assign = vi.fn();
  status = { required: true, authenticated: true };
  session.required = false;
  session.loaded = false;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/', search: '', hash: '#/job?x=1', assign },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/logout') return { ok: true, status: 0, type: 'opaqueredirect' } as Response;
    if (url === '/api/auth/status') {
      if (status === 'down') throw new Error('offline');
      return { ok: true, status: 200, json: async () => status } as Response;
    }
    if (url === '/api/needs-login') return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ detail: 'Authentication required' }) } as Response;
    void init;
    return { ok: true, status: 200, json: async () => (url.startsWith('/api/languages') ? {} : []) } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('login redirect', () => {
  it('a 401 from the API sends the browser to the login page, remembering where it was', async () => {
    await expect(get('/api/needs-login')).rejects.toThrow('Authentication required');
    expect(assign).toHaveBeenCalledWith('/login?next=%2F%23%2Fjob%3Fx%3D1');
  });

  it('does not loop on the login page itself', async () => {
    (window.location as unknown as { pathname: string }).pathname = '/login';
    await expect(get('/api/needs-login')).rejects.toThrow();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('session', () => {
  it('knows whether a password is required', async () => {
    await loadSession();
    expect(session).toMatchObject({ required: true, loaded: true });
    status = { required: false, authenticated: true };
    await loadSession();
    expect(session.required).toBe(false);
  });

  it('an unreachable status endpoint means no logout button, not an error', async () => {
    status = 'down';
    await loadSession();
    expect(session).toMatchObject({ required: false, loaded: true });
  });

  it('logout posts to /logout and returns to the login page', async () => {
    await logout();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === '/logout' && c[1]?.method === 'POST')).toBe(true);
    expect(assign).toHaveBeenCalledWith('/login');
  });
});

describe('rail', () => {
  it('shows Log out only when a password protects Colloca', async () => {
    status = { required: false, authenticated: true };
    const first = render(Rail);
    await waitFor(() => expect(session.loaded).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
    first.unmount();
    status = { required: true, authenticated: true };
    render(Rail);
    await waitFor(() => expect(session.required).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const button = await screen.findByRole('button', { name: 'Log out' });
    await fireEvent.click(button);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
  });
});
