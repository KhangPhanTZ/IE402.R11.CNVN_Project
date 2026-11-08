import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useAuth } from './lib/auth'
import LoginPage from './pages/LoginPage'
import type { Role } from './lib/types'

const MapPage = lazy(() => import('./pages/MapPage'))
const ReportPage = lazy(() => import('./pages/ReportPage'))
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Đang kiểm tra phiên đăng nhập…</div>
  if (role === 'anon') return <Navigate to="/login" replace />
  if (!roles.includes(role)) return <div className="p-6 text-sm">Vai trò <b>{role}</b> không có quyền truy cập trang này.</div>
  return <>{children}</>
}

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Đang tải…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/report" element={<Guard roles={['citizen', 'technician', 'admin']}><ReportPage /></Guard>} />
          <Route path="/incidents" element={<Guard roles={['technician', 'admin']}><IncidentsPage /></Guard>} />
          <Route path="/admin" element={<Guard roles={['admin']}><AdminPage /></Guard>} />
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
