<script lang="ts">
  import { session } from '$lib/stores/session.svelte';

  // Hidden until session resolution finishes (avoids a flash on reload while
  // the cookie check is in flight). Hidden also when no auth server is
  // reachable — the banner would link to a /login page that can't sign you in.
  let visible = $derived(
    session.ready && !session.user && session.config !== null,
  );
</script>

{#if visible}
  <div class="banner" role="status">
    <span>Modo prueba. Los datos solo viven en este navegador.</span>
    <a href="/login" class="cta">Iniciar sesión o crear cuenta</a>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.4rem 0.9rem;
    font-size: 0.8rem;
    background: color-mix(in oklab, #fbbf24 18%, var(--bg));
    border-bottom: 1px solid color-mix(in oklab, #fbbf24 35%, transparent);
    text-align: center;
  }
  .cta {
    font-weight: 600;
    text-decoration: underline;
    color: inherit;
  }
  @media (max-width: 480px) {
    .banner {
      flex-direction: column;
      gap: 0.2rem;
    }
  }
</style>
