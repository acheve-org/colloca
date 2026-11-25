<script lang="ts">
  import { t } from '../i18n';
  import { hrefFor } from '../router.svelte';
  import EmptyCard from './EmptyCard.svelte';
  import LinkButton from './LinkButton.svelte';
</script>

{#snippet actions()}
  <LinkButton href={hrefFor('projects')} variant="primary">{t('empty.chooseCorpus')}</LinkButton>
{/snippet}

<EmptyCard icon="corpus" title={t('corpus.selectFirst')} {actions} />
