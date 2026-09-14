import React, { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Badge, Space, Typography, theme, Empty } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  ScheduleOutlined,
  BarChartOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  SafetyOutlined,
  AuditOutlined,
  KeyOutlined,
  MenuOutlined,
  BellOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
  IdcardOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useAccessibleMenus } from '../../hooks/useEffectiveAccess';
import { useExpiringCredentials } from '../../hooks/useNursing';
import { apiClient, leaveApi } from '../../api/client';
import type { MenuProps } from 'antd';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

interface AppLayoutProps {
  children: React.ReactNode;
}

/** Parent submenu keys for a path. Dynamic (backend) parents are keyed by route
 *  (/nursing, /scheduling, /admin); the static fallback uses bare names —
 *  return both, Ant Menu ignores keys that don't exist. */
const keysForPath = (path: string): string[] => {
  const seg = path.split('/')[1];
  if (['nursing', 'scheduling', 'admin'].includes(seg)) return [`/${seg}`, seg];
  return [];
};

const ICON_MAP: Record<string, React.ReactNode> = {
  DASHBOARD: <DashboardOutlined />,
  NURSING_WORKFORCE: <TeamOutlined />,
  NURSE_MASTER: <TeamOutlined />,
  CREDENTIALS: <IdcardOutlined />,
  CONTRACT: <FileTextOutlined />,
  DOCUMENTS: <FolderOpenOutlined />,
  SCHEDULING: <ScheduleOutlined />,
  NURSE_ROSTER: <ScheduleOutlined />,
  LEAVE_MANAGEMENT: <CalendarOutlined />,
  WORKFORCE_ANALYTICS: <BarChartOutlined />,
  ADMINISTRATION: <SettingOutlined />,
  USER_MANAGEMENT: <UserOutlined />,
  ROLES_PERMISSIONS: <SafetyOutlined />,
  EFFECTIVE_ACCESS: <KeyOutlined />,
  CACHE_STATS: <ThunderboltOutlined />,
  ACCESS_LEVEL_MASTER: <KeyOutlined />,
  MENU_MASTER: <MenuOutlined />,
  AUDIT_LOGS: <AuditOutlined />,
  SYSTEM_SETTINGS: <SettingOutlined />,
};

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { data: accessibleMenus } = useAccessibleMenus();
  const { token: themeToken } = theme.useToken();

  // Keep the current section's submenu open across navigations (dynamic menus
  // are keyed by route, so derive from the pathname; never auto-close).
  const [openKeys, setOpenKeys] = useState<string[]>(() => keysForPath(location.pathname));
  useEffect(() => {
    const needed = keysForPath(location.pathname);
    setOpenKeys((prev) => (needed.every((k) => prev.includes(k)) ? prev : [...prev, ...needed]));
  }, [location.pathname]);

  // Routes that are parent groups (have children) must expand, not navigate —
  // /nursing, /scheduling and /admin have no pages of their own.
  const parentKeys = useMemo(() => {
    const set = new Set<string>();
    const walk = (menus: any[]) => {
      for (const m of menus || []) {
        if (m.children?.length) {
          if (m.route) set.add(m.route);
          walk(m.children);
        }
      }
    };
    walk(accessibleMenus || []);
    return set;
  }, [accessibleMenus]);

  // ---- Live notifications: expiries + pending approvals (retry off: a 403 on
  // any one source must not break the shell, it just contributes zero) ----
  const { data: expiringCreds } = useExpiringCredentials(30);
  const { data: expiringContracts } = useQuery({
    queryKey: ['notifications-contracts-expiring'],
    queryFn: async () => {
      const res = await apiClient.get('/contracts/expiring', { params: { days: 90 } });
      return res.data.data as any[];
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: pendingLeave } = useQuery({
    queryKey: ['notifications-leave-pending'],
    queryFn: async () => {
      const res = await leaveApi.getRequests({ status: 'Submitted', limit: 5 });
      return res.data.data as { items: any[]; pagination: any };
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const notifications = useMemo(() => {
    const groups: NonNullable<MenuProps['items']> = [];
    const credItems = (expiringCreds?.items || []).slice(0, 3).map((c: any) => ({
      key: `cred-${c.id}`,
      label: `${c.name} — ${c.nurse?.fullName || `#${c.nurseId}`} (${c.daysUntilExpiry}d left)`,
      onClick: () => navigate('/nursing/credentials'),
    }));
    if (credItems.length) groups.push({ key: 'g-creds', label: 'Credentials expiring', type: 'group', children: credItems });

    const ctrItems = (expiringContracts || []).slice(0, 3).map((c: any) => ({
      key: `ctr-${c.id}`,
      label: `${c.contractNumber} ends ${c.endDate}`,
      onClick: () => navigate('/nursing/contract'),
    }));
    if (ctrItems.length) groups.push({ key: 'g-ctrs', label: 'Contracts expiring', type: 'group', children: ctrItems });

    const leaveItems = (pendingLeave?.items || []).slice(0, 3).map((r: any) => ({
      key: `leave-${r.id}`,
      label: `Leave #${r.id} — ${r.nurse?.fullName || ''} awaits approval`,
      onClick: () => navigate('/scheduling/leave'),
    }));
    if (leaveItems.length) groups.push({ key: 'g-leave', label: 'Pending leave', type: 'group', children: leaveItems });

    return groups;
  }, [expiringCreds, expiringContracts, pendingLeave, navigate]);

  const notificationCount =
    (expiringCreds?.items.length || 0) +
    (expiringContracts?.length || 0) +
    (pendingLeave?.pagination?.total ?? pendingLeave?.items.length ?? 0);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Profile',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      onClick: () => navigate('/admin/settings'),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      danger: true,
      onClick: handleLogout,
    },
  ];

  // Build menu from accessible menus or fallback to static
  const getMenuItems = (): MenuProps['items'] => {
    // If we have dynamic menus from backend, use them
    if (accessibleMenus && accessibleMenus.length > 0) {
      const buildItems = (menus: any[]): MenuProps['items'] => {
        return menus.map((menu) => ({
          key: menu.route || menu.code,
          icon: ICON_MAP[menu.code] || <DashboardOutlined />,
          label: menu.name,
          children: menu.children && menu.children.length > 0 ? buildItems(menu.children) : undefined,
        }));
      };
      return buildItems(accessibleMenus);
    }

    // Fallback static menu (for dev without backend)
    return [
      {
        key: '/dashboard',
        icon: <DashboardOutlined />,
        label: 'Dashboard',
      },
      {
        key: 'nursing',
        icon: <TeamOutlined />,
        label: 'Nursing Workforce',
        children: [
          { key: '/nursing/master', label: 'Nurse Master' },
          { key: '/nursing/credentials', label: 'Credentials' },
          { key: '/nursing/contract', label: 'Contract' },
          { key: '/nursing/documents', label: 'Documents' },
          { key: '/scheduling/roster', label: 'Nurse Roster' },
        ],
      },
      {
        key: 'scheduling',
        icon: <ScheduleOutlined />,
        label: 'Scheduling',
        children: [
          { key: '/scheduling/leave', label: 'Leave Management' },
        ],
      },
      {
        key: '/analytics',
        icon: <BarChartOutlined />,
        label: 'Analytics',
      },
      {
        key: 'admin',
        icon: <SettingOutlined />,
        label: 'Administration',
        children: [
          { key: '/admin/users', label: 'User Management' },
          { key: '/admin/rbac', label: 'Roles & Permissions' },
          { key: '/admin/effective-access', label: 'Effective Access' },
          { key: '/admin/cache', label: 'Cache Stats (Redis)' },
          { key: '/admin/access-levels', label: 'Access Levels' },
          { key: '/admin/menus', label: 'Menu Master' },
          { key: '/admin/audit', label: 'Audit Logs' },
          { key: '/admin/settings', label: 'System Settings' },
        ],
      },
    ];
  };

  const selectedKeys = [location.pathname];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: collapsed ? 16 : 20,
            fontWeight: 'bold',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {collapsed ? 'NA' : 'Nurse-App'}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKeys}
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          items={getMenuItems()}
          onClick={({ key }) => {
            if (key.startsWith('/') && !parentKeys.has(key)) {
              navigate(key);
            }
          }}
        />

        {!collapsed && (
          <div style={{ padding: 16, color: 'rgba(255,255,255,0.65)', fontSize: 12, position: 'absolute', bottom: 0, width: '100%' }}>
            <div>Role: {user?.role}</div>
            <div style={{ marginTop: 4, fontSize: 10 }}>
              {user?.roles?.map((r) => r.code).join(', ') || user?.role}
            </div>
          </div>
        )}
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'all 0.2s' }}>
        <Header
          style={{
            padding: '0 24px',
            background: themeToken.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            position: 'sticky',
            top: 0,
            zIndex: 9,
          }}
        >
          <div
            style={{ cursor: 'pointer', fontSize: 18 }}
            onClick={() => setCollapsed(!collapsed)}
          >
            <MenuOutlined />
          </div>

          <Space size={24}>
            <Dropdown
              menu={{
                items:
                  notifications.length > 0
                    ? notifications
                    : [{ key: 'empty', label: <Empty description="All clear" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }],
              }}
              placement="bottomRight"
              trigger={['click']}
            >
              <Badge count={notificationCount} size="small" overflowCount={99}>
                <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
              </Badge>
            </Dropdown>

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} style={{ backgroundColor: '#1677ff' }} />
                {!collapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                    <Text strong style={{ fontSize: 14 }}>
                      {user?.fullName || user?.username}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {user?.roleName || user?.role}
                    </Text>
                  </div>
                )}
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content
          style={{
            margin: 24,
            padding: 24,
            background: themeToken.colorBgContainer,
            borderRadius: themeToken.borderRadiusLG,
            minHeight: 280,
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};
