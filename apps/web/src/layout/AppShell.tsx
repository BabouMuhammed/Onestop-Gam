import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, KeyRound, LayoutDashboard, FileText, LogOut, Menu, PackageX, Package, PackagePlus, Receipt, ScrollText, ShoppingCart, Truck, UserRound, Users, Warehouse, X, type LucideIcon, BadgeCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { ROLE_LABELS, type Permission } from '@onestop/shared'
import { api } from '../api'
import { GlobalSearch } from '../components/GlobalSearch'
import { divisionBrand, useSession } from '../session'
import { cn, Select } from '../ui'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission: Permission
}

/** Navigation is built from what the role may do, so nobody sees a link they cannot use. */
function useNavigation(): { heading?: string; items: NavItem[] }[] {
  const { can, user } = useSession()
  const main: NavItem[] = [
    { to: '/overview', label: 'Dashboard', icon: LayoutDashboard, permission: 'overview.view' },
    { to: '/pos', label: 'Sell', icon: ShoppingCart, permission: 'sale.create' },
    { to: '/sales', label: user.role === 'CASHIER' ? 'My sales' : 'Sales', icon: Receipt, permission: 'sale.view' },
    { to: '/customers', label: 'Customers', icon: UserRound, permission: 'customer.view' },
    { to: '/contracts', label: 'Contracts', icon: FileText, permission: 'contract.view' },
    { to: '/inventory', label: user.role === 'CASHIER' ? 'Product lookup' : 'Inventory', icon: Package, permission: 'inventory.view' },
    { to: '/receiving', label: 'Receiving', icon: PackagePlus, permission: 'receipt.view' },
    { to: '/stock-count', label: 'Stock count', icon: ClipboardCheck, permission: 'stock.count' },
    { to: '/damages', label: 'Damages', icon: PackageX, permission: 'damage.view' },
    { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'supplier.view' },
    { to: '/locations', label: 'Locations', icon: Warehouse, permission: 'location.manage' },
  ]
  const admin: NavItem[] = [
    { to: '/admin/users', label: 'Users', icon: Users, permission: 'user.manage' },
    { to: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view' },
    { to: '/admin/price-approvals', label: 'Price approvals', icon: BadgeCheck, permission: 'price.approve' },
  ]
  return [
    { items: main.slice(0, 1) },
    { heading: 'Selling', items: main.slice(1, 5) },
    { heading: 'Stock', items: main.slice(5, 9) },
    { heading: 'Setup', items: main.slice(9) },
    { heading: 'Admin', items: admin },
  ].map((group) => ({ ...group, items: group.items.filter((i) => can(i.permission)) })).filter((group) => group.items.length > 0)
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-base',
    isActive ? 'bg-brand-soft font-medium text-brand' : 'text-ink-2 hover:bg-sunken hover:text-ink',
  )

function Navigation() {
  const groups = useNavigation()
  const { user } = useSession()
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(['me'], null)
    },
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <img src="/brand/onestopgam-mark.png" alt="" className="h-8 w-auto" />
        <span className="text-lg font-semibold text-brand">Onestopgam</span>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
        {groups.map((group, index) => (
          <div key={group.heading ?? 'dashboard'}>
            {group.heading ? <p className="mt-4 mb-1 px-2.5 text-sm font-medium text-ink-3" id={`nav-${index}`}>{group.heading}</p> : null}
            <ul className="space-y-0.5" aria-labelledby={group.heading ? `nav-${index}` : undefined}>
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className={linkClass}>
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line p-2">
        <div className="px-2.5 py-1.5">
          <p className="truncate font-medium text-ink">{user.name}</p>
          <p className="text-sm text-ink-2">{ROLE_LABELS[user.role]}</p>
        </div>
        <NavLink to="/account/password" className={linkClass}>
          <KeyRound className="size-4 shrink-0" aria-hidden />
          Change password
        </NavLink>
        <button type="button" onClick={() => signOut.mutate()} className={cn(linkClass({ isActive: false }), 'w-full')}>
          <LogOut className="size-4 shrink-0" aria-hidden />
          Sign out
        </button>
      </div>
    </div>
  )
}

/**
 * Names the division every screen is working in. CEO and Finance switch here;
 * managers and cashiers see their own division and no switch.
 */
function DivisionBar() {
  const { division, divisions, setDivision, canSwitchDivision, dashboardScope, setDashboardScope } = useSession()
  const dashboard = useLocation().pathname === '/overview'
  const scope = dashboard ? dashboardScope : division.id
  const brand = divisionBrand(division.code)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <img src={dashboard && scope === 'all' ? '/brand/onestopgam-mark.png' : dashboard ? divisionBrand(divisions.find((d) => d.id === scope)?.code ?? division.code).logo : brand.logo} alt="" className="h-8 w-auto max-w-24 shrink-0 object-contain" />
      <div className={cn('min-w-0', canSwitchDivision && 'hidden sm:block')}>
        <p className="text-xs whitespace-nowrap text-ink-3">{dashboard && canSwitchDivision ? 'Dashboard scope' : canSwitchDivision ? 'Working in' : 'Division'}</p>
        <p className="truncate font-semibold text-ink">{dashboard && canSwitchDivision ? (scope === 'all' ? 'Both divisions' : divisions.find((d) => d.id === scope)?.name) : division.name}</p>
      </div>
      {canSwitchDivision ? (
        <div className="min-w-0 flex-1 sm:ml-3 sm:max-w-56">
          <Select aria-label="Switch division" value={scope} onChange={(event) => {
            const id = event.target.value
            if (id === 'all' && dashboard) setDashboardScope(id)
            else setDivision(id)
          }}>
            {dashboard ? <option value="all">Both divisions</option> : null}
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
      ) : null}
    </div>
  )
}

export function AppShell() {
  const { division } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const drawer = useRef<HTMLDialogElement>(null)
  const location = useLocation()

  useEffect(() => {
    const dialog = drawer.current
    if (!dialog) return
    if (menuOpen && !dialog.open) dialog.showModal()
    if (!menuOpen && dialog.open) dialog.close()
  }, [menuOpen])
  // Close the menu after navigating.
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="min-h-dvh lg:pl-sidebar">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-sidebar border-r border-line bg-surface lg:block">
        <Navigation />
      </aside>

      <dialog
        ref={drawer}
        onClose={() => setMenuOpen(false)}
        aria-label="Menu"
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-line bg-surface p-0 text-ink lg:hidden"
      >
        {menuOpen ? (
          <>
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="absolute top-3.5 right-3 rounded-md p-1 text-ink-2 hover:bg-sunken">
              <X className="size-5" aria-hidden />
            </button>
            <Navigation />
          </>
        ) : null}
      </dialog>

      <header className="sticky top-0 z-30 bg-surface">
        {/* The coloured strip is the division's mark: a second cue beside its name and logo. */}
        <div className={cn('h-1', divisionBrand(division.code).markClass)} />
        <div className="flex h-14 items-center gap-2 border-b border-line px-3 lg:px-6">
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-md p-2 text-ink-2 hover:bg-sunken lg:hidden">
            <Menu className="size-5" aria-hidden />
          </button>
          <DivisionBar />
          <div className="hidden w-64 shrink-0 sm:block lg:w-80">
            <GlobalSearch />
          </div>
        </div>
        <div className="border-b border-line px-3 py-2 sm:hidden">
          <GlobalSearch />
        </div>
      </header>

      {/* Remount on division change so no screen keeps the other division's state. */}
      <main id="main" key={division.id} className="mx-auto max-w-[1400px] p-3 sm:p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  )
}
