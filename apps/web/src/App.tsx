import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth.js';
import { Layout } from './components/Layout.js';
import { LoadingState } from './components/PageState.js';
import { AuditPage } from './pages/Audit.js';
import { CreditsPage } from './pages/Credits.js';
import { InvitePage } from './pages/Invite.js';
import { LoginPage } from './pages/Login.js';
import { MembersPage } from './pages/Members.js';
import { ModelPage } from './pages/Model.js';
import { MyUsagePage } from './pages/MyUsage.js';
import { OrgUsagePage } from './pages/OrgUsage.js';
import { OverviewPage } from './pages/Overview.js';
import { PlaygroundPage } from './pages/Playground.js';
import { RegisterPage } from './pages/Register.js';

function PublicOnly() {
  const { session, loading } = useAuth();
  if (loading) {
    return <LoadingState label="Loading…" />;
  }
  if (session) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) {
    return <LoadingState label="Loading…" />;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function RequireAdmin() {
  const { session } = useAuth();
  if (session?.role !== 'administrator') {
    return <Navigate to="/playground" replace />;
  }
  return <Outlet />;
}

function HomePage() {
  const { session } = useAuth();
  if (session?.role !== 'administrator') {
    return <Navigate to="/playground" replace />;
  }
  return <OverviewPage />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/invite" element={<InvitePage />} />
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/me/usage" element={<MyUsagePage />} />
              <Route element={<RequireAdmin />}>
                <Route path="/members" element={<MembersPage />} />
                <Route path="/credits" element={<CreditsPage />} />
                <Route path="/usage" element={<OrgUsagePage />} />
                <Route path="/model" element={<ModelPage />} />
                <Route path="/audit" element={<AuditPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
