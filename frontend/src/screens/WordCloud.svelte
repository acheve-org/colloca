<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../lib/api';
  import { scopeParams } from '../lib/corpus.svelte';
  import { layoutCloud, type CloudItem } from '../lib/cloud';
  import { initialParams, keynessMemo, toInt, useRunner } from '../lib/explore.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go } from '../lib/router.svelte';
  import { theme } from '../lib/theme.svelte';
  import type { FrequencyRow, KeynessRow } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import ExploreScreen from './ExploreScreen.svelte';

  const W = 1000;
  const H = 560;
  /** Word colours: tokens that stay readable on the background in both themes. */
  const PALETTE = ['--accent', '--status-approved', '--status-candidate', '--danger', '--hit-equiv-fg', '--fg'];

  const initial = initialParams();
  let source = $state(initial.src === 'keyness' ? 'keyness' : 'frequency');
  let pos = $state(initial.pos ?? 'NOUN,ADJ,VERB');
  let count = $state<number | null>(toInt(initial.n, 80, 10, 200));

  let items = $state.raw<CloudItem[] | null>(null);
  let canvas: HTMLCanvasElement | undefined = $state();
  let osDark = $state(0); // bumped when the OS colour scheme changes (theme "auto")

  const runner = useRunner({
    reset: () => (items = null),
    // A keyness cloud needs this session's Keyness comparison: after a reload, wait quietly.
    autoRun: Object.keys(initial).length > 0 && !(initial.src === 'keyness' && !keynessMemo.last),
    run: () => run(),
  });

  const sourceOptions = $derived([
    { value: 'frequency', label: t('ex.cloud.src.frequency') },
    { value: 'keyness', label: t('ex.cloud.src.keyness') },
  ]);

  function run(): void {
    const n = toInt(count, 80, 10, 200);
    count = n;
    const p = pos.trim();
    let load: (id: number) => Promise<CloudItem[]>;
    if (source === 'keyness') {
      const memo = keynessMemo.last;
      if (!memo) {
        messages.say(t('ex.cloud.needKeyness'), 'err');
        return;
      }
      load = async (id) => {
        const rows = await get<KeynessRow[]>(`/api/corpora/${id}/keyness`, { ...memo, pos: p, limit: n, ...scopeParams() });
        return rows.filter((r) => r.ll > 0).map((r) => ({ word: r.item, weight: r.ll }));
      };
    } else {
      load = async (id) => {
        const rows = await get<FrequencyRow[]>(`/api/corpora/${id}/frequency`, {
          pos: p, exclude_stop: true, limit: n, min_freq: 1, ...scopeParams(),
        });
        return rows.map((r) => ({ word: r.item, weight: r.freq }));
      };
    }
    runner.exec(load, (r) => {
      items = r;
      go('cloud', { src: source, pos: p, n: String(n) });
    });
  }

  function draw(c: HTMLCanvasElement, list: CloudItem[]): void {
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    ctx.fillStyle = token('--bg');
    ctx.fillRect(0, 0, c.width, c.height);
    const font = (size: number) => `600 ${size}px ${token('--font-sans') || 'system-ui, sans-serif'}`;
    const placed = layoutCloud(list, c.width, c.height, (word, size) => {
      ctx.font = font(size);
      return ctx.measureText(word).width;
    });
    ctx.textBaseline = 'top';
    placed.forEach((p, i) => {
      ctx.font = font(p.size);
      ctx.fillStyle = token(PALETTE[i % PALETTE.length]);
      ctx.fillText(p.word, p.x + 3, p.y);
    });
  }

  $effect(() => {
    void theme.mode;
    void osDark;
    if (canvas && items?.length) draw(canvas, items);
  });

  function savePng(): void {
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'wordcloud.png';
    a.click();
  }

  onMount(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const bump = () => osDark++;
    mq?.addEventListener('change', bump);
    return () => mq?.removeEventListener('change', bump);
  });
</script>

<ExploreScreen label={t('ex.cloud.toolbar')} runLabel={t('ex.run.draw')} onrun={run} pending={!items && runner.idle}>
  {#snippet fields()}
    <Field label={t('ex.cloud.source')}>
      <Select label={t('ex.cloud.source')} bind:value={source} options={sourceOptions} />
    </Field>
    <Field label={t('ex.pos')}><input bind:value={pos} size="14" /></Field>
    <Field label={t('ex.cloud.words')}><input type="number" min="10" max="200" bind:value={count} /></Field>
  {/snippet}
  {#snippet extra()}
    <Button onclick={savePng} disabled={!items?.length}>{t('ex.cloud.savePng')}</Button>
  {/snippet}

  {#if items && !items.length}
    <EmptyState title={t('ex.cloud.empty')} />
  {:else if items}
    <div class="cloud" role="img" aria-label={t('ex.cloud.alt')}>
      <canvas bind:this={canvas} width={W} height={H}></canvas>
    </div>
  {:else if !runner.loading}
    <ReadyHint title={t('ex.cloud.start')} hint={t('ex.cloud.startHint')} />
  {/if}
</ExploreScreen>

<style>
  .cloud {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--s-3);
  }
  canvas {
    display: block;
    width: 100%;
    max-width: 1000px;
    height: auto;
    border: 1px solid var(--line);
  }
</style>
