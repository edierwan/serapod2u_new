import { createAdminClient } from '@/lib/supabase/admin'

export interface StoreBanner {
  id: string
  title: string
  subtitle: string
  badge_text: string
  image_url: string
  link_url: string
  link_text: string
  sort_order: number
}

/**
 * Fetch active store hero banners (server-side).
 * Respects is_active, starts_at, and ends_at scheduling.
 */
export async function listActiveStoreBanners(): Promise<StoreBanner[]> {
  try {
    const supabase = createAdminClient()
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('store_hero_banners' as any)
      .select('id, title, subtitle, badge_text, image_url, link_url, link_text, sort_order')
      .eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order('sort_order', { ascending: true })
      .limit(10)

    if (error) {
      console.error('[listActiveStoreBanners] Error:', error.message)
      return []
    }

    return (data as StoreBanner[]) ?? []
  } catch (err) {
    console.error('[listActiveStoreBanners] Unexpected error:', err)
    return []
  }
}
