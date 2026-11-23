export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'colloca.theme';

function isMode(v: unknown): v is ThemeMode {
  return v === 'auto' || v === 'light' || v === 'dark';
}

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return isMode(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(mode: ThemeMode): void {
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
}

export const theme = $state<{ mode: ThemeMode }>({ mode: read() });
apply(theme.mode);

export function setMode(mode: ThemeMode): void {
  theme.mode = mode;
  apply(mode);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // storage unavailable: the choice just won't persist
  }
}
