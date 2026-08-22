import { redirect } from 'next/navigation'

/** Legacy "Account Manager Impact" — replaced by AM Performance. */
export default function Page() {
  redirect('/roadtour/reporting/am-performance')
}
