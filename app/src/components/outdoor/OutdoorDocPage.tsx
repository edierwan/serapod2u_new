export function OutdoorDocPage({
  title,
  intro,
  sections,
}: {
  title: string
  intro?: string
  sections: Array<{ heading: string; body: string[] }>
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-16 sm:py-20">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">{title}</h1>
      {intro ? (
        <p className="mt-5 text-[var(--out-muted)] leading-relaxed">{intro}</p>
      ) : null}
      <div className="mt-10 space-y-9">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-xl text-[var(--out-ink)]">{section.heading}</h2>
            <div className="mt-3 space-y-3 text-sm sm:text-[15px] text-[var(--out-muted)] leading-relaxed">
              {section.body.map((p, i) => (
                <p key={`${section.heading}-${i}`}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-12 text-xs text-[var(--out-muted)]">
        Serapod Outdoor · {new Date().getFullYear()}
      </p>
    </div>
  )
}
