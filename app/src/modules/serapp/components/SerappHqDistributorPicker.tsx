'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSerapp } from './SerappContext'

export interface SerappHqDistributorOption {
  id: string
  org_name: string
  org_code: string | null
}

const STORAGE_KEY = 'serapp-hq-distributor-id'

export function useSerappHqDistributors(initialId?: string | null) {
  const { userProfile, isHqSupport } = useSerapp()
  const [distributors, setDistributors] = useState<SerappHqDistributorOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState(initialId || '')

  useEffect(() => {
    if (!isHqSupport) return
    if (initialId) {
      setSelectedId(initialId)
      sessionStorage.setItem(STORAGE_KEY, initialId)
      return
    }
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) setSelectedId(stored)
  }, [initialId, isHqSupport])

  useEffect(() => {
    if (!isHqSupport) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('organizations')
          .select('id, org_name, org_code')
          .eq('parent_org_id', userProfile.organization_id)
          .eq('org_type_code', 'DIST')
          .eq('is_active', true)
          .order('org_name')
          .limit(100)
        if (!cancelled) setDistributors((data || []) as SerappHqDistributorOption[])
      } catch {
        if (!cancelled) setDistributors([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isHqSupport, userProfile.organization_id])

  const selectDistributor = (id: string) => {
    setSelectedId(id)
    if (id) sessionStorage.setItem(STORAGE_KEY, id)
    else sessionStorage.removeItem(STORAGE_KEY)
  }

  const selected = distributors.find((item) => item.id === selectedId) || null

  return {
    isHqSupport,
    distributors,
    loading,
    selectedId,
    selected,
    selectDistributor,
  }
}

export function SerappHqDistributorPicker({
  selectedId,
  distributors,
  loading,
  disabled,
  onChange,
}: {
  selectedId: string
  distributors: SerappHqDistributorOption[]
  loading?: boolean
  disabled?: boolean
  onChange: (distributorId: string) => void
}) {
  return (
    <div className="border-b border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-2">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
        Organization · Distributor
      </label>
      <select
        value={selectedId}
        disabled={disabled || loading}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--sera-line)] bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sera-orange)]"
      >
        <option value="">
          {loading ? 'Loading distributors…' : 'Select distributor…'}
        </option>
        {distributors.map((dist) => (
          <option key={dist.id} value={dist.id}>
            {dist.org_name}
            {dist.org_code ? ` (${dist.org_code})` : ''}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-[var(--sera-muted)]">
        Like a WhatsApp group: HQ and this distributor share the same order chat.
      </p>
    </div>
  )
}
