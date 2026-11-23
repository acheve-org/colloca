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
  const typing = isTyping(e.target);
  for (const s of registry) {
    const p = parse(s.keys);
    if (!matches(p, e)) continue;
    if (typing && !p.mod && p.key !== 'Escape') continue;
    if (s.when && !s.when()) continue;
    e.preventDefault();
    s.run(e);
    return;
  }
}

window.addEventListener('keydown', onKeydown);

const SYMBOLS: Record<string, string> = { Escape: 'Esc' };

/** Human-readable keys: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function formatKeys(keys: string): string {
  const p = parse(keys);
  const key = SYMBOLS[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key);
  if (isMac) return `${p.mod ? '⌘' : ''}${p.shift ? '⇧' : ''}${key}`;
  return [p.mod ? 'Ctrl' : '', p.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}
