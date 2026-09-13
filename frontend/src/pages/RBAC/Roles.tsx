import React, { useState } from 'react';
import { Card, Table, Tag, Button, Space, Typography, Alert, Modal, Form, Switch, message } from 'antd';
import { EditOutlined, SafetyOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rbacApi } from '../../api/client';
import { HospitalRole } from '../../types';
import { usePermission } from '../../hooks/useEffectiveAccess';

const { Title } = Typography;

export const Roles: React.FC = () => {
  const { allowed: canView } = usePermission('ROLES_PERMISSIONS', 'VIEW');
  const { allowed: canManage } = usePermission('ROLES_PERMISSIONS', 'MANAGE');
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [menuModalOpen, setMenuModalOpen] = useState(false);

  const { data: rolesData, isLoading } = useQuery({
    queryKey: ['hospitalRoles'],
    queryFn: async () => {
      // For now mock, in real backend add endpoint GET /rbac/hospital-roles
      // We'll use static list matching seed
      return [
        { code: 'SYSTEM_ADMIN', name: 'System Administrator', category: 'System', department: 'IT', status: 'Active' },
        { code: 'NURSE_MANAGER', name: 'Nurse Manager', category: 'Administrative', department: 'Nursing', status: 'Active' },
        { code: 'CHARGE_NURSE', name: 'Charge Nurse', category: 'Clinical', department: 'Nursing', status: 'Active' },
        { code: 'RN', name: 'Registered Nurse', category: 'Clinical', department: 'Nursing', status: 'Active' },
        { code: 'LPN', name: 'Licensed Practical Nurse', category: 'Clinical', department: 'Nursing', status: 'Active' },
        { code: 'CNA', name: 'Certified Nursing Assistant', category: 'Clinical', department: 'Nursing', status: 'Active' },
        { code: 'SCHEDULER', name: 'Workforce Scheduler', category: 'Administrative', department: 'Nursing', status: 'Active' },
        { code: 'HR_ADMIN', name: 'HR Administrator', category: 'Administrative', department: 'Human Resources', status: 'Active' },
        { code: 'COMPLIANCE_OFFICER', name: 'Compliance Officer', category: 'Administrative', department: 'Compliance', status: 'Active' },
        { code: 'READONLY_USER', name: 'Read-Only User', category: 'System', department: 'IT', status: 'Active' },
      ] as HospitalRole[];
    },
    enabled: canView,
  });

  const { data: roleMenuAccess } = useQuery({
    queryKey: ['roleMenuAccess', selectedRole],
    queryFn: async () => {
      const res = await rbacApi.getRoleMenuAccess(selectedRole!);
      return res.data.data.menuAccess;
    },
    enabled: !!selectedRole && canView,
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

  const columns = [
    { title: 'Code', dataIndex: 'code', key: 'code', render: (code: string) => <Tag color="blue">{code}</Tag> },
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (cat: string) => {
        const colors: any = { Clinical: 'green', Administrative: 'orange', System: 'red', Support: 'default' };
        return <Tag color={colors[cat]}>{cat}</Tag>;
      },
    },
    { title: 'Department', dataIndex: 'department', key: 'department' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={s === 'Active' ? 'green' : 'red'}>{s}</Tag> },
    {
      title: 'Action',
      key: 'action',
      render: (_: any, record: HospitalRole) => (
        <Space>
          <Button size="small" onClick={() => { setSelectedRole(record.code); setMenuModalOpen(true); }}>
            Menus
          </Button>
          <Button size="small" icon={<EditOutlined />} disabled={!canManage}>
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

      <Card title="Hospital Roles (10 roles from V2_3 seed)" loading={isLoading}>
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
    </div>
  );
};
