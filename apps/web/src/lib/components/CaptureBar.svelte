<script lang="ts">
  import { triplit } from '$lib/triplit';
  import { LIMITS } from '$lib/limits';

  let { onCaptured }: { onCaptured?: () => void } = $props();

  let value = $state('');
  let inputEl = $state<HTMLInputElement | undefined>(undefined);
  let saving = $state(false);

  export function focus() {
    inputEl?.focus();
  }

  async function save() {
    const title = value.trim();
    if (!title || saving) return;

    saving = true;
    try {
      await triplit.insert('items', {
        title,
        // Sin timestamps adicionales → derivedState() lo lee como 'inbox'.
      });
      value = '';
      onCaptured?.();
    } catch (err) {
      console.error('[capture] failed:', err);
    } finally {
      saving = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      inputEl?.blur();
    }
  }
</script>

<div class="input-bar">
  <input
    bind:this={inputEl}
    bind:value
    onkeydown={onKey}
    type="text"
    placeholder=""
    aria-label="Capturar"
    autocomplete="off"
    spellcheck="false"
    maxlength={LIMITS.title}
  />
</div>
