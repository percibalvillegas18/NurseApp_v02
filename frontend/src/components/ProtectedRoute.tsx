import React from 'react';
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../hooks/useAuth';
import { usePermission } from '../hooks/useEffectiveAccess';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  menuCode?: string;
  permissionCode?: string;
  resourceId?: number;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireAuth = true,
  menuCode,
  permissionCode,
  resourceId,
}) => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { allowed, isLoading: permLoading } = usePermission(
    menuCode || '',
    permissionCode || '',
    resourceId
  );

  // Check auth
  if (requireAuth && authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="Loading..." />
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check permission if required
  if (menuCode && permissionCode) {
    if (permLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
          <Spin tip="Checking permissions..." />
        </div>
      );
    }

    if (!allowed) {
      return <Navigate to="/403" replace />;
    }
  }

  return <>{children}</>;
};

export const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
