/**
 * Backend Selector — Dual-Backend Configuration
 *
 * Selects between Supabase (production) and direct PostgreSQL (development)
 * based on the DATA_BACKEND environment variable.
 *
 * Usage:
 *   DATA_BACKEND=supabase  → use Supabase JS SDK (production default)
 *   DATA_BACKEND=postgres  → use direct PostgreSQL via pg
 *
 * When unset, defaults to 'supabase' so production is always safe.
 */

export type DataBackend = 'supabase' | 'postgres'

export function getDataBackend(): DataBackend {
  const backend = process.env.DATA_BACKEND?.toLowerCase()
  if (backend === 'postgres' || backend === 'pg') {
    return 'postgres'
  }
  return 'supabase'
}

export function isPostgresMode(): boolean {
  return getDataBackend() === 'postgres'
}

export function isSupabaseMode(): boolean {
  return getDataBackend() === 'supabase'
}
