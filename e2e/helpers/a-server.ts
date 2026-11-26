/**
 * Line e2e-a's entry to helpers/server.ts. (Until ab26c09 the CLI served packages/web — the Vite source — and this
 * file started the CLI with the web directory passed explicitly; `bb serve` now finds packages/web/dist itself.)
 */
export { REPO, freePort, startBowerbird, waitIdle, type Bowerbird, type LibrarySource } from './server'
