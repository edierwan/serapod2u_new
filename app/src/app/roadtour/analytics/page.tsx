import { redirect } from 'next/navigation'

/** Legacy "Analytics Overview" — consolidated into Monthly Overview. */
export default function Page() {
  redirect('/roadtour/reporting')
}
