<script lang="ts">
  import { t, LANGS, LANG_NAMES, locale, setLang } from '../i18n';
  import { setMode, theme, type ThemeMode } from '../theme.svelte';
  import { logout, session } from '../session.svelte';
  import { dismiss } from './dismiss';
  import NavIcon from './NavIcon.svelte';

  const modes: ThemeMode[] = ['auto', 'light', 'dark'];

  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
</script>

<div class="menu">
  <button
    type="button"
    class="trigger"
    aria-haspopup="true"
    aria-expanded={open}
    bind:this={trigger}
    onclick={() => (open = !open)}
  >
    <NavIcon name="menu" />
    <span class="label">{t('nav.menu')}</span>
  </button>
  {#if open}
    <div class="popover" use:dismiss={{ close: () => (open = false), trigger }}>
      <div class="set" role="group" aria-label={t('theme.label')}>
        {#each modes as m (m)}
          <button type="button" aria-pressed={theme.mode === m} onclick={() => setMode(m)}>{t(`theme.${m}`)}</button>
        {/each}
      </div>
      <div class="set" role="group" aria-label={t('lang.label')}>
        {#each LANGS as l (l)}
          <button
            type="button"
            lang={l}
            title={LANG_NAMES[l]}
            aria-label={LANG_NAMES[l]}
            aria-pressed={locale.code === l}
            onclick={() => setLang(l)}>{l.toUpperCase()}</button
          >
        {/each}
      </div>
      {#if session.required}
        <button type="button" class="logout" onclick={logout}>{t('auth.logout')}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }
  .trigger {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 100%;
    height: auto;
    padding: var(--s-2) 0;
    color: var(--rail-muted);
    background: transparent;
    border: 0;
    border-left: 3px solid transparent;
    border-radius: 0;
  }
  .trigger:hover,
  .trigger[aria-expanded='true'] {
    color: var(--rail-fg);
    background: var(--rail-hover);
  }
  .label {
    font-size: 11px;
    line-height: 1.2;
  }
  button:focus-visible {
    outline-color: var(--rail-accent);
  }
  .popover {
    position: absolute;
    left: calc(100% + var(--s-1));
    bottom: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 200px;
    padding: var(--s-2);
    color: var(--rail-fg);
    background: var(--rail-bg);
    border: 1px solid var(--rail-hover);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
  }
  .set {
    display: flex;
    gap: 2px;
  }
  .popover button:not(.trigger) {
    color: var(--rail-muted);
    background: transparent;
    border-color: var(--rail-hover);
  }
  .set button {
    flex: 1;
  }
  .set button[aria-pressed='true'] {
    color: var(--rail-fg);
    background: var(--rail-hover);
    border-color: var(--rail-accent);
  }
  .logout {
    width: 100%;
  }
</style>
