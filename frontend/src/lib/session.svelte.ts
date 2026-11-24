import { get } from './api';

/** Whether a password protects this Colloca (COLLOCA_PASSWORD) and whether this browser is signed in. */
export const session = $state<{ required: boolean; loaded: boolean }>({ required: false, loaded: false });

export async function loadSession(): Promise<void> {
  try {
    const s = await get<{ required: boolean; authenticated: boolean }>('/api/auth/status');
    session.required = s.required;
  } catch {
    session.required = false;
  } finally {
    session.loaded = true;
  }
}

/** Ends the session and returns to the login page. */
export async function logout(): Promise<void> {
  try {
    await fetch('/logout', { method: 'POST', redirect: 'manual' });
  } finally {
    window.location.assign('/login');
  }
}
