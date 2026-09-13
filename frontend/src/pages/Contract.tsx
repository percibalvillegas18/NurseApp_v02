import React, { useMemo, useState } from 'react';
import {
  Card,
  Typography,
  Alert,
  Tag,
  Table,
  Button,
  Space,
  Input,
  Select,
  Modal,
  Form,
  DatePicker,
  message,
  Drawer,
  Descriptions,
  Timeline,
  Statistic,
  Row,
  Col,
} from 'antd';
import {
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  CheckOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiClient } from '../api/client';
import { usePermission } from '../hooks/useEffectiveAccess';

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  Draft: 'default',
  PendingApproval: 'processing',
  Active: 'success',
  Suspended: 'warning',
  Expired: 'error',
  Terminated: 'error',
  Superseded: 'default',
};

const CONTRACT_TYPES = ['Permanent', 'FixedTerm', 'Temporary', 'Locum', 'Other'];

async function fetchContracts(params: Record<string, any>) {
  const { data } = await apiClient.get('/contracts', { params });
  return data.data;
}

async function fetchAgencies() {
  const { data } = await apiClient.get('/contracts/agencies');
  return data.data as any[];
}

async function fetchPositions() {
  const { data } = await apiClient.get('/contracts/positions');
  return data.data as any[];
}

async function fetchExpiring(days = 90) {
  const { data } = await apiClient.get('/contracts/expiring', { params: { days } });
  return data.data as any[];
}

async function fetchNursesLite() {
  const { data } = await apiClient.get('/nursing/nurses', { params: { limit: 100 } });
  return data.data?.items || data.data || [];
}

export const Contract: React.FC = () => {
  const qc = useQueryClient();
  const { allowed: canView, isLoading: viewLoading } = usePermission('CONTRACT', 'VIEW');
  const { allowed: canCreate } = usePermission('CONTRACT', 'CREATE');
  const { allowed: canEdit } = usePermission('CONTRACT', 'EDIT');
  const { allowed: canApprove } = usePermission('CONTRACT', 'APPROVE');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [agencyId, setAgencyId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form] = Form.useForm();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['contracts', search, status, agencyId, page],
    queryFn: () =>
      fetchContracts({
        search: search || undefined,
        status,
        agencyId,
        page,
        limit: 10,
      }),
    enabled: canView,
  });

  const { data: agencies } = useQuery({
    queryKey: ['contract-agencies'],
    queryFn: fetchAgencies,
    enabled: canView,
  });

  const { data: positions } = useQuery({
    queryKey: ['contract-positions'],
    queryFn: fetchPositions,
    enabled: canView,
  });

  const { data: expiring } = useQuery({
    queryKey: ['contracts-expiring'],
    queryFn: () => fetchExpiring(90),
    enabled: canView,
  });

  const { data: nurses } = useQuery({
    queryKey: ['nurses-lite-contracts'],
    queryFn: fetchNursesLite,
    enabled: canView && canCreate,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['contract', detailId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/contracts/${detailId}`);
      return data.data;
    },
    enabled: !!detailId,
  });

  const { data: history } = useQuery({
    queryKey: ['contract-history', detailId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/contracts/${detailId}/history`);
      return data.data as any[];
    },
    enabled: !!detailId,
  });

  const createMut = useMutation({
    mutationFn: (body: any) => apiClient.post('/contracts', body),
    onSuccess: () => {
      message.success('Contract created (Draft)');
      setModalOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.message || 'Create failed'),
  });

  const actionMut = useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: string; body?: any }) =>
      apiClient.post(`/contracts/${id}/${action}`, body || {}),
    onSuccess: (_, v) => {
      message.success(`Contract ${v.action} OK`);
      qc.invalidateQueries({ queryKey: ['contracts'] });
      qc.invalidateQueries({ queryKey: ['contract', v.id] });
      qc.invalidateQueries({ queryKey: ['contract-history', v.id] });
      qc.invalidateQueries({ queryKey: ['contracts-expiring'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.message || 'Action failed'),
  });

  const items = data?.items || [];
  const pagination = data?.pagination;

  const agencyOptions = useMemo(
    () => (agencies || []).map((a: any) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [agencies],
  );

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on CONTRACT"
        type="error"
        showIcon
      />
    );
  }

  const columns = [
    {
      title: 'Contract #',
      dataIndex: 'contractNumber',
      key: 'contractNumber',
      render: (v: string, row: any) => (
        <Button type="link" onClick={() => setDetailId(row.id)}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Nurse',
      key: 'nurse',
      render: (_: any, row: any) =>
        row.nurse ? `${row.nurse.fullName || `${row.nurse.firstName} ${row.nurse.lastName}`}` : '—',
    },
    { title: 'Job No.', dataIndex: 'jobNo', key: 'jobNo' },
    {
      title: 'Agency',
      key: 'agency',
      render: (_: any, row: any) =>
        row.agency ? <Tag>{row.agency.code}</Tag> : '—',
    },
    {
      title: 'Type',
      dataIndex: 'contractType',
      key: 'contractType',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={STATUS_COLOR[s] || 'default'}>{s}</Tag>,
    },
    {
      title: 'Start',
      dataIndex: 'startDate',
      key: 'startDate',
      render: (d: string) => (d ? dayjs(d).format('YYYY-MM-DD') : '—'),
    },
    {
      title: 'End',
      dataIndex: 'endDate',
      key: 'endDate',
      render: (d: string) => (d ? dayjs(d).format('YYYY-MM-DD') : 'Open'),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, row: any) => (
        <Space size="small" wrap>
          {canEdit && row.status === 'Draft' && (
            <Button
              size="small"
              onClick={() => actionMut.mutate({ id: row.id, action: 'submit' })}
            >
              Submit
            </Button>
          )}
          {canApprove && ['Draft', 'PendingApproval'].includes(row.status) && (
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => actionMut.mutate({ id: row.id, action: 'approve' })}
            >
              Approve
            </Button>
          )}
          {canEdit && row.status === 'Active' && (
            <Button
              size="small"
              icon={<StopOutlined />}
              onClick={() =>
                actionMut.mutate({ id: row.id, action: 'suspend', body: { reason: 'Suspended by admin' } })
              }
            >
              Suspend
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>
          <FileTextOutlined style={{ marginRight: 8 }} />
          Contract Master
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['contracts'] })}>
            Refresh
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              New contract
            </Button>
          )}
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Contracts (page total)" value={pagination?.total ?? items.length} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="Expiring ≤ 90 days"
              value={expiring?.length ?? 0}
              valueStyle={{ color: (expiring?.length || 0) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Text type="secondary">Agencies: MOH · SOP · HCC · HHC</Text>
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            placeholder="Search contract #, job no, nurse"
            allowClear
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
            style={{ width: 280 }}
          />
          <Select
            allowClear
            placeholder="Status"
            style={{ width: 160 }}
            options={Object.keys(STATUS_COLOR).map((s) => ({ value: s, label: s }))}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="Agency"
            style={{ width: 220 }}
            options={agencyOptions}
            onChange={(v) => {
              setAgencyId(v);
              setPage(1);
            }}
          />
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={isLoading || isFetching}
        columns={columns as any}
        dataSource={items}
        pagination={{
          current: page,
          pageSize: 10,
          total: pagination?.total,
          onChange: (p) => setPage(p),
        }}
      />

      <Modal
        title="New employment contract"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        destroyOnClose
        width={640}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            createMut.mutate({
              nurseId: values.nurseId,
              agencyId: values.agencyId,
              positionId: values.positionId,
              contractType: values.contractType,
              startDate: values.startDate?.format('YYYY-MM-DD'),
              endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : undefined,
              notes: values.notes,
            });
          }}
        >
          <Form.Item name="nurseId" label="Nurse" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(nurses || []).map((n: any) => ({
                value: n.id,
                label: `${n.jobNo || n.employeeNumber} — ${n.firstName} ${n.lastName}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="agencyId" label="Contract agency" rules={[{ required: true }]}>
            <Select options={agencyOptions} />
          </Form.Item>
          <Form.Item name="positionId" label="Position">
            <Select
              allowClear
              options={(positions || []).map((p: any) => ({
                value: p.id,
                label: `${p.code} — ${p.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="contractType" label="Contract type" rules={[{ required: true }]} initialValue="FixedTerm">
            <Select options={CONTRACT_TYPES.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name="startDate" label="Start date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="endDate" label="End date (empty = open / permanent)">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `Contract ${detail.contractNumber}` : 'Contract'}
        width={480}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        destroyOnClose
      >
        {detailLoading && <Card loading />}
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Status">
                <Tag color={STATUS_COLOR[detail.status]}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Nurse">
                {detail.nurse?.fullName || detail.nurseId}
              </Descriptions.Item>
              <Descriptions.Item label="Job No.">{detail.jobNo || '—'}</Descriptions.Item>
              <Descriptions.Item label="Agency">
                {detail.agency ? `${detail.agency.code} — ${detail.agency.name}` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Position">
                {detail.position ? `${detail.position.code} — ${detail.position.name}` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Type">{detail.contractType}</Descriptions.Item>
              <Descriptions.Item label="Start">
                {detail.startDate ? dayjs(detail.startDate).format('YYYY-MM-DD') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="End">
                {detail.endDate ? dayjs(detail.endDate).format('YYYY-MM-DD') : 'Open'}
              </Descriptions.Item>
              <Descriptions.Item label="Notes">{detail.notes || '—'}</Descriptions.Item>
            </Descriptions>
            <Title level={5} style={{ marginTop: 24 }}>
              Status history
            </Title>
            <Timeline
              items={(history || []).map((h: any) => ({
                children: (
                  <span>
                    <Text strong>{h.fromStatus || '—'}</Text> → <Text strong>{h.toStatus}</Text>
                    {h.reason ? ` — ${h.reason}` : ''}
                    <br />
                    <Text type="secondary">{dayjs(h.changedAt).format('YYYY-MM-DD HH:mm')}</Text>
                  </span>
                ),
              }))}
            />
          </>
        )}
      </Drawer>
    </div>
  );
};
