'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getStateFromCapturedLocation } from '@/lib/roadtour/visit-region'
import StateFlag from './StateFlag'

export interface StateMapMetric {
  stateId: string | null
  negeri: string
  shops: number
  scans: number
  consumers: number
  avgPerShop: number
}

interface MalaysiaStateMapProps {
  /** canonical-state-key -> metric (key from getStateFromCapturedLocation) */
  metricsByKey: Map<string, StateMapMetric>
  /** canonical key of the currently selected state */
  selectedKey: string | null
  onSelectState: (stateId: string) => void
  isDark: boolean
  /** rendered if the GeoJSON asset fails to load */
  fallback?: React.ReactNode
}

type LngLat = [number, number]

interface FeatureLike {
  properties: { name: string }
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: any }
}

const VIEW_W = 1000
const VIEW_H = 520
const PAD = 16

const LEVELS = [
  { key: 'veryHigh', label: 'Very High', color: '#1e3a8a' },
  { key: 'high', label: 'High', color: '#2563eb' },
  { key: 'medium', label: 'Medium', color: '#3b82f6' },
  { key: 'low', label: 'Low', color: '#93c5fd' },
  { key: 'veryLow', label: 'Very Low', color: '#dbeafe' },
] as const

function canonicalKey(name: string | null | undefined): string {
  return getStateFromCapturedLocation(name) || (name || '').trim()
}

export default function MalaysiaStateMap({
  metricsByKey,
  selectedKey,
  onSelectState,
  isDark,
  fallback,
}: MalaysiaStateMapProps) {
  const [features, setFeatures] = useState<FeatureLike[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let aborted = false
    const controller = new AbortController()
    fetch('/maps/malaysia-states.geojson', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`map load failed (${res.status})`)
        return res.json()
      })
      .then((geo) => {
        if (aborted) return
        const feats = Array.isArray(geo?.features) ? (geo.features as FeatureLike[]) : []
        if (feats.length === 0) throw new Error('empty geojson')
        setFeatures(feats)
      })
      .catch((err) => {
        if (aborted) return
        if (err?.name === 'AbortError') return
        console.error('MalaysiaStateMap:', err)
        setLoadError(true)
      })
    return () => {
      aborted = true
      controller.abort()
    }
  }, [])

  // ── Projection (fit-to-bbox equirectangular with latitude correction) ──
  const project = useMemo(() => {
    if (!features) return null
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
    const visit = (c: any) => {
      if (typeof c[0] === 'number') {
        const [lon, lat] = c as LngLat
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      } else {
        for (const p of c) visit(p)
      }
    }
    for (const f of features) visit(f.geometry.coordinates)

    const lat0 = ((minLat + maxLat) / 2) * (Math.PI / 180)
    const kx = Math.cos(lat0) || 1
    const tx = (lon: number) => lon * kx
    const tMinX = tx(minLon), tMaxX = tx(maxLon)
    const spanX = tMaxX - tMinX || 1
    const spanY = maxLat - minLat || 1
    const scale = Math.min((VIEW_W - PAD * 2) / spanX, (VIEW_H - PAD * 2) / spanY)
    const offX = (VIEW_W - spanX * scale) / 2
    const offY = (VIEW_H - spanY * scale) / 2

    return (lon: number, lat: number): [number, number] => {
      const x = offX + (tx(lon) - tMinX) * scale
      const y = offY + (maxLat - lat) * scale
      return [x, y]
    }
  }, [features])

  const paths = useMemo(() => {
    if (!features || !project) return []
    const ringToPath = (ring: LngLat[]) => {
      let d = ''
      ring.forEach((pt, i) => {
        const [x, y] = project(pt[0], pt[1])
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `
      })
      return d + 'Z '
    }
    return features.map((f) => {
      const name = f.properties?.name || ''
      const key = canonicalKey(name)
      let d = ''
      if (f.geometry.type === 'Polygon') {
        for (const ring of f.geometry.coordinates) d += ringToPath(ring)
      } else {
        for (const poly of f.geometry.coordinates) for (const ring of poly) d += ringToPath(ring)
      }
      return { name, key, d }
    })
  }, [features, project])

  const maxScans = useMemo(() => {
    let m = 0
    for (const v of metricsByKey.values()) if (v.scans > m) m = v.scans
    return m
  }, [metricsByKey])

  const noData = maxScans <= 0

  function levelColor(scans: number): string {
    if (scans <= 0 || maxScans <= 0) return isDark ? '#374151' : '#e5e7eb'
    const r = scans / maxScans
    if (r > 0.8) return LEVELS[0].color
    if (r > 0.6) return LEVELS[1].color
    if (r > 0.4) return LEVELS[2].color
    if (r > 0.2) return LEVELS[3].color
    return LEVELS[4].color
  }

  if (loadError) {
    return <>{fallback}</>
  }

  if (!features) {
    return (
      <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
        <div className="animate-pulse">Loading map…</div>
      </div>
    )
  }

  const hovered = hoverKey ? metricsByKey.get(hoverKey) : null
  const hoveredName = paths.find((p) => p.key === hoverKey)?.name || hovered?.negeri || ''
  const strokeColor = isDark ? '#0f172a' : '#ffffff'

  return (
    <div className="relative" ref={containerRef}
      onMouseMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }}
    >
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto" role="img" aria-label="Malaysia states performance map">
        {paths.map((p) => {
          const metric = metricsByKey.get(p.key)
          const isSelected = selectedKey === p.key
          const isHover = hoverKey === p.key
          return (
            <path
              key={p.name}
              d={p.d}
              fill={levelColor(metric?.scans || 0)}
              stroke={isSelected ? '#f59e0b' : strokeColor}
              strokeWidth={isSelected ? 2.5 : 0.8}
              opacity={isHover ? 0.85 : 1}
              style={{ cursor: metric?.stateId ? 'pointer' : 'default', transition: 'opacity .12s' }}
              onMouseEnter={() => setHoverKey(p.key)}
              onMouseLeave={() => setHoverKey((k) => (k === p.key ? null : k))}
              onClick={() => { if (metric?.stateId) onSelectState(metric.stateId) }}
            />
          )
        })}
      </svg>

      {/* Tooltip */}
      {hoverKey && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(pointer.x + 12, (containerRef.current?.clientWidth || VIEW_W) - 170),
            top: pointer.y + 12,
            minWidth: 150,
          }}
        >
          <div className="flex items-center gap-1.5 font-semibold mb-1">
            <StateFlag stateName={hoveredName} />
            {hoveredName || 'Unknown'}
          </div>
          {hovered ? (
            <div className="space-y-0.5 text-muted-foreground">
              <div className="flex justify-between gap-4"><span>Total Shops</span><span className="font-medium text-foreground">{hovered.shops.toLocaleString()}</span></div>
              <div className="flex justify-between gap-4"><span>Total Scans</span><span className="font-medium text-foreground">{hovered.scans.toLocaleString()}</span></div>
              <div className="flex justify-between gap-4"><span>Consumers</span><span className="font-medium text-foreground">{hovered.consumers.toLocaleString()}</span></div>
              <div className="flex justify-between gap-4"><span>Avg / Shop</span><span className="font-medium text-foreground">{hovered.avgPerShop.toFixed(1)}</span></div>
            </div>
          ) : (
            <div className="text-muted-foreground">No activity</div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 px-1">
        {LEVELS.map((l) => (
          <div key={l.key} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: l.color }} />
            <span className="text-xs text-muted-foreground">{l.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: isDark ? '#374151' : '#e5e7eb' }} />
          <span className="text-xs text-muted-foreground">No data</span>
        </div>
      </div>

      {noData && (
        <div className="absolute inset-x-0 top-3 text-center text-xs text-muted-foreground">
          No scan activity for the selected filters.
        </div>
      )}
    </div>
  )
}
