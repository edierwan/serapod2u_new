'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Scan, Users, TrendingUp, Calendar, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  organization_id: string
  organizations: { id: string; org_name: string }
}

interface ConsumerActivationsViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function ConsumerActivationsView({ userProfile, onViewChange }: ConsumerActivationsViewProps) {
  const [activations, setActivations] = useState<any[]>([])
  const [stats, setStats] = useState({
    total_scans: 0,
    unique_consumers: 0,
    total_points: 0,
    today_scans: 0
  })
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadActivations()
    loadStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadActivations = async () => {
    try {
      const { data, error } = await supabase
        .from('consumer_activations')
        .select(`
          *,
          qr_codes (
            code,
            products (
              product_name
            )
          )
        `)
        .eq('company_id', userProfile.organizations.id)
        .order('activated_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setActivations(data || [])
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      // Total scans
      const { count: totalScans } = await supabase
        .from('consumer_activations')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', userProfile.organizations.id)

      // Unique consumers
      const { data: uniqueConsumers } = await supabase
        .from('consumer_activations')
        .select('consumer_phone')
        .eq('company_id', userProfile.organizations.id)

      const uniqueCount = new Set(uniqueConsumers?.map((c: any) => c.consumer_phone)).size

      // Total points
      const { data: pointsData } = await supabase
        .from('consumer_activations')
        .select('points_awarded')
        .eq('company_id', userProfile.organizations.id)

      const totalPoints = pointsData?.reduce((sum: number, a: any) => sum + (a.points_awarded || 0), 0) || 0

      // Today's scans
      const today = new Date().toISOString().split('T')[0]
      const { count: todayScans } = await supabase
        .from('consumer_activations')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', userProfile.organizations.id)
        .gte('activated_at', `${today}T00:00:00`)

      setStats({
        total_scans: totalScans || 0,
        unique_consumers: uniqueCount,
        total_points: totalPoints,
        today_scans: todayScans || 0
      })
    } catch (error: any) {
      console.error('Error loading stats:', error)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Consumer Activations</h1>
        <p className="text-gray-600 mt-1">Track consumer QR code scans and engagement</p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Total Scans</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{stats.total_scans}</p>
              </div>
              <Scan className="h-6 w-6 sm:h-8 sm:w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Unique Consumers</p>
                <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.unique_consumers}</p>
              </div>
              <Users className="h-6 w-6 sm:h-8 sm:w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Points Distributed</p>
                <p className="text-xl sm:text-2xl font-bold text-purple-600">{stats.total_points}</p>
              </div>
              <TrendingUp className="h-6 w-6 sm:h-8 sm:w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="mb-2 sm:mb-0">
                <p className="text-xs sm:text-sm text-gray-600">Today&apos;s Scans</p>
                <p className="text-xl sm:text-2xl font-bold text-orange-600">{stats.today_scans}</p>
              </div>
              <Calendar className="h-6 w-6 sm:h-8 sm:w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activations */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Consumer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Points</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lucky Draw</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {activations.map((activation) => (
                  <tr key={activation.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(activation.activated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {activation.consumer_name || 'Anonymous'}
                        </p>
                        <p className="text-xs text-gray-500">{activation.consumer_phone}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {activation.qr_codes?.products?.product_name || 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      {activation.points_awarded > 0 ? (
                        <Badge variant="default" className="bg-green-100 text-green-800">
                          +{activation.points_awarded}
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {activation.lucky_draw_entry_id ? (
                        <Badge variant="default" className="bg-purple-100 text-purple-800">
                          Entered
                        </Badge>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {activation.activation_location ? (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span className="text-xs">{activation.activation_location}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
