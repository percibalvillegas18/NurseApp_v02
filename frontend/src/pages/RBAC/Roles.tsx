import React, { useMemo, useState } from 'react';
import { Card, Table, Tag, Button, Space, Typography, Alert, Modal, Switch, message, Select } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rbacApi, apiClient } from '../../api/client';
import { ManagedRole, RolePermission } from '../../types';
import { usePermission } from '../../hooks/useEffectiveAccess';

const { Title } = Typography;

const flattenMenus = (menus: any[]): any[] =>
  (menus || []).flatMap((m) => [m, ...flattenMenus(m.children || [])]);

export const Roles: React.FC = () => {
  const { allowed: canView } = usePermission('ROLES_PERMISSIONS', 'VIEW');
  const { allowed: canManage } = usePermission('ROLES_PERMISSIONS', 'MANAGE');
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [permMenuId, setPermMenuId] = useState<number | undefined>();

  const { data: rolesData, isLoading } = useQuery({
    queryKey: ['hospitalRoles'],
    queryFn: async () => {
      const res = await apiClient.get('/users/lookups');
      return res.data.data.roles as ManagedRole[];
    },
    enabled: canView,
  });

  const { data: menus } = useQuery({
    queryKey: ['menus-flat-roles'],
    queryFn: async () => {
      const res = await rbacApi.getMenus();
      return flattenMenus(res.data.data.menus);
    },
    enabled: canView,
  });

  const { data: roleMenuAccess } = useQuery({
    queryKey: ['roleMenuAccess', selectedRole],
    queryFn: async () => {
      const res = await rbacApi.getRoleMenuAccess(selectedRole!);
      return res.data.data.menuAccess;
    },
    enabled: !!selectedRole && canView && menuModalOpen,
  });

  const { data: rolePermissions, isLoading: permsLoading } = useQuery({
    queryKey: ['rolePermissions', selectedRole, permMenuId],
    queryFn: async () => {
      const res = await rbacApi.getRolePermissions(selectedRole!, permMenuId ? { menuId: permMenuId } : {});
      return res.data.data.permissions as RolePermission[];
    },
    enabled: !!selectedRole && canView && permModalOpen,
  });

  const updateMenuAccessMutation = useMutation({
    mutationFn: async ({ roleCode, menuId, visible, enabled }: any) => {
      const res = await rbacApi.updateRoleMenuAccess(roleCode, menuId, { visible, enabled, overrideReason: 'Admin override via UI' });
      return res.data;
    },
    onSuccess: () => {
      message.success('Menu access updated');
      queryClient.invalidateQueries({ queryKey: ['roleMenuAccess', selectedRole] });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.message || 'Failed to update');
    },
  });

  const updatePermissionMutation = useMutation({
    mutationFn: async ({ roleCode, menuId, permissionId, allowed }: any) => {
      const res = await rbacApi.updateRolePermission(roleCode, permissionId, menuId, {
        allowed,
        overrideReason: 'Admin override via UI',
      });
      return res.data;
    },
    onSuccess: () => {
      message.success('Permission updated');
      queryClient.invalidateQueries({ queryKey: ['rolePermissions', selectedRole, permMenuId] });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.message || 'Failed to update');
    },
  });

  const menuOptions = useMemo(
    () => (menus || []).map((m: any) => ({ value: m.id, label: `${m.code} — ${m.name}` })),
    [menus],
  );

  const columns = [
    { title: 'Code', dataIndex: 'code', key: 'code', render: (code: string) => <Tag color="blue">{code}</Tag> },
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (cat: string) => {
        const colors: any = { Clinical: 'green', Administrative: 'orange', System: 'red', Support: 'default' };
        return <Tag color={colors[cat] || 'default'}>{cat}</Tag>;
      },
    },
    { title: 'Status', key: 'status', render: () => <Tag color="green">Active</Tag> },
    {
      title: 'Action',
      key: 'action',
      render: (_: any, record: ManagedRole) => (
        <Space>
          <Button size="small" onClick={() => { setSelectedRole(record.code); setMenuModalOpen(true); }}>
            Menus
          </Button>
          <Button
            size="small"
            onClick={() => {
              setSelectedRole(record.code);
              setPermMenuId(undefined);
              setPermModalOpen(true);
            }}
          >
            Permissions
          </Button>
        </Space>
      ),
    },
  ];

  if (!canView) {
    return <Alert message="Access Denied" description="Need VIEW on ROLES_PERMISSIONS" type="error" showIcon />;
  }

  return (
    <div>
      <Title level={4}>
        <SafetyOutlined /> Hospital Roles & RBAC
      </Title>

      <Alert
        message="RBAC Administration"
        description={`You have ${canManage ? 'MANAGE' : 'VIEW'} permission. All changes set assignment_source=ManualOverride and override_flag=true, logged to audit_logs with RLS immutability. Multi-role fix active: BOOL_OR logic.`}
        type={canManage ? 'warning' : 'info'}
        style={{ marginBottom: 16 }}
      />

      <Card title={`Hospital Roles (${(rolesData || []).length} roles)`} loading={isLoading}>
        <Table columns={columns} dataSource={rolesData} rowKey="code" pagination={false} />
      </Card>

      <Modal
        title={`Menu Access for ${selectedRole}`}
        open={menuModalOpen}
        onCancel={() => setMenuModalOpen(false)}
        footer={null}
        width={800}
      >
        <Table
          dataSource={roleMenuAccess || []}
          rowKey="id"
          pagination={false}
          columns={[
            { title: 'Menu', dataIndex: ['menu', 'code'], key: 'menu_code', render: (_: any, rec: any) => rec.menu?.code || rec.menu_id },
            { title: 'Name', dataIndex: ['menu', 'name'], key: 'menu_name', render: (_: any, rec: any) => rec.menu?.name || '-' },
            {
              title: 'Visible',
              dataIndex: 'visible',
              key: 'visible',
              render: (visible: boolean, rec: any) => (
                <Switch
                  checked={visible}
                  disabled={!canManage}
                  onChange={(checked) => {
                    updateMenuAccessMutation.mutate({ roleCode: selectedRole, menuId: rec.menu_id, visible: checked, enabled: rec.enabled });
                  }}
                />
              ),
            },
            {
              title: 'Enabled',
              dataIndex: 'enabled',
              key: 'enabled',
              render: (enabled: boolean, rec: any) => (
                <Switch
                  checked={enabled}
                  disabled={!canManage}
                  onChange={(checked) => {
                    updateMenuAccessMutation.mutate({ roleCode: selectedRole, menuId: rec.menu_id, visible: rec.visible, enabled: checked });
                  }}
                />
              ),
            },
            { title: 'Source', dataIndex: 'assignment_source', key: 'source', render: (s: string) => <Tag>{s}</Tag> },
            { title: 'Override', dataIndex: 'override_flag', key: 'override', render: (f: boolean) => (f ? <Tag color="orange">Override</Tag> : <Tag>Default</Tag>) },
          ]}
        />
      </Modal>

      <Modal
        title={`Permissions for ${selectedRole}`}
        open={permModalOpen}
        onCancel={() => setPermModalOpen(false)}
        footer={null}
        width={800}
      >
        <Space style={{ marginBottom: 12 }}>
          <span>Menu:</span>
          <Select
            allowClear
            placeholder="All menus"
            style={{ width: 320 }}
            options={menuOptions}
            value={permMenuId}
            onChange={(v) => setPermMenuId(v)}
          />
        </Space>
        <Table
          dataSource={rolePermissions || []}
          rowKey="id"
          loading={permsLoading}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'Menu', key: 'menu', render: (_: any, rec: RolePermission) => <Tag color="blue">{rec.menu?.code}</Tag> },
            { title: 'Permission', key: 'perm', render: (_: any, rec: RolePermission) => rec.permission?.code },
            {
              title: 'Allowed',
              dataIndex: 'allowed',
              key: 'allowed',
              render: (allowed: boolean, rec: RolePermission) => (
                <Switch
                  checked={allowed}
                  disabled={!canManage}
                  onChange={(checked) => {
                    updatePermissionMutation.mutate({
                      roleCode: selectedRole,
                      menuId: rec.menu_id,
                      permissionId: rec.permission_id,
                      allowed: checked,
                    });
                  }}
                />
              ),
            },
            { title: 'Source', dataIndex: 'source', key: 'source', render: (s: string) => <Tag>{s}</Tag> },
            { title: 'Override', dataIndex: 'override_flag', key: 'override', render: (f: boolean) => (f ? <Tag color="orange">Override</Tag> : <Tag>Default</Tag>) },
          ]}
        />
      </Modal>
    </div>
  );
};
