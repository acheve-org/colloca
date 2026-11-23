<script lang="ts">
  import { mergeRanges, type Range } from '../highlight';

  let { text, ranges }: { text: string; ranges: Range[] } = $props();

  type Segment = { text: string; kind: Range['kind'] | null };

  const segments = $derived.by<Segment[]>(() => {
    const out: Segment[] = [];
    let pos = 0;
    for (const r of mergeRanges(ranges)) {
      const start = Math.max(r.start, pos);
      const end = Math.min(r.end, text.length);
      if (end <= start) continue;
      if (start > pos) out.push({ text: text.slice(pos, start), kind: null });
      out.push({ text: text.slice(start, end), kind: r.kind });
      pos = end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos), kind: null });
    return out;
  });
</script>

{#each segments as s, i (i)}{#if s.kind}<span class="hit-{s.kind}">{s.text}</span>{:else}{s.text}{/if}{/each}
