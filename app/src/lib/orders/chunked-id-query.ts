/**
 * PostgREST receives `.in('col', ids)` as an `in.(…)` filter in the query
 * STRING, so a list of UUIDs turns into roughly 38 bytes of URL each. A few
 * hundred ids is enough to cross the proxy's request-line limit and come back
 * as a 414 (or a truncated result), and the Orders list now loads a full order
 * history rather than the most recent 50 — see ORDER_FETCH_LIMIT in
 * OrdersView. Every follow-up lookup keyed by those ids therefore runs in
 * bounded batches and the batches are stitched back together here.
 */

/** ~3.8 KB of ids per request, comfortably inside a default 8 KB header. */
export const ID_QUERY_CHUNK_SIZE = 100

export function chunkIds<T>(ids: readonly T[], size: number = ID_QUERY_CHUNK_SIZE): T[][] {
  if (size <= 0) throw new Error('chunkIds requires a positive size')
  const chunks: T[][] = []
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size) as T[])
  }
  return chunks
}

/**
 * Run one id-keyed query per batch and merge the rows.
 *
 * The first error encountered is returned alongside whatever rows did load, so
 * callers keep the `{ data, error }` shape they already handle. An empty id
 * list issues no request at all.
 */
export async function queryByIdChunks<Row>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  size: number = ID_QUERY_CHUNK_SIZE,
): Promise<{ data: Row[]; error: unknown }> {
  if (ids.length === 0) return { data: [], error: null }
  const results = await Promise.all(chunkIds(ids, size).map(chunk => run(chunk)))
  return {
    data: results.flatMap(result => result.data || []),
    error: results.find(result => result.error)?.error ?? null,
  }
}
