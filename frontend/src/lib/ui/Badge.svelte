<script lang="ts">
  import { t } from '../i18n';

  type Kind = 'candidate' | 'approved' | 'forbidden' | 'intb' | 'neutral';
  let { kind, label }: { kind: Kind; label?: string } = $props();
  const text = $derived(label ?? (kind === 'neutral' ? '' : t(`badge.${kind}`)));
</script>

<span class="badge {kind}">{text}</span>

<style>
  .badge {
    display: inline-block;
    padding: 0 var(--s-1);
    font-size: var(--fs-small);
    line-height: 16px;
    border: 1px solid currentColor;
    border-radius: var(--radius);
    white-space: nowrap;
  }
  .candidate {
    color: var(--status-candidate);
  }
  .approved {
    color: var(--status-approved);
  }
  .forbidden {
    color: var(--status-forbidden);
    text-decoration: line-through;
  }
  .intb {
    color: var(--accent);
  }
  .neutral {
    color: var(--muted);
  }
</style>
