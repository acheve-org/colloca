<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  }
  let { checked = $bindable(), label, disabled = false, onchange }: Props = $props();
</script>

<label class="toggle">
  <input type="checkbox" role="switch" {disabled} bind:checked onchange={() => onchange?.(checked)} />
  <span>{label}</span>
</label>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--fs-small);
  }
  input {
    height: auto;
    padding: 0;
  }
</style>
