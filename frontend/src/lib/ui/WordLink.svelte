<script lang="ts">
  import { go } from '../router.svelte';

  /** A word in a results table: opens it in the Concordance (a phrase is searched as exact form). */
  let { word, unit = 'lemma' }: { word: string; unit?: string } = $props();

  const effective = $derived(word.includes(' ') ? 'form' : unit);
  const href = $derived(`#/concordance?q=${encodeURIComponent(word)}&unit=${effective}`);

  function onclick(e: MouseEvent): void {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go('concordance', { q: word, unit: effective });
  }
</script>

<a {href} {onclick}>{word}</a>
