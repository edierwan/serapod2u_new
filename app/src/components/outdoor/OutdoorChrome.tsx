"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LogOut, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import { useCart } from "@/lib/storefront/cart-context";
import { createClient } from "@/lib/supabase/client";
import OutdoorBrandMark from "@/components/outdoor/OutdoorBrandMark";
import OutdoorNewsletter from "@/components/outdoor/OutdoorNewsletter";
import { outdoorAuthHref } from "@/lib/outdoor/auth-return";

const NAV = [
  { href: "/outdoor/shop", label: "Shop" },
  { href: "/outdoor/about", label: "About" },
  { href: "/outdoor/contact", label: "Contact" },
];

function IconTip({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--out-cream)] px-2 py-1 text-[11px] font-medium leading-none text-[var(--out-ink)] opacity-0 shadow-md transition-opacity duration-150 group-hover/hint:opacity-100"
    >
      {children}
    </span>
  );
}

function staffTabClass(active: boolean) {
  return active
    ? "inline-flex h-10 items-center rounded-full bg-[var(--out-moss)] px-4 text-sm font-semibold text-white"
    : "inline-flex h-10 items-center rounded-full border border-[var(--out-line)] bg-white px-4 text-sm font-semibold text-[var(--out-bark)]";
}

function StaffTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inbox =
    pathname.startsWith("/outdoor/fulfilment") &&
    searchParams.get("tab") === "inbox";
  const orders = pathname.startsWith("/outdoor/fulfilment") && !inbox;
  const products = pathname.startsWith("/outdoor/admin");
  return (
    <div className="border-b border-[var(--out-line)] bg-[var(--out-cream)]">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 py-3 sm:px-8">
        <Link href="/outdoor/admin" className={staffTabClass(products)}>
          Add product
        </Link>
        <Link href="/outdoor/fulfilment" className={staffTabClass(orders)}>
          Follow orders
        </Link>
        <Link
          href="/outdoor/fulfilment?tab=inbox"
          className={staffTabClass(inbox)}
        >
          Messages
        </Link>
      </div>
    </div>
  );
}

const SOCIALS = [
  { label: "Instagram", href: process.env.NEXT_PUBLIC_OUTDOOR_INSTAGRAM },
  { label: "Facebook", href: process.env.NEXT_PUBLIC_OUTDOOR_FACEBOOK },
  { label: "TikTok", href: process.env.NEXT_PUBLIC_OUTDOOR_TIKTOK },
].filter((s): s is { label: string; href: string } => Boolean(s.href));

export default function OutdoorChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const { totalItems } = useCart();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authLabel, setAuthLabel] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [pageSearch, setPageSearch] = useState("");
  const loginHref = outdoorAuthHref("login", pathname, pageSearch);
  const signupHref = outdoorAuthHref("register", pathname, pageSearch);

  useEffect(() => {
    setPageSearch(window.location.search);
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const applyUser = (
      user: {
        email?: string | null;
        user_metadata?: Record<string, unknown>;
      } | null,
    ) => {
      const email = user?.email ?? null;
      const provider = String(user?.user_metadata?.auth_provider || "");
      const username = String(user?.user_metadata?.username || "")
        .replace(/^@/, "")
        .trim();
      const social =
        provider === "twitter" ||
        provider === "tiktok" ||
        provider === "instagram";
      setAuthEmail(email);
      setAuthLabel(
        social && username ? username : email ? email.split("@")[0] : null,
      );
    };

    const sync = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      applyUser(user);
      setAuthReady(true);
    };

    void sync();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authEmail) {
      setIsStaff(false);
      return;
    }
    let cancelled = false;
    void fetch("/api/outdoor/fulfilment/access")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setIsStaff(Boolean(data?.allowed));
      })
      .catch(() => {
        if (!cancelled) setIsStaff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authEmail]);

  useEffect(() => {
    if (!isStaff) return;
    const staffPage =
      pathname.startsWith("/outdoor/admin") ||
      pathname.startsWith("/outdoor/fulfilment") ||
      pathname.startsWith("/outdoor/unsubscribe");
    if (!staffPage) router.replace("/outdoor/admin");
  }, [isStaff, pathname, router]);

  const signedIn = Boolean(authEmail);
  const isFlowPage =
    pathname.startsWith("/outdoor/fulfilment") ||
    pathname.startsWith("/outdoor/checkout") ||
    pathname.startsWith("/outdoor/pay") ||
    pathname.startsWith("/outdoor/cart") ||
    pathname.startsWith("/outdoor/track") ||
    pathname.startsWith("/outdoor/login") ||
    pathname.startsWith("/outdoor/register") ||
    pathname.startsWith("/outdoor/orders") ||
    pathname.startsWith("/outdoor/admin");
  const hideStoreMarketing = isFlowPage;

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setAuthEmail(null);
    setAuthLabel(null);
    window.location.href = "/outdoor";
  };

  return (
    <div className="min-h-screen min-w-0 flex flex-col bg-[var(--out-cream)] overflow-x-hidden">
      <header className="sticky top-0 z-40 bg-[var(--out-bark)] text-[var(--out-cream)]">
        <div className="mx-auto max-w-6xl h-12 sm:h-16 px-3 sm:px-8 grid grid-cols-[1fr_auto_1fr] items-center md:flex md:gap-3">
          <div className="flex items-center gap-0.5 md:contents">
            <button
              type="button"
              className="md:hidden p-2 -ml-1"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link
              href="/outdoor/shop"
              className="group/hint relative p-2 md:hidden"
              aria-label="Search products"
            >
              <Search className="h-5 w-5" />
              <IconTip>Search</IconTip>
            </Link>
          </div>

          <Link
            href="/outdoor"
            className="flex min-w-0 items-center justify-center px-1"
            aria-label="SeraOutdoor"
          >
            <OutdoorBrandMark
              variant="onDark"
              className="h-5 w-auto max-w-[9.5rem] object-contain sm:h-7 sm:max-w-[13rem]"
              priority
            />
          </Link>

          <nav
            className={`hidden items-center gap-1 ml-2 text-sm ${isFlowPage || isStaff ? "md:hidden" : "md:flex"}`}
            aria-label="Primary"
          >
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-3 py-2 font-medium transition-colors ${
                    active
                      ? "text-[var(--out-cream)]"
                      : "text-[var(--out-cream)]/70 hover:text-[var(--out-cream)]"
                  }`}
                >
                  {item.label}
                  {active ? (
                    <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-[var(--out-moss)]" />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center justify-end gap-0.5 sm:gap-1 md:ml-auto">
            <Link
              href="/outdoor/shop"
              className={`group/hint relative p-2 hover:text-white ${isStaff ? "hidden" : "hidden md:inline-flex"}`}
              aria-label="Search products"
            >
              <Search className="h-5 w-5" />
              <IconTip>Search</IconTip>
            </Link>
            {authReady && signedIn ? (
              <>
                <Link
                  href="/outdoor/account"
                  className={`group/hint relative p-2 hover:text-white ${isStaff ? "hidden" : ""}`}
                  aria-label="My account"
                >
                  <User className="h-5 w-5" />
                  <IconTip>Account</IconTip>
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="group/hint relative hidden sm:inline-flex p-2 hover:text-white"
                  aria-label="Sign out"
                >
                  <LogOut className="h-5 w-5" />
                  <IconTip>Sign out</IconTip>
                </button>
              </>
            ) : (
              <Link
                href={loginHref}
                className="group/hint relative p-2 hover:text-white"
                aria-label="Sign in"
              >
                <User className="h-5 w-5" />
                <IconTip>Sign in</IconTip>
              </Link>
            )}
            <Link
              href="/outdoor/cart"
              className={`group/hint relative p-2 hover:text-white ${isStaff ? "hidden" : ""}`}
              aria-label="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
              <IconTip>Cart</IconTip>
              {totalItems > 0 ? (
                <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] rounded-full bg-[var(--out-ember)] text-white text-[10px] font-semibold flex items-center justify-center px-1">
                  {totalItems}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>
      {isStaff ? (
        <Suspense fallback={null}>
          <StaffTabs />
        </Suspense>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[78%] max-w-xs bg-[var(--out-cream)] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-8">
              <p className="font-display text-lg">Menu</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-4 text-base">
              {isStaff ? null : (
                <Link
                  href="/outdoor"
                  onClick={() => setOpen(false)}
                  className="py-1"
                >
                  Home
                </Link>
              )}
              {isStaff
                ? null
                : NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="py-1"
                    >
                      {item.label}
                    </Link>
                  ))}
              {signedIn ? (
                <>
                  {isStaff ? (
                    <>
                      <Link
                        href="/outdoor/admin"
                        onClick={() => setOpen(false)}
                        className="py-1 font-semibold"
                      >
                        Add product
                      </Link>
                      <Link
                        href="/outdoor/fulfilment"
                        onClick={() => setOpen(false)}
                        className="py-1 font-semibold"
                      >
                        Follow orders
                      </Link>
                      <Link
                        href="/outdoor/fulfilment?tab=inbox"
                        onClick={() => setOpen(false)}
                        className="py-1"
                      >
                        Messages
                      </Link>
                    </>
                  ) : null}
                  <Link
                    href="/outdoor/account"
                    onClick={() => setOpen(false)}
                    className="py-1 font-semibold text-[var(--out-moss)]"
                  >
                    My account
                  </Link>
                  <button
                    type="button"
                    className="py-1 text-left"
                    onClick={() => {
                      setOpen(false);
                      void signOut();
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href={loginHref}
                    onClick={() => setOpen(false)}
                    className="py-1 font-semibold text-[var(--out-moss)]"
                  >
                    Sign in
                  </Link>
                  <Link
                    href={signupHref}
                    onClick={() => setOpen(false)}
                    className="py-1"
                  >
                    Create account
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1">{children}</main>

      {hideStoreMarketing || isStaff ? null : (
        <section className="px-4 sm:px-8 pb-8">
          <div className="mx-auto max-w-xl rounded-[1.75rem] bg-[var(--out-bark)] px-6 py-8 text-center sm:px-10 sm:py-10">
            <h2 className="font-display text-3xl tracking-tight text-[var(--out-cream)] sm:text-4xl">
              Get Updates
            </h2>
            <p className="mt-2 text-sm text-[var(--out-cream)]">
              Leave your email for Outdoor product news
            </p>
            <div className="mt-5">
              <OutdoorNewsletter variant="onDark" />
            </div>
          </div>
        </section>
      )}

      {isStaff ? null : (
        <footer className="mt-auto bg-[var(--out-bark)] text-[var(--out-cream)]">
          <div className="mx-auto max-w-6xl px-5 sm:px-8 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <OutdoorBrandMark variant="onDark" className="h-8 w-auto" />
              <p className="mt-3 text-sm text-[var(--out-cream)]/70 leading-relaxed max-w-xs">
                Outdoor gear from SeraOutdoor.
              </p>
              {SOCIALS.length > 0 ? (
                <ul className="mt-5 flex flex-wrap gap-3 text-sm">
                  {SOCIALS.map((s) => (
                    <li key={s.label}>
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-[var(--out-moss)]"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div>
              <p className="mb-4 text-xs uppercase tracking-[0.16em] text-[var(--out-cream)]/55 underline">
                Shop
              </p>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <Link
                    href="/outdoor/shop"
                    className="hover:text-[var(--out-moss)]"
                  >
                    All products
                  </Link>
                </li>
                <li>
                  <Link
                    href="/outdoor/about"
                    className="hover:text-[var(--out-moss)]"
                  >
                    About
                  </Link>
                </li>
                <li>
                  <Link
                    href="/outdoor/contact"
                    className="hover:text-[var(--out-moss)]"
                  >
                    Contact
                  </Link>
                </li>
                <li>
                  <Link
                    href="/outdoor/faq"
                    className="hover:text-[var(--out-moss)]"
                  >
                    FAQ
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-4 text-xs uppercase tracking-[0.16em] text-[var(--out-cream)]/55 underline">
                Help
              </p>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <Link
                    href="/outdoor/shipping-returns"
                    className="hover:text-[var(--out-moss)]"
                  >
                    Shipping & Returns
                  </Link>
                </li>
                <li>
                  <Link
                    href="/outdoor/privacy"
                    className="hover:text-[var(--out-moss)]"
                  >
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link
                    href="/outdoor/refund"
                    className="hover:text-[var(--out-moss)]"
                  >
                    Refunds
                  </Link>
                </li>
                <li>
                  <Link
                    href="/outdoor/terms"
                    className="hover:text-[var(--out-moss)]"
                  >
                    Terms
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-4 text-xs uppercase tracking-[0.16em] text-[var(--out-cream)]/55 underline">
                Account
              </p>
              <ul className="space-y-2.5 text-sm">
                {signedIn ? (
                  <>
                    <li>
                      <Link
                        href="/outdoor/track"
                        className="hover:text-[var(--out-moss)]"
                      >
                        Track order
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/outdoor/account"
                        className="hover:text-[var(--out-moss)]"
                      >
                        My account
                      </Link>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={() => void signOut()}
                        className="hover:text-[var(--out-moss)]"
                      >
                        Sign out{authLabel ? ` (${authLabel})` : ""}
                      </button>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <Link
                        href={loginHref}
                        className="hover:text-[var(--out-moss)]"
                      >
                        Sign in
                      </Link>
                    </li>
                    <li>
                      <Link
                        href={signupHref}
                        className="hover:text-[var(--out-moss)]"
                      >
                        Create account
                      </Link>
                    </li>
                  </>
                )}
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 px-5 sm:px-8 py-4 text-center text-[11px] text-[var(--out-cream)]/50">
            © {new Date().getFullYear()} SeraOutdoor
          </div>
        </footer>
      )}
    </div>
  );
}
