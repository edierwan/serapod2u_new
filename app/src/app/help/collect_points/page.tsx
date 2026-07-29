import { redirect } from 'next/navigation'

/** Alias for mistyped underscore URL → canonical hyphen route */
export default function CollectPointsHelpAliasPage() {
  redirect('/help/collect-points')
}
