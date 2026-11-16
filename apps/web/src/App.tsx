import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import type { Permission } from '@onestop/shared'
import { AppShell } from './layout/AppShell'
import { AuditLogPage } from './pages/AuditLog'
import { ChangePasswordPage } from './pages/ChangePassword'
import { ContractDetailPage, DeliveryNotePage } from './pages/ContractDetail'
import { ContractNewPage } from './pages/ContractNew'
import { ContractsPage } from './pages/Contracts'
import { CustomersPage } from './pages/Customers'
import { DamagesPage } from './pages/Damages'
import { InventoryPage } from './pages/Inventory'
import { LocationsPage } from './pages/Locations'
import { LoginPage } from './pages/Login'
import { OverviewPage } from './pages/Overview'
import { PosPage } from './pages/Pos'
import { ProductDetailPage } from './pages/ProductDetail'
import { ReceiptDetailPage } from './pages/ReceiptDetail'
import { ReceiptNewPage } from './pages/ReceiptNew'
import { ReceiptsPage } from './pages/Receipts'
import { SaleDetailPage } from './pages/SaleDetail'
import { SalesPage } from './pages/Sales'
import { StockCountPage } from './pages/StockCount'
import { SuppliersPage } from './pages/Suppliers'
import { UsersPage } from './pages/Users'
import { SessionProvider, useMe, useSession } from './session'
import { Alert, Button, EmptyState, Loading } from './ui'

export function App() {
  const me = useMe()

  if (me.isPending) return <Loading label="Starting Onestopgam" />
  if (me.isError) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <Alert tone="danger" title="Could not reach the server">
          Check the connection, then try again.
        </Alert>
        <Button className="mt-3" onClick={() => me.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  if (!me.data) return <LoginPage />
  if (me.data.user.mustChangePassword) return <ChangePasswordPage forced />
  if (me.data.divisions.length === 0) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <Alert tone="warn" title="No divisions are set up">
          Run the database seed, then reload this page.
        </Alert>
      </div>
    )
  }

  return (
    <SessionProvider me={me.data}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="overview" element={<Require permission="overview.view"><OverviewPage /></Require>} />
          <Route path="pos" element={<Require permission="sale.create"><PosPage /></Require>} />
          <Route path="sales" element={<Require permission="sale.view"><SalesPage /></Require>} />
          <Route path="sales/:id" element={<Require permission="sale.view"><SaleDetailPage /></Require>} />
          <Route path="contracts" element={<Require permission="contract.view"><ContractsPage /></Require>} />
          <Route path="contracts/new" element={<Require permission="contract.manage"><ContractNewPage /></Require>} />
          <Route path="contracts/:id" element={<Require permission="contract.view"><ContractDetailPage /></Require>} />
          <Route path="contracts/:id/deliveries/:deliveryId" element={<Require permission="contract.view"><DeliveryNotePage /></Require>} />
          <Route path="damages" element={<Require permission="damage.view"><DamagesPage /></Require>} />
          <Route path="customers" element={<Require permission="customer.view"><CustomersPage /></Require>} />
          <Route path="inventory" element={<Require permission="inventory.view"><InventoryPage /></Require>} />
          <Route path="inventory/:id" element={<Require permission="inventory.view"><ProductDetailPage /></Require>} />
          <Route path="stock-count" element={<Require permission="stock.count"><StockCountPage /></Require>} />
          <Route path="receiving" element={<Require permission="receipt.view"><ReceiptsPage /></Require>} />
          <Route path="receiving/new" element={<Require permission="stock.receive"><ReceiptNewPage /></Require>} />
          <Route path="receiving/:id" element={<Require permission="receipt.view"><ReceiptDetailPage /></Require>} />
          <Route path="suppliers" element={<Require permission="supplier.view"><SuppliersPage /></Require>} />
          <Route path="locations" element={<Require permission="location.manage"><LocationsPage /></Require>} />
          <Route path="admin/users" element={<Require permission="user.manage"><UsersPage /></Require>} />
          <Route path="admin/audit" element={<Require permission="audit.view"><AuditLogPage /></Require>} />
          <Route path="account/password" element={<ChangePasswordPage />} />
          <Route path="*" element={<EmptyState title="Page not found">The address may be mistyped, or the page may have moved.</EmptyState>} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}

/** Each role lands on the screen it uses most. Cashiers go straight to the till. */
function Home() {
  const { can } = useSession()
  return <Navigate to={can('overview.view') ? '/overview' : can('sale.create') ? '/pos' : '/inventory'} replace />
}

/** Hides a page from roles that may not use it. The API enforces the same rule on every request. */
function Require({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useSession()
  if (!can(permission)) {
    return <EmptyState title="You do not have access to this page">Ask an administrator if you need it.</EmptyState>
  }
  return children
}
