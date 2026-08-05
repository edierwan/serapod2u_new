'use client'

import Link from 'next/link'

export default function SerappConversationView() {
  return (
    <div className="space-y-3 px-4 py-6">
      <div className="serapp-card serapp-rise rounded-2xl p-4">
        <p className="serapp-eyebrow">Chat</p>
        <h1 className="mt-2 font-display text-lg font-semibold text-[var(--sera-ink)]">
          Welcome to Serapp
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--sera-muted)]">
          Paste your list in Order, Check availability against warehouse stock, then Confirm into the Current Order Module.
        </p>
      </div>

      <div className="serapp-card serapp-rise rounded-2xl px-4 py-3 text-sm text-[var(--sera-muted)]">
        Conversation threads come in a later phase. For now, start with an order.
      </div>

      <Link
        href="/serapp/order"
        className="serapp-rise inline-flex rounded-xl bg-[var(--sera-orange)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--sera-orange-deep)]"
      >
        Go to Order
      </Link>
    </div>
  )
}
