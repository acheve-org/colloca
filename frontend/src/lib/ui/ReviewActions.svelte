<script lang="ts">
  import { type Candidate, dropTerms, isDropped, restoreTerms, sendToCandidates } from '../candidates.svelte';
  import { t } from '../i18n';
  import { openTerm } from '../term.svelte';

  interface Props {
    item: string;
    pos?: string;
    origin: string;
    /** The candidate's score, its measure and frequency, kept when it is sent to the Candidates table. */
    measure?: string;
    score?: number | null;
    freq?: number | null;
    example?: string;
    flags: { item: string; in_termbase?: string; dropped?: boolean };
  }
  let { item, pos = '', origin, measure = '', score = null, freq = null, example = '', flags }: Props = $props();

  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const candidate = (): Omit<Candidate, 'translation'> => ({ item, pos, origin, measure, score, freq, example });
</script>

<span class="actions">
  <button type="button" title={t('cc.addTermHint')} onclick={stop(() => openTerm({ source: item, pos, origin }))}
    >{t('cc.addTerm')}</button
  >
  <button type="button" title={t('cand.sendHint')} onclick={stop(() => sendToCandidates([candidate()]))}
    >{t('cand.send')}</button
  >
  {#if isDropped(flags)}
    <button type="button" title={t('cand.restoreHint')} onclick={stop(() => restoreTerms([item]))}
      >{t('cand.restore')}</button
    >
  {:else}
    <button type="button" title={t('cand.dropHint')} onclick={stop(() => dropTerms([item]))}>{t('cand.drop')}</button>
  {/if}
</span>

<style>
  .actions {
    display: inline-flex;
    gap: var(--s-1);
  }
  button {
    height: auto;
    padding: 0 var(--s-2);
    font-size: var(--fs-small);
  }
</style>
