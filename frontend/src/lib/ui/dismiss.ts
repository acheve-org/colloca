export interface DismissOptions {
  close: () => void;
  /** The control that opened the popover: Esc returns focus to it, and clicking it is not an outside click. */
  trigger?: HTMLElement | null;
}

/** Svelte action for popovers: an outside press or Esc calls `close`; Esc also focuses `trigger`. */
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
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKey);
  return {
    update(next: DismissOptions) {
      opts = next;
    },
    destroy() {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    },
  };
}
