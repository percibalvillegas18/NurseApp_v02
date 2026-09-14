import React, { useMemo, useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Typography,
  Alert,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  message,
  Drawer,
  Descriptions,
} from 'antd';
import { KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rbacApi, apiClient } from '../../api/client';
import { AccessLevel } from '../../types';
import { usePermission } from '../../hooks/useEffectiveAccess';

const { Title, Text } = Typography;

const flattenMenus = (menus: any[]): any[] =>
  (menus || []).flatMap((m) => [m, ...flattenMenus(m.children || [])]);

export const AccessLevels: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('ACCESS_LEVEL_MASTER', 'VIEW');
  const { allowed: canManage } = usePermission('ACCESS_LEVEL_MASTER', 'MANAGE');
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState<AccessLevel | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['accessLevels', search, page],
    queryFn: async () => {
      const res = await rbacApi.getAccessLevels({ search: search || undefined, page, limit: 20 });
      return res.data.data as { items: AccessLevel[]; pagination: any };
    },
    enabled: canView,
  });

  const { data: roles } = useQuery({
    queryKey: ['user-lookups-roles'],
    queryFn: async () => {
      const res = await apiClient.get('/users/lookups');
      return res.data.data.roles as Array<{ id: number; code: string; name: string }>;
    },
    enabled: canView,
  });

  const { data: menus } = useQuery({
    queryKey: ['menus-flat'],
    queryFn: async () => {
      const res = await rbacApi.getMenus();
      return flattenMenus(res.data.data.menus);
    },
    enabled: canView,
  });

  const createMut = useMutation({
    mutationFn: async (body: any) => (await rbacApi.createAccessLevel(body)).data.data,
    onSuccess: () => {
      message.success('Access level created');
      setModalOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['accessLevels'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.message || 'Create failed'),
  });

  const menuName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of menus || []) map[m.code] = m.name;
    return map;
  }, [menus]);

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return <Alert message="Access Denied" description="Need VIEW on ACCESS_LEVEL_MASTER" type="error" showIcon />;
  }

  const columns = [
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      sorter: (a: AccessLevel, b: AccessLevel) => a.priority - b.priority,
    },
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      render: (code: string, row: AccessLevel) => (
        <Button type="link" onClick={() => setDetail(row)} style={{ padding: 0 }}>
          {code}
        </Button>
      ),
    },
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Roles',
      dataIndex: 'roles',
      key: 'roles',
      render: (rs: string[]) =>
        (rs || []).length ? rs.map((r) => <Tag key={r}>{r}</Tag>) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Default menus',
      dataIndex: 'default_menus',
      key: 'default_menus',
      render: (ms: string[]) => <Tag color="blue">{(ms || []).length} menus</Tag>,
    },
    {
      title: 'Auto-assign',
      dataIndex: 'auto_assign',
      key: 'auto_assign',
      render: (v: boolean) => (v ? <Tag color="green">Yes</Tag> : 'No'),
    },
    {
      title: 'Override',
      dataIndex: 'override_allowed',
      key: 'override_allowed',
      render: (v: boolean) => (v ? 'Allowed' : <Tag color="orange">Locked</Tag>),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={s === 'Active' ? 'green' : 'red'}>{s}</Tag>,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>
          <KeyOutlined style={{ marginRight: 8 }} />
          Access Level Master
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            Refresh
          </Button>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              New access level
            </Button>
          )}
        </Space>
      </div>

      <Alert
        message="How access levels work"
        description="Lower priority wins. Each level ships default menu visibility; role overrides (Roles & Permissions page) flip individual rows to ManualOverride. Changes invalidate the Redis access cache for affected roles."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search code or name"
          allowClear
          style={{ width: 300 }}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
      </Card>

      <Table
        rowKey="id"
        loading={isLoading || isFetching}
        columns={columns as any}
        dataSource={data?.items || []}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.pagination?.total,
          onChange: (p) => setPage(p),
        }}
      />

      <Modal
        title="New access level"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        destroyOnClose
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ priority: 50, autoAssign: false, overrideAllowed: true }}
          onFinish={(v) => createMut.mutate(v)}
        >
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input placeholder="e.g. NIGHT_SHIFT" style={{ textTransform: 'uppercase' }} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Night Shift" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="priority" label="Priority (lower wins)" rules={[{ required: true }]}>
            <InputNumber min={1} max={999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="roles" label="Applies to roles">
            <Select
              mode="multiple"
              options={(roles || []).map((r) => ({ value: r.code, label: `${r.code} — ${r.name}` }))}
            />
          </Form.Item>
          <Form.Item name="defaultMenus" label="Default menus">
            <Select
              mode="multiple"
              options={(menus || []).map((m: any) => ({ value: m.code, label: `${m.code} — ${m.name}` }))}
            />
          </Form.Item>
          <Space size={24}>
            <Form.Item name="autoAssign" label="Auto-assign" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="overrideAllowed" label="Allow overrides" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `${detail.code} — ${detail.name}` : 'Access level'}
        width={520}
        open={!!detail}
        onClose={() => setDetail(null)}
        destroyOnClose
      >
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Priority">{detail.priority}</Descriptions.Item>
            <Descriptions.Item label="Description">{detail.description || '—'}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={detail.status === 'Active' ? 'green' : 'red'}>{detail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Auto-assign">{detail.auto_assign ? 'Yes' : 'No'}</Descriptions.Item>
            <Descriptions.Item label="Overrides">{detail.override_allowed ? 'Allowed' : 'Locked'}</Descriptions.Item>
            <Descriptions.Item label="Roles">
              {(detail.roles || []).map((r) => (
                <Tag key={r} style={{ marginBottom: 4 }}>
                  {r}
                </Tag>
              )) || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={`Default menus (${(detail.default_menus || []).length})`}>
              {(detail.default_menus || []).map((m) => (
                <Tag key={m} color="blue" style={{ marginBottom: 4 }}>
                  {m}{menuName[m] ? ` — ${menuName[m]}` : ''}
                </Tag>
              )) || '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
};
