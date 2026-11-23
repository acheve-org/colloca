<script lang="ts">
  interface Option {
    value: string;
    label: string;
  }
  interface Props {
    value: string;
    options: Option[];
    label?: string;
    id?: string;
    disabled?: boolean;
    onchange?: (value: string) => void;
  }
  let { value = $bindable(), options, label, id, disabled = false, onchange }: Props = $props();
</script>

<select {id} {disabled} aria-label={label} bind:value onchange={() => onchange?.(value)}>
  {#each options as o (o.value)}
    <option value={o.value}>{o.label}</option>
  {/each}
</select>
