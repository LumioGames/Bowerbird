import * as React from 'react'
import type { ShellApi } from './types'
import { defineMessages, translate } from './i18n'

/**
 * The shell provides `ShellApi` through this context; plugin components read it with `useShell()`.
 * Because the shell shares its instance of this module with plugins at runtime, the context object is the same.
 */
export const ShellContext = React.createContext<ShellApi | null>(null)

export function useShell(): ShellApi {
  const v = React.useContext(ShellContext)
  if (!v) throw new Error('useShell() must be used inside the Bowerbird shell')
  return v
}

const SHELL_MESSAGES = defineMessages({
  'zh-CN': { unsupported: '这个格式不支持' },
  en: { unsupported: 'Not supported by this format' },
  ja: { unsupported: 'この形式には対応していません' },
  ko: { unsupported: '이 형식은 지원하지 않습니다' }
})

/** Shorthand used everywhere a viewer reads a feature the file does not have (ADR-022):「这个格式不支持」. */
export function useUnsupportedToast(): () => void {
  const shell = useShell()
  return React.useCallback(() => shell.toast({ title: translate(SHELL_MESSAGES, shell.locale, 'unsupported'), kind: 'info' }), [shell])
}
