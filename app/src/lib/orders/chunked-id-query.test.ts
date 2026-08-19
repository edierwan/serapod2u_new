import { describe, expect, it } from 'vitest'
import { chunkIds, ID_QUERY_CHUNK_SIZE, queryByIdChunks } from './chunked-id-query'

describe('id-keyed queries run in bounded batches', () => {
  it('splits ids into full batches plus a remainder', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
    expect(chunkIds([], 2)).toEqual([])
    expect(chunkIds(Array.from({ length: 250 }, (_, index) => index)).map(chunk => chunk.length))
      .toEqual([ID_QUERY_CHUNK_SIZE, ID_QUERY_CHUNK_SIZE, 50])
  })

  it('issues no request for an empty id list', async () => {
    let calls = 0
    const result = await queryByIdChunks<string>([], () => { calls += 1; return Promise.resolve({ data: [], error: null }) })
    expect(calls).toBe(0)
    expect(result).toEqual({ data: [], error: null })
  })

  // Every batch has to reach the caller: dropping one would silently hide the
  // order items of the oldest orders in the list rather than fail loudly.
  it('merges the rows of every batch in order', async () => {
    const chunks: string[][] = []
    const { data, error } = await queryByIdChunks<{ id: string }>(
      ['1', '2', '3', '4', '5'],
      chunk => { chunks.push(chunk); return Promise.resolve({ data: chunk.map(id => ({ id })), error: null }) },
      2,
    )
    expect(chunks).toEqual([['1', '2'], ['3', '4'], ['5']])
    expect(data.map(row => row.id)).toEqual(['1', '2', '3', '4', '5'])
    expect(error).toBeNull()
  })

  it('surfaces the first batch error alongside the rows that did load', async () => {
    const { data, error } = await queryByIdChunks<{ id: string }>(
      ['1', '2', '3', '4'],
      chunk => Promise.resolve(chunk[0] === '3'
        ? { data: null, error: { message: 'boom' } }
        : { data: chunk.map(id => ({ id })), error: null }),
      2,
    )
    expect(data.map(row => row.id)).toEqual(['1', '2'])
    expect(error).toEqual({ message: 'boom' })
  })
})
