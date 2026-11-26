import { ICONS } from './icon-table'

type IconComp = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>

/**
 * Resolve a kebab-case Lucide name (`folder-search`) to its component from the explicit table (icon-table.ts — the bundle
 * carries only those); unknown names fall back to `file`.
 */
export function lucideIcon(name: string): IconComp {
  return (ICONS[name] ?? ICONS['file']!) as IconComp
}

/** Whether a name has its own icon (not the fallback). */
export function hasIcon(name: string): boolean { return name in ICONS }

/** Line widths per size, as the design system draws them (12 px icons are a little bolder). */
const STROKE: Record<number, number> = { 12: 2.25, 16: 1.75, 20: 1.6, 24: 1.5 }

/** Lucide icon by kebab-case name (design-system Icon: Lucide subset, 12 / 16 / 24, stroke 1.75). */
export function Icon({ name, size = 16, className }: { name: string; size?: 12 | 16 | 20 | 24; className?: string }) {
  const C = lucideIcon(name)
  return <C size={size} strokeWidth={STROKE[size] ?? 1.75} className={className} aria-hidden />
}

/** Icon per format id (design-system KIND_ICON); plugin formats without an entry get the generic file. */
export const KIND_ICON: Record<string, string> = { image: 'image', video: 'film', audio: 'audio-lines', model: 'box', doc: 'file-text', unknown: 'file' }
export function kindIcon(format: string | null | undefined): string { return (format && KIND_ICON[format]) || 'file' }
