import type { EventPayload, EventType } from '@bowerbird/schema'
import type { EventBus } from './contracts.js'

/** In-process event bus keyed by library id. Handlers never throw into emitters. */
export function createEventBus(): EventBus & { history: Array<{ library: string; type: EventType; data: unknown }> } {
  const handlers = new Map<string, Set<(type: EventType, data: unknown) => void>>()
  const history: Array<{ library: string; type: EventType; data: unknown }> = []
  return {
    history,
    emit<T extends EventType>(library: string, type: T, data: EventPayload<T>) {
      if (history.length > 500) history.splice(0, history.length - 500)
      history.push({ library, type, data })
      for (const key of [library, '*']) for (const h of handlers.get(key) ?? []) { try { h(type, data) } catch { /* isolate */ } }
    },
    on(library, handler) {
      let set = handlers.get(library)
      if (!set) handlers.set(library, (set = new Set()))
      set.add(handler)
      return () => { set!.delete(handler) }
    }
  }
}
