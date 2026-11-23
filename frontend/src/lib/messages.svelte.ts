import { t } from './i18n';

export type MessageKind = 'info' | 'ok' | 'err';

export const messages = $state<{
  current: { text: string; kind: MessageKind } | null;
  say: (text: string, kind?: MessageKind) => void;
  clear: () => void;
  /** Clears the status line only while it shows the "Working…" of a request now dropped. */
  clearWorking: () => void;
}>({
  current: null,
  say(text, kind = 'info') {
    messages.current = { text, kind };
  },
  clear() {
    messages.current = null;
  },
  clearWorking() {
    if (messages.current?.kind === 'info' && messages.current.text === t('corpus.working')) messages.current = null;
  },
});
