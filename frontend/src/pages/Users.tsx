import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Typography,
  Input,
  Select,
  Modal,
  Form,
  Alert,
  message,
  Popconfirm,
  Drawer,
  Descriptions,
  List,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  KeyOutlined,
  LockOutlined,
  UnlockOutlined,
  HistoryOutlined,
  DeploymentUnitOutlined,
  StopOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePermission } from '../hooks/useEffectiveAccess';
import {
  useUsers,
  useUserLookups,
  useCreateUser,
  useUpdateUser,
  useSetUserStatus,
  useResetUserPassword,
  useUnlockUser,
  useLoginHistory,
  useUserSessions,
} from '../hooks/useUsers';
import { ManagedUser } from '../types';

const { Title, Text } = Typography;

const categoryColor: Record<string, string> = {
  System: 'red',
  Clinical: 'green',
  Administrative: 'geekblue',
};

export const Users: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('USER_MANAGEMENT', 'VIEW');
  const { allowed: canCreate } = usePermission('USER_MANAGEMENT', 'CREATE');
  const { allowed: canEdit } = usePermission('USER_MANAGEMENT', 'EDIT');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading } = useUsers({ search, status, page, limit: pageSize });
  const { data: lookups } = useUserLookups();

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const setUserStatus = useSetUserStatus();
  const resetPassword = useResetUserPassword();
  const unlockUser = useUnlockUser();

  const [modalOpen, setModalOpen] = useState(false);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [historyUser, setHistoryUser] = useState<ManagedUser | null>(null);
  const [sessionsUser, setSessionsUser] = useState<ManagedUser | null>(null);

  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();

  const history = useLoginHistory(historyUser?.id ?? null);
  const sessions = useUserSessions(sessionsUser?.id ?? null);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    form.setFieldsValue({
      username: u.username, // username is immutable (disabled input)
      email: u.email,
      fullName: u.fullName,
      primaryRoleId: u.primaryRole?.id,
      roleIds: u.roles.filter((r) => r.id !== u.primaryRole?.id).map((r) => r.id),
      status: u.status,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) {
        await updateUser.mutateAsync({
          id: editing.id,
          data: {
            email: v.email,
            full_name: v.fullName,
            primary_role_id: v.primaryRoleId,
            role_ids: v.roleIds ?? [],
            status: v.status,
          },
        });
        message.success(`User ${editing.username} updated`);
      } else {
        await createUser.mutateAsync({
          username: v.username,
          email: v.email,
          full_name: v.fullName,
          password: v.password,
          primary_role_id: v.primaryRoleId,
          role_ids: v.roleIds ?? [],
          status: v.status ?? 'Active',
        });
        message.success(`User ${v.username} created`);
      }
      setModalOpen(false);
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Save failed');
    }
  };

  const toggleStatus = async (u: ManagedUser) => {
    const next = u.status === 'Active' ? 'Suspended' : 'Active';
    try {
      await setUserStatus.mutateAsync({ id: u.id, status: next });
      message.success(`${u.username} ${next === 'Active' ? 'reactivated' : 'suspended'}`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Status change failed');
    }
  };

  const submitReset = async () => {
    const v = await resetForm.validateFields();
    if (!resetUser) return;
    try {
      await resetPassword.mutateAsync({ id: resetUser.id, password: v.newPassword });
      message.success(`Password reset for ${resetUser.username}`);
      setResetUser(null);
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Reset failed');
    }
  };

  const doUnlock = async (u: ManagedUser) => {
    try {
      const res: any = await unlockUser.mutateAsync(u.id);
      message.success(res?.message || `${u.username} unlocked`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Unlock failed');
    }
  };

  const columns = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    { title: 'Full Name', dataIndex: 'fullName', key: 'fullName' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Primary Role',
      key: 'primaryRole',
      render: (_: unknown, u: ManagedUser) =>
        u.primaryRole ? (
          <Tag color={categoryColor[u.primaryRole.category ?? ''] ?? 'default'}>{u.primaryRole.name}</Tag>
        ) : (
          '—'
        ),
    },
    {
      title: 'Additional Roles',
      key: 'roles',
      render: (_: unknown, u: ManagedUser) =>
        u.roles.filter((r) => r.id !== u.primaryRole?.id).length ? (
          u.roles
            .filter((r) => r.id !== u.primaryRole?.id)
            .map((r) => (
              <Tag key={r.id} style={{ fontSize: 11 }}>
                {r.code}
              </Tag>
            ))
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, u: ManagedUser) => (
        <Space size={4}>
          <Tag color={u.status === 'Active' ? 'green' : 'red'}>{u.status}</Tag>
          {u.failedLoginAttempts > 0 && (
            <Tooltip title={`${u.failedLoginAttempts} failed login attempt(s)${u.lockedUntil ? ' — LOCKED until ' + dayjs(u.lockedUntil).format('HH:mm') : ''}`}>
              <Tag color={u.lockedUntil ? 'volcano' : 'orange'} icon={<LockOutlined />}>
                {u.failedLoginAttempts}
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (v: string | null) => (v ? dayjs(v).format('MMM D, HH:mm') : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 300,
      render: (_: unknown, u: ManagedUser) => (
        <Space size={2} wrap>
          {canEdit && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(u)} />
              <Button size="small" icon={<KeyOutlined />} title="Reset password" onClick={() => { setResetUser(u); resetForm.resetFields(); }} />
              <Popconfirm
                title={u.status === 'Active' ? `Suspend ${u.username}?` : `Reactivate ${u.username}?`}
                description={u.status === 'Active' ? 'They will no longer be able to log in.' : undefined}
                onConfirm={() => toggleStatus(u)}
              >
                <Button
                  size="small"
                  title={u.status === 'Active' ? 'Suspend' : 'Reactivate'}
                  icon={u.status === 'Active' ? <StopOutlined /> : <CheckOutlined />}
                  danger={u.status === 'Active'}
                />
              </Popconfirm>
              <Popconfirm
                title={`Unlock ${u.username}?`}
                description="Clears per-user failed-attempt counters (the GLOBAL lockout is separate by design)."
                onConfirm={() => doUnlock(u)}
              >
                <Button size="small" title="Unlock (per-user counters)" icon={<UnlockOutlined />} disabled={u.failedLoginAttempts === 0} />
              </Popconfirm>
            </>
          )}
          <Button size="small" icon={<HistoryOutlined />} title="Login history" onClick={() => setHistoryUser(u)} />
          <Button size="small" icon={<DeploymentUnitOutlined />} title="Sessions" onClick={() => setSessionsUser(u)} />
        </Space>
      ),
    },
  ];

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on USER_MANAGEMENT"
        type="error"
        showIcon
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>User Management</Title>
        <Space>
          <Tag>VIEW: {canView ? '✅' : '❌'}</Tag>
          <Tag>CREATE: {canCreate ? '✅' : '❌'}</Tag>
          <Tag>EDIT: {canEdit ? '✅' : '❌'}</Tag>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add User
            </Button>
          )}
        </Space>
      </div>

      <Alert
        message="Login accounts administration"
        description="Fields: username, email, full name, password (admin-set), primary + additional roles, status.
          Unlock clears per-user counters only; the GLOBAL lockout counter stays as designed.
          All actions are audited (USER_CREATED / UPDATED / DEACTIVATED / REACTIVATED / PASSWORD_RESET / UNLOCKED)."
        type="info"
        style={{ marginBottom: 16 }}
      />

      <Card
        title={
          <Space>
            <Input.Search
              placeholder="Search username / name / email"
              allowClear
              onSearch={(v) => { setSearch(v); setPage(1); }}
              style={{ width: 280 }}
            />
            <Select
              placeholder="All status"
              allowClear
              style={{ width: 140 }}
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={(lookups?.statuses ?? []).map((s) => ({ value: s, label: s }))}
            />
          </Space>
        }
      >
        <Table<ManagedUser>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={data?.items ?? []}
          size="middle"
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            onChange: setPage,
            showTotal: (t) => `${t} users`,
          }}
        />
      </Card>

      {/* Create / Edit modal */}
      <Modal
        title={editing ? `Edit User — ${editing.username}` : 'Add User'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        width={620}
        confirmLoading={createUser.isPending || updateUser.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="username"
            label="Username"
            rules={[
              { required: true, message: 'Required' },
              { pattern: /^[a-zA-Z0-9._-]+$/, message: 'Letters, digits, dot, dash, underscore only' },
            ]}
          >
            <Input placeholder="e.g. fatima.alrashid" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="email" label="Email Address" rules={[{ required: true, message: 'Required' }, { type: 'email' }]}>
            <Input placeholder="name@hospital.local" />
          </Form.Item>
          <Form.Item name="fullName" label="Full Name" rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Fatima Al-Rashid" />
          </Form.Item>
          {!editing && (
            <Form.Item
              name="password"
              label="Password (admin-set)"
              rules={[{ required: true, message: 'Required' }, { min: 8, message: 'Min 8 characters' }]}
            >
              <Input.Password placeholder="Set initial password" />
            </Form.Item>
          )}
          <Space.Compact block>
            <Form.Item name="primaryRoleId" label="Primary Role" rules={[{ required: true, message: 'Required' }]} style={{ width: '50%', marginRight: 8 }}>
              <Select
                placeholder="Select primary role"
                options={(lookups?.roles ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))}
              />
            </Form.Item>
            <Form.Item
              name="roleIds"
              label="Additional Roles (multi-role OR logic)"
              dependencies={['primaryRoleId']}
              style={{ width: '50%' }}
            >
              <Select
                mode="multiple"
                placeholder="None"
                options={(lookups?.roles ?? []).map((r) => ({
                  value: r.id,
                  label: r.code,
                  disabled: r.id === form.getFieldValue('primaryRoleId'),
                }))}
              />
            </Form.Item>
          </Space.Compact>
          {editing && (
            <Form.Item name="status" label="Status">
              <Select options={['Active', 'Suspended'].map((s) => ({ value: s, label: s }))} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Reset password modal */}
      <Modal
        title={`Reset Password — ${resetUser?.username ?? ''}`}
        open={resetUser !== null}
        onCancel={() => setResetUser(null)}
        onOk={submitReset}
        confirmLoading={resetPassword.isPending}
        destroyOnHidden
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Admin-set password — share it with the user via a secure channel." />
        <Form form={resetForm} layout="vertical">
          <Form.Item name="newPassword" label="New Password" rules={[{ required: true, message: 'Required' }, { min: 8, message: 'Min 8 characters' }]}>
            <Input.Password placeholder="New password (min 8 chars)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Login history drawer */}
      <Drawer
        title={historyUser ? `Login History — ${historyUser.username}` : 'Login History'}
        open={historyUser !== null}
        onClose={() => setHistoryUser(null)}
        width={520}
      >
        <Alert
          type="info"
          style={{ marginBottom: 12 }}
          message="Per-product decision, the lockout counter is GLOBAL; per-user counters below are display-only."
        />
        <List
          loading={history.isLoading}
          dataSource={history.data?.items ?? []}
          locale={{ emptyText: 'No login events recorded yet' }}
          renderItem={(e) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={e.status === 'Success' ? 'green' : 'red'}>{e.action}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(e.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Text>
                  </Space>
                }
                description={e.ipAddress ? `from ${e.ipAddress}` : ''}
              />
            </List.Item>
          )}
        />
      </Drawer>

      {/* Sessions drawer */}
      <Drawer
        title={sessionsUser ? `Sessions — ${sessionsUser.username}` : 'Sessions'}
        open={sessionsUser !== null}
        onClose={() => setSessionsUser(null)}
        width={560}
      >
        <List
          loading={sessions.isLoading}
          dataSource={sessions.data?.items ?? []}
          locale={{ emptyText: 'No sessions' }}
          renderItem={(s) => (
            <Card size="small" style={{ marginBottom: 8 }} title={
              <Space>
                <Tag color={s.status === 'Active' ? 'green' : 'default'}>{s.status}</Tag>
                <Text style={{ fontSize: 13 }}>{s.ipAddress}</Text>
              </Space>
            }>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Device">{s.userAgent ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Login">{dayjs(s.loginAt).format('MMM D, HH:mm')}</Descriptions.Item>
                <Descriptions.Item label="Last activity">{dayjs(s.lastActivityAt).format('MMM D, HH:mm')}</Descriptions.Item>
                <Descriptions.Item label="Expires">{dayjs(s.expiresAt).format('MMM D, HH:mm')}</Descriptions.Item>
              </Descriptions>
            </Card>
          )}
        />
      </Drawer>
    </div>
  );
};
