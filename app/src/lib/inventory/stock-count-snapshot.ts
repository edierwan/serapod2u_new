// Shared, deterministic signature of the *counted* rows of a Stock Count draft.
//
// The Review & Post summary is derived on the client from in-memory rows, but
// the movements that actually post are derived on the server from the persisted
// `stock_count_session_items` frozen by `stock_count_snapshot_hash` at
// "Request Verification Code" time. If those two ever disagree — e.g. an Excel
// import updated React state but was never saved, or an async draft reload
// clobbered freshly imported values — the user can approve numbers that differ
// from what posts.
//
// This module produces one canonical signature over the fields that decide the
// posting (stock configuration identity + physical count + note). The client
// computes it over the exact rows it is about to persist, and the server
// preflight computes it over the rows already persisted. A mismatch means the
// screen is ahead of (or behind) the saved draft and posting must be blocked.

export interface CountedRowSignatureInput {
  stockConfigId: string | null
  variantId: string
  /** null == "not counted". Never coerce a blank to 0. */
  physicalCount: number | null
  note: string
}

interface CanonicalCountedRow {
  c: string
  v: string
  p: number | null
  n: string
}

// Only rows that carry a real physical count or a note participate in a
// posting, and therefore in the signature — this must mirror exactly the set
// `saveDraft` writes to `stock_count_session_items`.
export function canonicalizeCountedRows(rows: CountedRowSignatureInput[]): CanonicalCountedRow[] {
  return rows
    .filter((row) => row.physicalCount !== null || row.note.trim() !== '')
    .map((row) => ({
      c: row.stockConfigId ?? '',
      v: row.variantId,
      p: row.physicalCount,
      n: row.note.trim(),
    }))
    .sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : a.v < b.v ? -1 : a.v > b.v ? 1 : 0))
}

// FNV-1a (32-bit) over the canonical JSON. Small, dependency-free, and safe to
// send over the wire — it never exposes the underlying notes or quantities.
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // >>> 0 forces an unsigned 32-bit result before hex encoding.
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function stockCountRowsSignature(rows: CountedRowSignatureInput[]): string {
  const canonical = canonicalizeCountedRows(rows)
  return `${canonical.length}:${fnv1a(JSON.stringify(canonical))}`
}
