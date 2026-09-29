import OutdoorContactForm from '@/components/outdoor/OutdoorContactForm'

export const metadata = { title: 'Contact Us' }

export default function OutdoorContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-16 sm:py-20">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">Contact Us</h1>
      <p className="mt-4 text-[var(--out-muted)] leading-relaxed">
        Reach the Outdoor team for orders, shipping, or product questions. Final support channels will be confirmed with brand content.
      </p>
      <OutdoorContactForm />
    </div>
  )
}
