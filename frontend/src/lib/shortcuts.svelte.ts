export interface Shortcut {
  id: string;
  keys: string;
  label: string;
  scope?: 'global' | 'table';
  when?: () => boolean;
  run: (e: KeyboardEvent) => void;
}

function detectMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(p);
}

let isMac = detectMac();

/** Override platform detection (tests). */
export function setPlatform(p: 'mac' | 'other'): void {
  isMac = p === 'mac';
}

let registry = $state.raw<Shortcut[]>([]);

const STORE_KEY = 'colloca.keys';

function loadOverrides(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The user's own keys by shortcut id (kept in localStorage); a shortcut without an entry uses its default. */
let overrides = $state.raw<Record<string, string>>(loadOverrides());

/** The keys a shortcut answers to now: the user's choice, else its default. */
export function keysOf(s: Pick<Shortcut, 'id' | 'keys'>): string {
  return overrides[s.id] ?? s.keys;
}

/** Rebind a shortcut (`null` restores its default). */
export function setBinding(id: string, keys: string | null): void {
  const next = { ...overrides };
  if (keys === null) delete next[id];
  else next[id] = keys;
  overrides = next;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

export function resetBindings(): void {
  overrides = {};
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** The shortcut registered under `id`, if any (for tooltips). */
export function keysFor(id: string): string {
  const s = registry.find((x) => x.id === id);
  return s ? keysOf(s) : '';
}

/** Tooltip text with the key: "Accept (A)". Empty key list leaves the text as is. */
export function withKeys(text: string, id: string): string {
  const k = keysFor(id);
  return k ? `${text} (${formatKeys(k)})` : text;
}

let capturing = false;

/** Resolves with the next key combination pressed (Escape cancels with null); the registry is paused meanwhile. */
export function captureKeys(): Promise<string | null> {
  capturing = true;
  return new Promise((resolve) => {
    const onKey = (e: KeyboardEvent): void => {
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      // Let the registry's own listener see (and ignore) this event before resuming.
      setTimeout(() => (capturing = false));
      if (e.key === 'Escape') return resolve(null);
      const primary = isMac ? e.metaKey : e.ctrlKey;
      const mods = [primary ? 'Mod' : '', e.shiftKey && e.key.length > 1 ? 'Shift' : ''].filter(Boolean);
      resolve([...mods, e.key.length === 1 ? e.key.toLowerCase() : e.key].join('+'));
    };
    window.addEventListener('keydown', onKey, true);
  });
}

export function registerShortcut(s: Shortcut): () => void {
  registry = [...registry, s];
  return () => {
    registry = registry.filter((x) => x !== s);
  };
}

export function listShortcuts(): readonly Shortcut[] {
  return registry;
}

interface Parsed {
  mod: boolean;
  shift: boolean;
  key: string;
}

function parse(keys: string): Parsed {
  const parts = keys.split('+');
  // A trailing "+" key yields an empty last part.
  const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  return { mod: mods.includes('Mod'), shift: mods.includes('Shift'), key };
}

function matches(p: Parsed, e: KeyboardEvent): boolean {
  const primary = isMac ? e.metaKey : e.ctrlKey;
  const other = isMac ? e.ctrlKey : e.metaKey;
  if (p.mod ? !primary || other : e.ctrlKey || e.metaKey) return false;
  if (e.altKey) return false;
  if (p.shift && !e.shiftKey) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const want = p.key.length === 1 ? p.key.toLowerCase() : p.key;
  return k === want;
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing || capturing) return;
  const typing = isTyping(e.target);
  // Newest registration wins, so later screens can override earlier ones; a
  // registration whose `when()` is false falls through to older ones.
  for (let i = registry.length - 1; i >= 0; i--) {
    const s = registry[i];
    const p = parse(keysOf(s));
    if (!matches(p, e)) continue;
    if (typing && !p.mod && p.key !== 'Escape') continue;
    if (s.when && !s.when()) continue;
    e.preventDefault();
    s.run(e);
    return;
  }
}

window.addEventListener('keydown', onKeydown);

const SYMBOLS: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓' };

/** Human-readable keys: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function formatKeys(keys: string): string {
  const p = parse(keys);
  const key = SYMBOLS[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key);
  if (isMac) return `${p.mod ? '⌘' : ''}${p.shift ? '⇧' : ''}${key}`;
  return [p.mod ? 'Ctrl' : '', p.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}
