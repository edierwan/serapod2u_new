'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface UserProfile { id: string; organization_id?: string; role_code?: string }

export default function QualityIssuesView({ userProfile }: { userProfile: UserProfile }) {
  // We load data via the server API routes so this client component doesn't need a direct Supabase client
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<any | null>(null)
  const [ackLoadingId, setAckLoadingId] = useState<string | null>(null)

  // Pagination
  const [page, setPage] = useState(1)
  const pageSize = 5

  const load = async () => {
    setLoading(true)
    try {
      const resp = await fetch('/api/manufacturer/adjustments')
      const json = await resp.json()
      if (json.error) {
        console.error(json.error)
        setItems([])
      } else {
        setItems(json.data || [])
      }
    } catch (err) {
      console.error('Failed to load adjustments', err)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const ack = async (id: string) => {
    setAckLoadingId(id)
    try {
      const resp = await fetch(`/api/manufacturer/adjustments/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: 'Acknowledged from manufacturer portal' }) })
      const json = await resp.json()
      if (json.error) {
        console.error(json.error)
        alert('Failed to acknowledge: ' + (json.error || 'Unknown'))
      } else {
        // Refresh list and selected
        await load()
        if (selected?.id === id) {
          setSelected(json.data || selected)
        }
      }
    } catch (err) {
      console.error(err)
    } finally { setAckLoadingId(null) }
  }

  // Derived state for pagination
  const totalPages = Math.ceil(items.length / pageSize)
  const paginatedItems = items.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Quality & Return Issues</h1>
        <div className="text-sm text-gray-500">Visible to Manufacturer members & Super Admin</div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Reported Issues</CardTitle>
              <CardDescription>Reported adjustments for Quality or Return</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div>Loading…</div>
              ) : items.length === 0 ? (
                <div className="text-gray-500">No reported issues.</div>
              ) : (
                <div className="space-y-3">
                  {paginatedItems.map((r) => (
                    <div key={r.id} className={`p-4 rounded border ${selected?.id === r.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{r.stock_adjustment_reasons?.reason_name || r.reason_id}</div>
                          <div className="text-sm text-gray-600">{r.notes || '—'}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-medium">Created by:</span> {r.created_by_user?.full_name || 'Unknown'} 
                            <span className="mx-2">•</span>
                            {new Date(r.created_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm">Manufacturer status: <strong>{r.manufacturer_status || 'pending'}</strong></div>
                          <div className="mt-2 flex gap-2 justify-end">
                            <Button size="sm" variant={selected?.id === r.id ? 'secondary' : 'ghost'} onClick={() => setSelected(r)}>View</Button>
                            {(userProfile.role_code === 'SA' || userProfile.organization_id === r.target_manufacturer_org_id) && (
                              <Button size="sm" onClick={() => ack(r.id)} disabled={ackLoadingId === r.id || r.manufacturer_status === 'acknowledged'}>
                                {ackLoadingId === r.id ? 'Acknowledging...' : (r.manufacturer_status === 'acknowledged' ? 'Acknowledged' : 'Acknowledge')}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Pagination Controls */}
                  {items.length > pageSize && (
                    <div className="flex items-center justify-between pt-4 border-t mt-4">
                      <div className="text-sm text-gray-500">
                        Page {page} of {totalPages}
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page === 1}
                        >
                          <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                        >
                          Next <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Selected adjustment details</CardDescription>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <div className="text-gray-500">Select an item to view details</div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm"><strong>Reason:</strong> {selected.stock_adjustment_reasons?.reason_name || selected.reason_id}</div>
                  <div className="text-sm"><strong>Notes:</strong> {selected.notes || '—'}</div>
                  <div className="text-sm"><strong>Status:</strong> {selected.manufacturer_status}</div>
                  <div className="text-sm"><strong>Created:</strong> {new Date(selected.created_at).toLocaleString()}</div>
                  <div className="text-sm"><strong>By:</strong> {selected.created_by_user?.full_name || 'Unknown'}</div>

                  <div>
                    <h4 className="text-sm font-semibold">Items</h4>
                    <ul className="text-sm text-gray-700 list-disc pl-5">
                      {selected.stock_adjustment_items?.map((it: any) => (
                        <li key={it.id}>{it.variant_id} — {it.adjustment_quantity}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-2">Attachments</h4>
                    {selected.proof_images && selected.proof_images.length > 0 ? (
                      <div className="flex gap-2 flex-wrap">
                        {selected.proof_images.map((url: string) => (
                          <Dialog key={url}>
                            <DialogTrigger asChild>
                              <div className="relative group cursor-pointer">
                                <img src={url} alt="evidence" width={140} height={80} className="border rounded hover:opacity-80 transition-opacity" />
                                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all rounded" />
                              </div>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden bg-black/50 border-none">
                              <DialogTitle className="sr-only">Proof Image</DialogTitle>
                              <div className="flex items-center justify-center w-full h-full">
                                <img src={url} alt="evidence full" className="max-w-full max-h-[90vh] object-contain" />
                              </div>
                            </DialogContent>
                          </Dialog>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400">No attachments</div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-4 border-t">
                    {(userProfile.role_code === 'SA' || userProfile.organization_id === selected.target_manufacturer_org_id) && (
                      <Button onClick={() => ack(selected.id)} disabled={ackLoadingId === selected.id || selected.manufacturer_status === 'acknowledged'}>{ackLoadingId === selected.id ? 'Acknowledging...' : 'Acknowledge'}</Button>
                    )}

                    {userProfile.role_code === 'SA' && (
                      <Button variant="outline" onClick={async () => { const res = prompt('Set status (resolved/rejected)'); if (res) {
                        await fetch(`/api/admin/adjustments/${selected.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: res }) })
                        await load()
                      }}}>Set final status</Button>
                    )}
                  </div>

                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
