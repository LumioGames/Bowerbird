import * as React from 'react'

/**
 * What the inspector (right column, persistent in ShellLayout) shows. Pages set it:
 * browse → current selection or folder/view; detail → the asset being viewed; review queue → current item.
 * Owner: line web-1 (store + Inspector). Pages of web-2 only call `useInspectorTarget(...)`.
 */
export type InspectorTarget =
  | { kind: 'assets'; ids: string[]; outOfView?: boolean }
  | { kind: 'folder'; path: string }
  | { kind: 'view'; name: string }
  | { kind: 'none' }

let target: InspectorTarget = { kind: 'none' }
const listeners = new Set<() => void>()
export function setInspectorTarget(t: InspectorTarget): void { target = t; listeners.forEach(l => l()) }
export function getInspectorTarget(): InspectorTarget { return target }
export function useInspectorTargetValue(): InspectorTarget {
  return React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => target)
}
/** Set the target while a page is mounted (deps-driven). */
export function useInspectorTarget(t: InspectorTarget, deps: React.DependencyList): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { setInspectorTarget(t) }, deps)
}
