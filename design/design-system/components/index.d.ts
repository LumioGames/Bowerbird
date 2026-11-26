/**
 * Bowerbird — the prototype's shared script (components/bundle.js).
 * Plain JavaScript on window.Bowerbird; styles are the bb-* classes in components/bundle.css.
 * The production app is React + lucide-react; this file documents the prototype helpers only.
 */
declare namespace Bowerbird {
  /** Inline SVG for a Lucide icon (0.460.0). `cls`: "bb-icon--12" | "bb-icon--20" | "bb-icon--24". */
  function icon(name: IconName, cls?: string): string;
  /** Every icon name carried in the bundle. */
  const icons: IconName[];

  interface SpringOptions {
    /** Damping ratio. 1 = critically damped, no overshoot (default). 0.8 = slight bounce, for flicks only. */
    damping?: number;
    /** Seconds to reach the target, roughly. Default 0.4; 0.3 for small indicators. Not a duration. */
    response?: number;
    /** Starting value. */
    value?: number;
    /** Called every frame with the live value. */
    onUpdate?: (value: number, atRest: boolean) => void;
    onRest?: (value: number) => void;
  }
  interface Spring {
    readonly value: number;
    readonly velocity: number;
    readonly target: number;
    /** Re-target from the live value, keeping (or replacing) the current velocity. Safe to call mid-flight. */
    set(target: number, opts?: { velocity?: number; damping?: number }): void;
    /** Move without animating — use while the pointer is dragging. */
    jump(value: number): void;
    stop(): void;
  }
  /** An interruptible, velocity-preserving spring using Apple's damping + response parameters. */
  function spring(opts?: SpringOptions): Spring;
  /** Distance (px) a release at `velocity` px/s would still travel; choose the snap point nearest current + project(v). */
  function project(velocity: number, decelerationRate?: number): number;
  /** Progressive resistance for a drag past a boundary. `over`: px past the limit; `dimension`: size of the track. */
  function rubberband(over: number, dimension: number, constant?: number): number;
  /** Pointer history for release velocity: call add(e) on pointermove, velocity() on pointerup. */
  function tracker(): { add(e: PointerEvent): void; reset(): void; velocity(): { x: number; y: number } };
  function reducedMotion(): boolean;

  /** Wire a .bb-seg (role="radiogroup"): thumb position, click, arrow keys. */
  function segmented(root: Element, onChange?: (value: string, item: Element) => void): void;
  /** Wire a .bb-tabs (role="tablist"): indicator bar, click, arrow keys. */
  function tabs(root: Element, onChange?: (value: string, item: Element) => void): void;
  /** Wire an input.bb-slider: paints the filled part and reports the value. */
  function slider(input: HTMLInputElement, onInput?: (value: number) => void): void;
  /** Wire every unwired .bb-seg, .bb-tabs and .bb-slider under `root`. Runs once on DOMContentLoaded. */
  function init(root?: ParentNode): void;

  type Stage = 'reference' | 'production' | 'runtime';
  type Review = 'pending' | 'approved' | 'rejected' | 'exempt';
  type Issue = 'broken' | 'missing' | 'identity' | 'conflict' | 'stale' | 'failed' | 'plugin';
  type Kind = 'image' | 'video' | 'audio' | 'model' | 'doc' | 'unknown';
  type CellState = 'ready' | 'processing' | 'waiting' | 'failed' | 'unknown' | 'missing';

  interface Asset {
    id: string; name: string; path: string; kind: Kind;
    stage: Stage; review: Review; issue?: Issue;
    /** Format info from the plugin, shown bottom-right: "2,480 面", "0:03", "1024²". */
    info?: string;
    state?: CellState; alpha?: boolean; size?: string;
    tags?: string[]; aiTags?: string[]; by?: string;
    /** doc assets */
    title?: string; excerpt?: string;
  }

  /** Markup templates. Each returns an HTML string built from the bb-* classes. */
  namespace html {
    function stage(stage: Stage, label?: false | 'short' | 'full'): string;
    function review(status: Review, label?: boolean): string;
    function issue(type: Issue, label?: boolean): string;
    /** Corner marks for a thumbnail: top-left, top-right, bottom-left, bottom-right. */
    function markStage(stage: Stage): string;
    function markReview(status: Review): string;
    function markIssue(type: Issue, count?: number): string;
    function markInfo(text: string): string;
    function tag(text: string, opts?: { ai?: boolean; color?: string; removable?: boolean }): string;
    function cell(asset: Asset, opts?: { selected?: boolean; arrive?: boolean; hideName?: boolean }): string;
    function row(opts: { icon?: IconName; thumb?: string; label: string; sub?: string; count?: string | number; depth?: number; toggle?: boolean; expanded?: boolean; selected?: boolean; trailing?: string }): string;
    function sec(title: string, body: string, opts?: { collapsed?: boolean; count?: number; by?: string }): string;
    function kv(rows: [string, string][]): string;
    function copy(text: string): string;
    function banner(kind: '' | 'warning' | 'danger', icon: IconName, title: string, text?: string, actions?: string, line?: boolean): string;
    function inspector(asset: Asset): string;
    function kbd(keys: string): string;
  }

  /** Sample library「星落镇」— fixtures shared by every page of the prototype. Not part of the system. */
  namespace demo {
    const assets: Asset[];
    function byName(name: string): Asset;
    function art(kind: string, asset?: Asset): string;
    function sidebar(current?: string): string;
  }

  type IconName = string;
}
