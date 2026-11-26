/**
 * The convention behind `QueryEngine.clearProviders()`: whoever empties the search providers' indexes gets them fed
 * again. The query engine announces the clearing here; the pipeline of the same index database listens and redoes the
 * index stage for every asset. Keyed by the database connection, so engines and pipelines of other libraries never
 * hear each other.
 */
const listeners = new WeakMap<object, Set<() => void>>()

export function onProvidersCleared(db: object, listener: () => void): () => void {
  let set = listeners.get(db)
  if (!set) listeners.set(db, (set = new Set()))
  set.add(listener)
  return () => { set!.delete(listener) }
}

export function providersCleared(db: object): void {
  for (const l of [...(listeners.get(db) ?? [])]) {
    try { l() } catch { /* a listener must not break the caller */ }
  }
}
