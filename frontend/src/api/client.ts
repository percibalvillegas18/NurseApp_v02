import axios from 'axios';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add JWT
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    const sessionId = localStorage.getItem('sessionId');
    if (sessionId) {
      config.headers['x-session-id'] = sessionId;
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    config.headers['x-request-id'] = requestId;

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle 401 refresh
// FIXED: Don't redirect to /login for auth endpoints - let Login page show error message
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl = originalRequest?.url || '';

    // Skip refresh logic for auth endpoints - these should show error to user, not redirect
    const isAuthEndpoint =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/refresh-token') ||
      requestUrl.includes('/auth/logout');

    if (isAuthEndpoint) {
      // For login failures, just reject so Login page can show error message
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const res = await axios.post(`${API_BASE}/auth/refresh-token`, {
            refreshToken,
          });

          const { accessToken } = res.data.data;
          localStorage.setItem('accessToken', accessToken);

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return apiClient(originalRequest);
        } catch (refreshError) {
          // Refresh failed - logout
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('sessionId');
          localStorage.removeItem('user');
          // Only redirect if not already on login page
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          return Promise.reject(refreshError);
        }
      } else {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('sessionId');
        localStorage.removeItem('user');
        // Only redirect if not already on login page to avoid wiping error message
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

// API Methods
export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post('/auth/login', { username, password }),
  logout: () => apiClient.post('/auth/logout'),
  me: () => apiClient.get('/auth/me'),
  refresh: (refreshToken: string) =>
    apiClient.post('/auth/refresh-token', { refreshToken }),
};

export const rbacApi = {
  // Menus
  getMenus: () => apiClient.get('/rbac/menus'),
  getMenuHierarchy: (accessibleOnly = false) =>
    apiClient.get(`/rbac/menus/hierarchy?accessibleOnly=${accessibleOnly}`),

  // Permissions
  getPermissions: (params?: any) => apiClient.get('/rbac/permissions', { params }),

  // Roles
  getRoleMenuAccess: (roleId: string) =>
    apiClient.get(`/rbac/roles/${roleId}/menu-access`),
  updateRoleMenuAccess: (roleId: string, menuId: number, data: any) =>
    apiClient.patch(`/rbac/roles/${roleId}/menu-access/${menuId}`, data),

  getRolePermissions: (roleId: string, params?: any) =>
    apiClient.get(`/rbac/roles/${roleId}/permissions`, { params }),
  updateRolePermission: (roleId: string, permissionId: number, menuId: number, data: any) =>
    apiClient.patch(`/rbac/roles/${roleId}/permissions/${permissionId}?menuId=${menuId}`, data),

  // Users
  getUserDataScopes: (userId: number) =>
    apiClient.get(`/rbac/users/${userId}/data-scopes`),
  assignDataScope: (userId: number, data: any) =>
    apiClient.post(`/rbac/users/${userId}/data-scopes`, data),

  // Effective Access
  getEffectiveAccess: (userId: number) =>
    apiClient.get(`/rbac/effective-access/${userId}`),
  evaluateAccess: (userId: number, data: { menuCode: string; permissionCode: string; resourceId?: number }) =>
    apiClient.post(`/rbac/effective-access/${userId}/evaluate`, data),
  previewAccessChange: (userId: number, data: any) =>
    apiClient.post(`/rbac/effective-access/${userId}/preview`, data),

  // Access Levels
  getAccessLevels: (params?: any) => apiClient.get('/rbac/access-levels', { params }),
  createAccessLevel: (data: any) => apiClient.post('/rbac/access-levels', data),
};

export const auditApi = {
  getLogs: (params?: any) => apiClient.get('/audit/logs', { params }),
  getStatistics: (period = '7days') =>
    apiClient.get(`/audit/statistics?period=${period}`),
};

// ============================================================================
// Nursing domain API (Nest /nursing/*)
// ============================================================================
export const nursingApi = {
  // Lookups
  getLookups: () => apiClient.get('/nursing/lookups'),

  // Nurses
  getNurses: (params?: any) => apiClient.get('/nursing/nurses', { params }),
  getNurse: (id: number) => apiClient.get(`/nursing/nurses/${id}`),
  createNurse: (data: any) => apiClient.post('/nursing/nurses', data),
  updateNurse: (id: number, data: any) => apiClient.patch(`/nursing/nurses/${id}`, data),
  deleteNurse: (id: number) => apiClient.delete(`/nursing/nurses/${id}`),

  // Credentials
  getNurseCredentials: (nurseId: number) =>
    apiClient.get(`/nursing/nurses/${nurseId}/credentials`),
  getExpiringCredentials: (days = 30) =>
    apiClient.get('/nursing/credentials/expiring', { params: { days } }),
  createCredential: (data: any) => apiClient.post('/nursing/credentials', data),
  updateCredential: (id: number, data: any) =>
    apiClient.patch(`/nursing/credentials/${id}`, data),
  verifyCredential: (id: number, status = 'Valid') =>
    apiClient.post(`/nursing/credentials/${id}/verify`, { status }),

  // Roster
  getRoster: (params?: any) => apiClient.get('/nursing/roster', { params }),
  createAssignment: (data: any) => apiClient.post('/nursing/roster', data),
  updateAssignment: (id: number, data: any) =>
    apiClient.patch(`/nursing/roster/${id}`, data),
  deleteAssignment: (id: number) => apiClient.delete(`/nursing/roster/${id}`),
};

export const contractsApi = {
  getPositionHierarchy: () => apiClient.get('/contracts/positions/hierarchy'),
};

// ============================================================================
// Leave management API (mock /leave/* — Nest module not built yet)
// ============================================================================
export const leaveApi = {
  getTypes: () => apiClient.get('/leave/types'),
  getBalances: (nurseId?: number) =>
    apiClient.get('/leave/balances', { params: nurseId ? { nurseId } : {} }),
  getRequests: (params?: any) => apiClient.get('/leave/requests', { params }),
  getRequest: (id: number) => apiClient.get(`/leave/requests/${id}`),
  createRequest: (data: any) => apiClient.post('/leave/requests', data),
  updateRequest: (id: number, data: any) => apiClient.patch(`/leave/requests/${id}`, data),
  submitRequest: (id: number) => apiClient.post(`/leave/requests/${id}/submit`),
  approveRequest: (id: number, note?: string) =>
    apiClient.post(`/leave/requests/${id}/approve`, note ? { note } : {}),
  rejectRequest: (id: number, note: string) =>
    apiClient.post(`/leave/requests/${id}/reject`, { note }),
  cancelRequest: (id: number, note?: string) =>
    apiClient.post(`/leave/requests/${id}/cancel`, note ? { note } : {}),
};

// ============================================================================
// Workforce analytics API (mock /analytics/* — computed live, Nest pending)
// ============================================================================
export const analyticsApi = {
  getSummary: () => apiClient.get('/analytics/summary'),
  getCredentials: () => apiClient.get('/analytics/credentials'),
  getContracts: () => apiClient.get('/analytics/contracts'),
  getRoster: (params?: any) => apiClient.get('/analytics/roster', { params }),
  getLeave: (year?: string) =>
    apiClient.get('/analytics/leave', { params: year ? { year } : {} }),
};

// ============================================================================
// System settings API (mock /settings — Nest pending)
// ============================================================================
export const settingsApi = {
  getSettings: () => apiClient.get('/settings'),
  updateSettings: (data: any) => apiClient.patch('/settings', data),
};
