<script lang="ts">
  import { corpusSize } from '../corpusSize';
  import { fmt, t } from '../i18n';
  import type { Doc } from '../types';
  import { dismiss } from './dismiss';

  let { docs }: { docs: Doc[] } = $props();

  const uid = $props.id();
  const size = $derived(corpusSize(docs));
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);

  /** 182,400 → "182k"; k is the SI prefix, whatever case the locale's compact form uses. */
  const compact = (n: number) => fmt(n, { notation: 'compact', maximumSignificantDigits: 3 }).replace(/K$/, 'k');
</script>

{#if size}
  <span class="gauge">
    <button
      type="button"
      class="pill"
      class:warn={size.warn}
      aria-expanded={open}
      bind:this={trigger}
      onclick={() => (open = !open)}
    >
      <span class="meter" aria-hidden="true">
        {#each [0, 1, 2, 3] as i (i)}<b class:f={i <= size.bandIndex}></b>{/each}
      </span>
      <span>{t('size.pill', { words: compact(size.total), band: t(`size.band.${size.band}`) })}</span>
      <span aria-hidden="true">▾</span>
    </button>
    {#if open}
      <div class="pop" role="group" aria-labelledby="{uid}-heading" use:dismiss={{ close: () => (open = false), trigger }}>
        <p class="heading" id="{uid}-heading">
          {t('size.heading', { total: fmt(size.total), sentence: t(`size.sentence.${size.band}`) })}
        </p>
        <ul>
          {#each size.rows as r (r.key)}
            <li>
              <span>{t(`size.row.${r.key}`)}</span>
              <span class={r.level}><span aria-hidden="true">{r.level === 'ok' ? '✓' : '~'}</span> {t(r.note)}</span>
            </li>
          {/each}
        </ul>
        {#if size.largest}
          <p class="balance">{t('size.balance', { title: size.largest.title, share: fmt(size.largest.share, { style: 'percent' }) })}</p>
        {/if}
        {#if size.next}
          <p class="next">
            {t('size.next', { band: t(`size.band.${size.next.band}`), at: fmt(size.next.at), more: fmt(size.next.more) })}
          </p>
        {/if}
      </div>
    {/if}
  </span>
{/if}

<style>
  .gauge {
    position: relative;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    border-radius: 999px;
    border-color: var(--accent);
    color: var(--accent);
    font-size: var(--fs-small);
  }
  .pill.warn {
    border-color: var(--status-candidate);
    color: var(--status-candidate);
  }
  .meter {
    display: inline-flex;
    gap: 2px;
  }
  .meter b {
    display: block;
    width: 10px;
    height: 8px;
    border-radius: 2px;
    background: var(--line);
  }
  .meter b.f {
    background: currentColor;
  }
  .pop {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 10;
    box-sizing: border-box;
    width: 22rem;
    margin-top: var(--s-1);
    padding: var(--s-2) var(--s-3);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    color: var(--fg);
    font-size: var(--fs-small);
    font-weight: normal;
  }
  /* Phones: the popover spans the toolbar (the nearest positioned ancestor) instead of hanging off the pill. */
  @media (max-width: 480px) {
    .gauge {
      position: static;
    }
    .pop {
      left: var(--s-2);
      right: var(--s-2);
      width: auto;
    }
  }
  .heading {
    margin: 0;
    font-weight: 600;
  }
  ul {
    margin: var(--s-1) 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
    padding: 2px 0;
    border-bottom: 1px solid var(--line);
  }
  .ok {
    color: var(--status-approved);
  }
  .rough,
  .balance {
    color: var(--status-candidate);
  }
  .balance,
  .next {
    margin: var(--s-1) 0 0;
  }
  .next {
    color: var(--muted);
  }
</style>
