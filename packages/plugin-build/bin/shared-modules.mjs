// Modules the shell shares with plugin web bundles at runtime through globalThis.__bowerbird_shared__.
// Plugins must not bundle their own copies: React context and hooks only work with one instance.
export const SHARED_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@bowerbird/plugin-sdk/web']
export const SHARED_GLOBAL = '__bowerbird_shared__'
