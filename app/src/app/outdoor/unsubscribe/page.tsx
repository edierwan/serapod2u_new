import OutdoorUnsubscribe from '@/components/outdoor/OutdoorUnsubscribe'

export const metadata = { title: 'Unsubscribe' }

export default async function OutdoorUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const token = String(params.token || '').trim()

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-16 sm:py-20">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">Unsubscribe</h1>
      <p className="mt-4 text-[var(--out-muted)] leading-relaxed">
        This stops Outdoor product emails. Your shop account and orders stay as they are.
      </p>
      <OutdoorUnsubscribe token={token} />
    </div>
  )
}
