import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Serapod2U - Shop',
  description: 'Browse and shop products from Serapod2U. Quality devices, accessories, and more.',
}

export default function HomePage() {
  redirect('/store')
}