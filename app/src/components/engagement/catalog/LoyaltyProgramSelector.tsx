import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function LoyaltyProgramSelector({ program, shopView = false }: { program: 'cellera' | 'ellbow'; shopView?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Loyalty program</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-semibold">Program: {program === 'ellbow' ? 'Ellbow Loyalty' : 'Cellera Loyalty'}</span>
          <Badge variant="outline">{program === 'ellbow' ? 'Pet Food' : 'Legacy Vape'}</Badge>
        </div>
      </div>
      <div className="flex rounded-lg bg-muted p-1">
        <Button asChild size="sm" variant={program === 'cellera' ? 'default' : 'ghost'}>
          <Link href={shopView ? '/engagement/catalog' : '/engagement/catalog/admin'}>Cellera Loyalty</Link>
        </Button>
        {shopView ? (
          <Button asChild size="sm" variant={program === 'ellbow' ? 'default' : 'ghost'}>
            <Link href="/engagement/catalog?program=ellbow">Ellbow Loyalty</Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant={program === 'ellbow' ? 'default' : 'ghost'}>
            <Link href="/engagement/catalog/admin?program=ellbow">Ellbow Loyalty</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
