/**
 * The plugin's compare view: model · model, or a model against an image (with or without a grid).
 * Pairs this plugin does not handle never reach it (compareModes returns null for them).
 */
import type { CompareProps } from '@bowerbird/plugin-sdk/web'
import { pairing } from '../lib/compare-modes'
import { ensureStyles } from '../viewer/styles'
import { ModelCompare } from './ModelCompare'
import { TurnaroundCompare } from './TurnaroundCompare'

export function ModelCompareView(props: CompareProps) {
  ensureStyles()
  const kind = pairing(props.left.asset, props.right.asset)
  if (kind === 'models') return <ModelCompare {...props} />
  if (kind === 'sheet' || kind === 'picture') return <TurnaroundCompare {...props} />
  return null
}
