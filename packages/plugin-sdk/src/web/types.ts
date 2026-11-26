/**
 * Web-side plugin interfaces (plugin-system.md「网页接口」, web-shell.md「插槽」).
 * A plugin's web entry default-exports a `WebPlugin`. React, react-dom and this module are provided
 * by the shell at runtime (shared instances), so plugin UIs share the shell's components and theme.
 */
import type { ComponentType } from 'react'
import type {
  ApiClient, AssetDetail, AssetSummary, CheckView, CompareMode, CompareModeSupport, VersionView, LibraryInfo, JobInfo
} from '@bowerbird/schema'
import type { Locale } from '@bowerbird/schema/locale'

export type { CompareMode, CompareModeSupport }

/**
 * Reads an asset's content — the current file or a past version — without the viewer knowing which.
 * Also resolves dependencies by slot name through the .bmeta `slot` relations (ADR-018).
 */
export interface FileSource {
  /** URL of the main file (current or version content). Bundles: the entry file. */
  readonly url: string
  /** The version this source reads; null = current content. */
  readonly version: Pick<VersionView, 'n' | 'hash'> | null
  fetch(signal?: AbortSignal): Promise<ArrayBuffer>
  /** URL of the dependency the file names `slot` (e.g. `chest_basecolor.png`), or null if no relation fills it. */
  slotUrl(slot: string): string | null
  fetchSlot(slot: string, signal?: AbortSignal): Promise<ArrayBuffer | null>
  /** Files inside a bundle asset, relative to the bundle folder. */
  bundleUrl(inner: string): string
}

export interface CompareSide {
  asset: AssetDetail
  source: FileSource
  /** 'A' (left) or 'B' (right). */
  label: 'A' | 'B'
  /** Set when this side is a version of the asset. */
  version: VersionView | null
}

export type ViewerMode = 'detail' | 'quicklook' | 'review' | 'compare'

export interface ViewerProps {
  asset: AssetDetail
  source: FileSource
  mode?: ViewerMode
}

export interface CompareProps {
  left: CompareSide
  right: CompareSide
  mode: CompareMode
  /** Wipe divider position 0..1, drawn and driven by the shell. */
  split: number
  /**
   * An element in the compare page's top bar, before「技术信息」, where the view may put its own options (e.g. the
   * model's「对齐」) with a portal. Null or absent when the host has no such bar: keep the options on the stage then.
   */
  toolbar?: HTMLElement | null
}

export interface GridCellProps {
  asset: AssetSummary
  /** Cell edge in px. */
  size: number
  /** Pointer state from the shell: hovering and the horizontal position 0..1 (video scrub, model turntable). */
  hover: { active: boolean; x: number }
  /** Thumbnail URL if any. */
  thumbnail: string | null
}

/** Browser-rendered thumbnail set returned to the server (ADR-025). */
export interface RenderedSet {
  thumb?: Blob
  poster?: Blob
  scrub?: Blob
  turnaround?: Blob
  preview?: Blob
  aspect?: number
  /** Tech info read in the browser (e.g. full FBX info). */
  tech?: Record<string, number | string | boolean>
}

export interface FormatView {
  Viewer: ComponentType<ViewerProps>
  /** Without it the shell shows two Viewers side by side. The wipe divider is the shell's. */
  Compare?: ComponentType<CompareProps>
  /**
   * Whether this pair can be compared by this plugin (the other side may be another format) and which modes;
   * unavailable modes carry a reason the shell shows as a toast when clicked. null = not handled.
   */
  compareModes?(left: AssetDetail, right: AssetDetail): CompareModeSupport[] | null
  GridCell?: ComponentType<GridCellProps>
  renderThumbnail?(asset: AssetDetail, source: FileSource): Promise<RenderedSet>
  renderSummary?(asset: AssetDetail, source: FileSource): Promise<Blob>
  /** Tech keys to show in the compare table, in order, with display labels. */
  techLabels?: Record<string, string>
  /**
   * The inspector's「技术信息」rows in the page language, in place of one row per tech key — e.g. a model's
   *「贴图 · 3 张 · 最大 1024」. The compare table keeps one row per key (`techLabels`), since it needs the raw values for
   * differences. Null or absent: the shell lists the keys.
   */
  techRows?(asset: AssetDetail, locale: Locale): Array<[label: string, value: string]> | null
  /**
   * The grid badge in the shell's language. The server part writes one badge when it reads the file
   * (`ProbeResult.badge`, e.g.「2,480 面」); the shell shows what this returns for it (grid, list, quick look,
   * detail). Return the badge unchanged (or null) for text it does not know. Called often: keep it cheap and pure.
   */
  formatBadge?(badge: string, locale: Locale): string | null
  /**
   * One sentence on what this kind of file can do once opened, in `locale` — e.g.「能看通道、分屏，还能和四视图对照。」.
   * The first time the grid shows a file of this format, the shell points at it with this sentence under the format's
   * name (ADR-064). Absent, null or empty: no hint for this format.
   */
  intro?(locale: Locale): string | null
}

/**
 * How the shell shows the results of one of this plugin's validators (manifest `contributes.validators`) in the
 * review tab and queue. The validator writes a rule id, a verdict, one message and its measured `values`; these
 * turn them into the shell's language. Absent, or returning null, the shell shows the rule id and the message.
 */
export interface ValidatorView {
  /** Name of the check, e.g.「尺寸与设计对象」. */
  label?(check: CheckView, locale: Locale): string | null
  /** The check's sentence, usually rebuilt from `check.rule` and `check.values`. */
  message?(check: CheckView, locale: Locale): string | null
}

export interface InspectorSectionDef {
  id: string
  title: string
  appliesTo?(asset: AssetDetail): boolean
  Component: ComponentType<{ asset: AssetDetail }>
}
export interface DetailTabDef {
  id: string
  title: string
  appliesTo?(asset: AssetDetail): boolean
  Component: ComponentType<{ asset: AssetDetail }>
}
export interface ToolbarItemDef {
  id: string
  title: string
  /** lucide icon name or a component. */
  icon?: string | ComponentType<{ className?: string }>
  /** Text next to the icon (e.g. a quota). */
  Label?: ComponentType
  /** Popover content opened by the button. */
  Popover?: ComponentType<{ close(): void }>
  onClick?(): void
}
export interface SidebarSectionDef {
  id: string
  title: string
  Component: ComponentType
}
export interface PageDef {
  id: string
  title: string
  Component: ComponentType<{ params: Record<string, string> }>
}
export interface SettingsPageDef {
  id: string
  title: string
  Component: ComponentType
}

export interface UiContributions {
  inspectorSections?: InspectorSectionDef[]
  detailTabs?: DetailTabDef[]
  toolbarItems?: ToolbarItemDef[]
  sidebarSections?: SidebarSectionDef[]
  pages?: PageDef[]
  settingsPages?: SettingsPageDef[]
}

export interface WebPlugin {
  /** Keyed by format id from the manifest. */
  formats?: Record<string, FormatView>
  /** Keyed by validator id from the manifest (`contributes.validators[].id`, the `validator` of a `CheckView`). */
  validators?: Record<string, ValidatorView>
  ui?: UiContributions
}

export function defineWebPlugin(plugin: WebPlugin): WebPlugin { return plugin }

/* ───────────── services the shell gives to plugin UIs ───────────── */

export interface ToastOptions {
  /** Main sentence. */
  title: string
  description?: string
  kind?: 'info' | 'success' | 'warning' | 'error'
  /** Shows「撤销」and keeps the toast longer (ADR-021). */
  undo?: () => void | Promise<void>
  /** Custom action button (e.g.「查看」「挑选…」「切回」). */
  action?: { label: string; onClick: () => void }
  durationMs?: number
}

export interface ConfirmOptions {
  title: string
  body?: string | import('react').ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}

export type ShellRoute =
  | { to: 'browse'; folder?: string; view?: string; query?: string }
  /** `tab`: 'view' | 'relations' | 'versions' | 'review' | 'overview' or a plugin detail-tab id (the shell maps them to its own ids). */
  | { to: 'asset'; id: string; tab?: string }
  | { to: 'compare'; left: string; right: string; leftVersion?: string; rightVersion?: string }
  | { to: 'plugin-page'; plugin: string; page: string; params?: Record<string, string> }
  | { to: 'settings'; section?: string }

export interface ShellApi {
  readonly library: Pick<LibraryInfo, 'id' | 'name' | 'isLocal' | 'versionStore' | 'hasCreators'>
  readonly api: ApiClient
  /** Current actor (`user:<name>` or `user:unnamed`). */
  readonly actor: string
  readonly theme: 'dark' | 'light'
  /**
   * UI language, one of `LOCALES` (ADR-061). Plugins carry their own strings; `useMessages` looks them up in this
   * language, then English, then Chinese. More languages may be added later: treat unknown ones like English.
   */
  readonly locale: Locale
  /** Data dir-independent key/value storage in the browser (per plugin), e.g. remembered viewer options. */
  readonly storage: { get<T>(key: string): T | undefined; set(key: string, value: unknown): void }
  toast(options: ToastOptions): void
  confirm(options: ConfirmOptions): Promise<boolean>
  navigate(route: ShellRoute): void
  /** The shell's asset picker (search + browse); resolves null when cancelled. */
  pickAsset(options?: { title?: string; formats?: string[]; exclude?: string[] }): Promise<AssetSummary | null>
  /** File source for an asset (optionally a version hash). */
  fileSource(asset: AssetDetail, versionHash?: string | null): FileSource
  /** Subscribe to job updates (creation progress). */
  onJob(handler: (job: JobInfo) => void): () => void
}
