/** Bindings and secrets available to the Worker. */
export type Env = {
  DB: D1Database
  PLAN_ROOM: DurableObjectNamespace
  ASSETS: Fetcher

  /**
   * Path this Worker is mounted at, e.g. `/playlist-builder` on bmxc.camp.
   * Absent (or `/`) means the app owns the whole origin, as on workers.dev.
   * Must match the `base` the SPA was built with.
   */
  APP_BASE?: string

  /** Public — also shipped in the browser bundle. */
  SPOTIFY_CLIENT_ID: string
  /** Secret. Never leaves the Worker. */
  SPOTIFY_CLIENT_SECRET: string
  /** Secret. Encrypts refresh tokens at rest in D1. */
  ENCRYPTION_KEY: string
}
