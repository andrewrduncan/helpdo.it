import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { DomainProvider } from './contexts/DomainContext'
import { isAdmin } from './types'
import Layout from './components/Layout'
import Login from './components/pages/Login'
import AuthCallback from './components/pages/AuthCallback'
import Dashboard from './components/pages/Dashboard'
import Questions from './components/pages/Questions'
import Knowledge from './components/pages/Knowledge'
import Feedback from './components/pages/Feedback'
import Agents from './components/pages/Agents'
import Users from './components/pages/Users'

export default function App() {
  const { isAuthenticated, user } = useAuth()

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  return (
    <DomainProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/questions" element={<Questions />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/feedback" element={<Feedback />} />
          <Route path="/agents" element={<Agents />} />
          {isAdmin(user) && <Route path="/users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DomainProvider>
  )
}
