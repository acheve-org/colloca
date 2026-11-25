<script lang="ts">
  import { hrefFor } from '../../router.svelte';
  import { t } from '../../i18n';

  const tiles = [
    { m: 'web', title: 'add.method.web', text: 'add.tile.web' },
    { m: 'up', title: 'add.method.up', text: 'add.tile.up' },
    { m: 'paste', title: 'add.method.paste', text: 'add.tile.paste' },
    { m: 'al', title: 'add.method.al', text: 'add.tile.al' },
  ];
</script>

<div class="tiles">
  {#each tiles as x (x.m)}
    <a class="tile" href={hrefFor('sources-add', { m: x.m })}>
      <strong>{t(x.title)}</strong>
      <span>{t(x.text)}</span>
    </a>
  {/each}
</div>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--s-3);
    padding: var(--s-3);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    text-decoration: none;
  }
  .tile:hover {
    border-color: var(--accent);
  }
  .tile span {
    color: var(--muted);
    font-size: var(--fs-small);
  }
</style>
