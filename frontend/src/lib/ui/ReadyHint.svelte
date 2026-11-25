<script lang="ts">
  import { t } from '../i18n';

  interface Props {
    title: string;
    hint?: string;
    tries?: { label: string; onclick: () => void }[];
  }
  let { title, hint, tries = [] }: Props = $props();
</script>

<div class="ready">
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if tries.length}
    <div class="try">
      <span>{t('empty.try')}</span>
      {#each tries as tr, i (i)}
        <button type="button" class="chip" onclick={tr.onclick}>{tr.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ready {
    max-width: 35rem;
    padding: var(--s-1) 0;
    text-align: left;
  }
  p {
    margin: 0;
  }
  .title {
    font-weight: 600;
  }
  .hint {
    margin-top: var(--s-1);
    color: var(--muted);
  }
  .try {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1);
    margin-top: var(--s-2);
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .chip {
    height: auto;
    padding: 1px var(--s-2);
    border-radius: 999px;
    font-size: var(--fs-small);
  }
</style>
