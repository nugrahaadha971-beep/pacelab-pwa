type Listener = (trigger: (() => void) | null) => void;

let pendingTrigger: (() => void) | null = null;
const listeners = new Set<Listener>();

export function notifySwUpdate(trigger: () => void): void {
  pendingTrigger = trigger;
  for (const fn of listeners) fn(pendingTrigger);
}

export function clearSwUpdate(): void {
  pendingTrigger = null;
  for (const fn of listeners) fn(null);
}

export function subscribeSwUpdate(fn: Listener): () => void {
  listeners.add(fn);
  if (pendingTrigger) fn(pendingTrigger);
  return () => {
    listeners.delete(fn);
  };
}
