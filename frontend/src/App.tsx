import { Navigate, Route, Routes } from 'react-router';
import { AuthGate, useMe } from './auth';
import { Layout } from './components/Layout';
import { Admin } from './pages/Admin';
import { Dashboard } from './pages/Dashboard';
import { ProfilePage } from './pages/Profile';
import { Security } from './pages/Security';
import { Services } from './pages/Services';

function AdminRoute() {
  const me = useMe();
  return me.isAdmin ? <Admin /> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="services" element={<Services />} />
          <Route path="security" element={<Security />} />
          <Route path="admin" element={<AdminRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
