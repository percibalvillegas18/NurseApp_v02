import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ConfigProvider, App as AntApp } from 'antd';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/Layout/AppLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { NurseMaster } from './pages/NurseMaster';
import { Roster } from './pages/Roster';
import { Credentials } from './pages/Credentials';
import { Contract } from './pages/Contract';
import { Documents } from './pages/Documents';
import { Users } from './pages/Users';
import { Roles } from './pages/RBAC/Roles';
import { EffectiveAccessPage } from './pages/RBAC/EffectiveAccess';
import { AuditLogs } from './pages/RBAC/AuditLogs';
import { CacheStats } from './pages/RBAC/CacheStats';
import { NotFound, Forbidden } from './pages/NotFound';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 8,
          },
        }}
      >
        <AntApp>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                {/* Public */}
                <Route
                  path="/login"
                  element={
                    <PublicRoute>
                      <Login />
                    </PublicRoute>
                  }
                />

                {/* Protected */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <AppLayout>
                        <Dashboard />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/nursing/master"
                  element={
                    <ProtectedRoute menuCode="NURSE_MASTER" permissionCode="VIEW">
                      <AppLayout>
                        <NurseMaster />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/scheduling/roster"
                  element={
                    <ProtectedRoute menuCode="NURSE_ROSTER" permissionCode="VIEW">
                      <AppLayout>
                        <Roster />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                {/* RBAC Admin - requires ROLES_PERMISSIONS VIEW */}
                <Route
                  path="/admin/rbac"
                  element={
                    <ProtectedRoute menuCode="ROLES_PERMISSIONS" permissionCode="VIEW">
                      <AppLayout>
                        <Roles />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/effective-access"
                  element={
                    <ProtectedRoute menuCode="USER_MANAGEMENT" permissionCode="VIEW">
                      <AppLayout>
                        <EffectiveAccessPage />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/audit"
                  element={
                    <ProtectedRoute menuCode="AUDIT_LOGS" permissionCode="VIEW">
                      <AppLayout>
                        <AuditLogs />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/cache"
                  element={
                    <ProtectedRoute menuCode="SYSTEM_SETTINGS" permissionCode="VIEW">
                      <AppLayout>
                        <CacheStats />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                {/* Placeholder routes for other menus */}
                <Route
                  path="/nursing/credentials"
                  element={
                    <ProtectedRoute menuCode="CREDENTIALS" permissionCode="VIEW">
                      <AppLayout>
                        <Credentials />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/nursing/contract"
                  element={
                    <ProtectedRoute menuCode="CONTRACT" permissionCode="VIEW">
                      <AppLayout>
                        <Contract />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/nursing/documents"
                  element={
                    <ProtectedRoute menuCode="DOCUMENTS" permissionCode="VIEW">
                      <AppLayout>
                        <Documents />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/users"
                  element={
                    <ProtectedRoute menuCode="USER_MANAGEMENT" permissionCode="VIEW">
                      <AppLayout>
                        <Users />
                      </AppLayout>
                    </ProtectedRoute>
                  }
                />

                {/* Errors */}
                <Route path="/403" element={<Forbidden />} />
                <Route path="/404" element={<NotFound />} />

                {/* Default */}
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<Navigate to="/404" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </AntApp>
      </ConfigProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};

export default App;
