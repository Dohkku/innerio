/**
 * Sync editable local state from a remote Triplit item, replaying when the
 * id changes OR when remote fields drift from what we last applied (handles
 * boot-race where ciphertext flashes then gets replaced post-decrypt).
 *
 * `signature(item)` is a cheap string fingerprint of the fields you care
 * about. `apply(item, isNewItem)` writes the local `$state` slots and may
 * do one-time work (focus) when `isNewItem`.
 */
export function useItemSync<Item extends { id: string }>(
  getItem: () => Item | null,
  signature: (item: Item) => string,
  apply: (item: Item, isNewItem: boolean) => void,
): void {
  let lastId: string | undefined;
  let lastSig: string | undefined;
  $effect(() => {
    const item = getItem();
    if (!item) return;
    const sig = signature(item);
    const isNew = item.id !== lastId;
    if (!isNew && sig === lastSig) return;
    lastId = item.id;
    lastSig = sig;
    apply(item, isNew);
  });
}
