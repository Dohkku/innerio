<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useScope } from '$lib/keyboard.svelte';
  import { escConfirm } from '$lib/stores/esc-confirm.svelte';
  import InspectorPanel from '$lib/components/InspectorPanel.svelte';

  const itemId = $derived(page.params.id ?? '');

  function back(): void {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      void goto('/');
    }
  }

  useScope({
    name: 'items-detail',
    bindings: [
      {
        key: 'Escape',
        description: 'volver',
        whileEditing: true,
        handler: (e) => {
          // 1ª Esc en un campo editable: solo blur. No arma el doble-tap
          // para que el usuario salga del input sin penalizar la salida.
          const t = e.target as HTMLElement | null;
          if (
            t &&
            (t.tagName === 'INPUT' ||
              t.tagName === 'TEXTAREA' ||
              t.isContentEditable)
          ) {
            (t as HTMLElement).blur();
            return;
          }
          escConfirm('(dos veces para volver)', back);
        },
      },
    ],
  });
</script>

<main class="page">
  {#if itemId}
    <InspectorPanel {itemId} onclose={back} />
  {:else}
    <p class="hint">Item no encontrado.</p>
  {/if}
</main>

<style>
  .page {
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto 4rem;
    padding: 0 var(--container-pad-x);
  }
  .hint {
    text-align: center;
    opacity: 0.6;
    margin-top: 4rem;
  }
</style>
