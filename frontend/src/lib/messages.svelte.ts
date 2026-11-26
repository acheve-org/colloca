import { t } from './i18n';

export type MessageKind = 'info' | 'ok' | 'err';

/** How long an ok or info message stays in the status line before it fades. Errors stay until cleared. */
export const MESSAGE_FADE_MS = 6000;

/** The one pending fade. Every say and clear replaces it, so an old timer never clears a newer message. */
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

function cancelFade(): void {
  if (fadeTimer !== undefined) clearTimeout(fadeTimer);
  fadeTimer = undefined;
}

export const messages = $state<{
  current: { text: string; kind: MessageKind } | null;
  say: (text: string, kind?: MessageKind) => void;
  clear: () => void;
  /** Clears the status line only while it shows the "Working…" of a request now dropped. */
  clearWorking: () => void;
}>({
  current: null,
  say(text, kind = 'info') {
    cancelFade();
    messages.current = { text, kind };
    // "Working…" stays until the request ends, so it never fades.
    if (kind !== 'err' && text !== t('corpus.working')) {
      fadeTimer = setTimeout(() => {
        fadeTimer = undefined;
        messages.current = null;
      }, MESSAGE_FADE_MS);
    }
  },
  clear() {
    cancelFade();
    messages.current = null;
  },
  clearWorking() {
    if (messages.current?.kind === 'info' && messages.current.text === t('corpus.working')) messages.current = null;
  },
});
