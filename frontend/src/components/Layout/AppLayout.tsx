import React, { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Badge, Space, Typography, theme } from 'antd';
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
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useAccessibleMenus } from '../../hooks/useEffectiveAccess';
import type { MenuProps } from 'antd';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { data: accessibleMenus } = useAccessibleMenus();
  const { token: themeToken } = theme.useToken();

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
        return menus.map((menu) => {
          const iconMap: Record<string, React.ReactNode> = {
            DASHBOARD: <DashboardOutlined />,
            NURSING_WORKFORCE: <TeamOutlined />,
            NURSE_MASTER: <TeamOutlined />,
            CONTRACT: <FileTextOutlined />,
            DOCUMENTS: <FolderOpenOutlined />,
            SCHEDULING: <ScheduleOutlined />,
            NURSE_ROSTER: <ScheduleOutlined />,
            WORKFORCE_ANALYTICS: <BarChartOutlined />,
            ADMINISTRATION: <SettingOutlined />,
            USER_MANAGEMENT: <UserOutlined />,
            ROLES_PERMISSIONS: <SafetyOutlined />,
            AUDIT_LOGS: <AuditOutlined />,
            ACCESS_LEVEL_MASTER: <KeyOutlined />,
            MENU_MASTER: <MenuOutlined />,
          };

          return {
            key: menu.route || menu.code,
            icon: iconMap[menu.code] || <DashboardOutlined />,
            label: menu.name,
            children: menu.children && menu.children.length > 0 ? buildItems(menu.children) : undefined,
          };
        });
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
  const openKeys = (() => {
    const path = location.pathname;
    if (path.startsWith('/nursing')) return ['nursing'];
    if (path.startsWith('/scheduling')) return ['scheduling'];
    if (path.startsWith('/admin')) return ['admin'];
    return [];
  })();

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
          defaultOpenKeys={openKeys}
          items={getMenuItems()}
          onClick={({ key }) => {
            if (key.startsWith('/')) {
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
            <Badge count={5} size="small">
              <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
            </Badge>

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
