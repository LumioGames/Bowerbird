/**
 * The grid badge, both ends (ADR-061): the server part writes it once when it reads the file, in the source
 * language (「2,480 面」, builtin-plugins.md「角标」); the web part reads the count back out and shows it in the
 * shell's language (`formatBadge`). Pure.
 */

/** `2,480 面`. */
export function trianglesBadge(n: number): string { return `${n.toLocaleString('en-US')} 面` }

/** The count of a badge written by `trianglesBadge` (`2,480`), or null for anything else. */
export function trianglesOfBadge(badge: string): string | null {
  const m = /^(\d[\d,]*) 面$/.exec(badge)
  return m ? m[1]! : null
}
