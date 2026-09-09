'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutGrid,
  Landmark,
  SquarePen,
  ArrowUpRight,
  Contact,
  Users,
  ArrowDownLeft,
  Wrench,
  RefreshCw,
  ShieldCheck,
  ChevronsUpDown,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { company } from '@/lib/mock-data'

const mainNav = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
  { label: 'Banking', href: '/banking', icon: Landmark },
  { label: 'Journal Voucher', href: '/journal-voucher', icon: SquarePen },
  { label: 'Accounts Payable', href: '/accounts-payable', icon: ArrowUpRight },
  { label: 'Vendors', href: '/vendors', icon: Contact },
  { label: 'Customers', href: '/customers', icon: Users },
  { label: 'Accounts Receivable', href: '/accounts-receivable', icon: ArrowDownLeft },
  { label: 'Configuration', href: '/configuration', icon: Wrench },
]

const secondaryNav = [{ label: 'GSTR-2B Reconciliations', href: '/gstr-2b', icon: RefreshCw }]
const tertiaryNav = [{ label: 'User & Access', href: '/user-access', icon: ShieldCheck }]

function NavItem({
  label,
  href,
  icon: Icon,
  active,
}: {
  label: string
  href: string
  icon: typeof LayoutGrid
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
            <path
              d="M10 2 3 17h3l1.4-3.2h5.2L16 17h3L10 2Zm-1.4 8.8L10 7l1.4 3.8H8.6Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <span className="text-lg font-semibold tracking-tight">
          {process.env.NEXT_PUBLIC_APP_NAME || 'Talai'}
        </span>
      </div>

      <div className="px-3">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          <span className="truncate">{company.name}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto px-3">
        {mainNav.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(item.href)} />
        ))}

        <div className="my-2 border-t border-sidebar-border" />
        {secondaryNav.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(item.href)} />
        ))}

        <div className="my-2 border-t border-sidebar-border" />
        {tertiaryNav.map((item) => (
          <NavItem key={item.href} {...item} active={isActive(item.href)} />
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
            {company.user.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{company.user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{company.user.email}</p>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </aside>
  )
}
