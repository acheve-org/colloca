<script lang="ts">
  import DataTable from '../src/lib/ui/DataTable.svelte';
  import type { Column } from '../src/lib/ui/DataTable.types';

  type R = { id: number; word: string; n: number };
  let {
    rows,
    columns,
    onselect,
    onactivate,
    probe = $bindable(),
    withInput = false,
    filter0 = '',
  }: {
    rows: R[];
    columns: Column<R>[];
    onselect?: (r: R | null) => void;
    onactivate?: (r: R) => void;
    probe:  { selected: R | null; set: (r: R | null) => void; setFilter: (f: string) => void; setRows: (r: R[]) => void };
    withInput?: boolean;
    filter0?: string;
  } = $props();

  let selected = $state.raw<R | null>(null);
  // svelte-ignore state_referenced_locally
  let data = $state.raw<R[]>(rows);
  // svelte-ignore state_referenced_locally
  let filter = $state(filter0);
  $effect.pre(() => {
    probe.set = (r) => (selected = r);
    probe.setFilter = (f) => (filter = f);
    probe.setRows = (r) => (data = r);
  });
  $effect.pre(() => {
    probe.selected = selected;
  });
</script>

{#snippet cell(row: R, col: Column<R>)}
  {#if withInput && col.key === 'word'}<input aria-label="edit" value={row.word} />{:else}{col.key === 'word' ? row.word : row.id}{/if}
{/snippet}

<DataTable {columns} rows={data} rowKey={(r) => r.id} bind:selected bind:filter {onselect} {onactivate} {cell} rowClass={(r) => `rc-${r.id}`} />
