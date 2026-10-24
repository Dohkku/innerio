/**
 * Reactive "now". Updated every minute so views that filter by date
 * (/work isOverdue badges, isToday) recompute as time passes
 * without requiring a navigation/reload.
 */
export const now = $state<{ value: Date }>({ value: new Date() });

if (typeof window !== 'undefined') {
  window.setInterval(() => {
    now.value = new Date();
  }, 60_000);
}
