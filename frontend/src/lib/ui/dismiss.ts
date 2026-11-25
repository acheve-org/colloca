export interface DismissOptions {
  close: () => void;
  /** The control that opened the popover: Esc returns focus to it, and clicking it is not an outside click. */
  trigger?: HTMLElement | null;
}

/** Svelte action for popovers: an outside press, Esc or focus moving elsewhere calls `close`; Esc also focuses `trigger`. */
export function dismiss(node: HTMLElement, options: DismissOptions) {
  let opts = options;
  const onPointer = (e: Event) => {
    const target = e.target as Node | null;
    if (target && (node.contains(target) || opts.trigger?.contains(target))) return;
    opts.close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    opts.close();
    opts.trigger?.focus();
  };
  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next) return; // focus left the window, or went nowhere in particular
    if (node.contains(next) || opts.trigger?.contains(next)) return;
    opts.close();
  };
  node.addEventListener('focusout', onFocusOut);
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKey);
  return {
    update(next: DismissOptions) {
      opts = next;
    },
    destroy() {
      node.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    },
  };
}
