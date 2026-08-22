import { redirect } from 'next/navigation'

/** Legacy "Post-Visit Impact Report" — consolidated into Monthly Overview. */
export default function Page() {
  redirect('/roadtour/reporting')
}
