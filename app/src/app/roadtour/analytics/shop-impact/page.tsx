import { redirect } from 'next/navigation'

/** Legacy "Shop Impact Detail" — now the shop drill-down under RoadTour Reporting. */
export default function Page() {
  redirect('/roadtour/reporting/shops')
}
