import type { Metadata } from 'next'
import StoreAccountClient from './StoreAccountClient'

export const metadata: Metadata = {
  title: 'My Account',
  description: 'Manage your store profile and account settings.',
}

export default function StoreAccountPage() {
  return <StoreAccountClient />
}
