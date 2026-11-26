import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as jsxRuntime from 'react/jsx-runtime'
import * as sdkWeb from '@bowerbird/plugin-sdk/web'
import './styles.css'
import { App } from './app/App'

// Plugin web modules import these from the shell at runtime (@bowerbird/plugin-build, bin/shared-modules.mjs).
;(globalThis as Record<string, unknown>).__bowerbird_shared__ = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  '@bowerbird/plugin-sdk/web': sdkWeb
}

ReactDOMClient.createRoot(document.getElementById('root')!).render(<App />)
