export type MessageKind = 'info' | 'ok' | 'err';

export const messages = $state<{
  current: { text: string; kind: MessageKind } | null;
  say: (text: string, kind?: MessageKind) => void;
  clear: () => void;
}>({
  current: null,
  say(text, kind = 'info') {
    messages.current = { text, kind };
  },
  clear() {
    messages.current = null;
  },
});
