<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../api';
  import { t } from '../i18n';

  interface ModelInfo {
    name: string | null;
    version: string | null;
    size: string | null;
    small: boolean;
  }
  interface Status {
    spacy: string;
    models: Record<string, ModelInfo>;
  }

  let status = $state.raw<Status | null>(null);

  onMount(async () => {
    try {
      status = await get<Status>('/api/status');
    } catch {
      status = null; // purely informational: stay silent when it cannot be read
    }
  });

  const entries = $derived(Object.entries(status?.models ?? {}));
  const anySmall = $derived(entries.some(([, m]) => m.small));
</script>

{#if status}
  <div class="models" class:warn={anySmall} aria-label={t('model.label')}>
    <span>{t('model.label')}:</span>
    {#each entries as [lang, m] (lang)}
      <span class="model" title={m.small ? t('model.smallWarning') : ''}>
        {#if m.name}
          {lang.toUpperCase()} {m.name} {m.version}{#if m.small}
            <span class="flag">⚠ {t('model.small')}</span>{/if}
        {:else}
          {lang.toUpperCase()} <span class="flag">⚠ {t('model.missing')}</span>
        {/if}
      </span>
    {/each}
  </div>
{/if}

<style>
  .models {
    display: flex;
    gap: var(--s-2);
    color: var(--muted);
    white-space: nowrap;
  }
  .flag {
    color: var(--danger);
  }
</style>
