import React, { useMemo, useState } from 'react';
import {
  Card,
  Typography,
  Alert,
  Tag,
  Table,
  Button,
  Space,
  Select,
  Modal,
  Form,
  DatePicker,
  Input,
  message,
  Drawer,
  Descriptions,
  Statistic,
  Row,
  Col,
  Tabs,
  Progress,
} from 'antd';
import {
  CalendarOutlined,
  PlusOutlined,
  ReloadOutlined,
  CheckOutlined,
  CloseOutlined,
  StopOutlined,
  SendOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiClient } from '../api/client';
import { usePermission } from '../hooks/useEffectiveAccess';
import {
  useLeaveTypes,
  useLeaveBalances,
  useLeaveRequests,
  useLeaveRequest,
  useCreateLeaveRequest,
  useUpdateLeaveRequest,
  useLeaveAction,
  leaveStatusColor,
} from '../hooks/useLeave';
import { useAnalyticsSummary } from '../hooks/useAnalytics';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

async function fetchNursesLite() {
  const { data } = await apiClient.get('/nursing/nurses', { params: { limit: 100 } });
  return data.data?.items || data.data || [];
}

type ActionKind = 'submit' | 'approve' | 'reject' | 'cancel';

const ACTION_META: Record<ActionKind, { title: string; noteRequired: boolean; danger?: boolean }> = {
  submit: { title: 'Submit for approval', noteRequired: false },
  approve: { title: 'Approve request', noteRequired: false },
  reject: { title: 'Reject request', noteRequired: true, danger: true },
  cancel: { title: 'Cancel request', noteRequired: false, danger: true },
};

export const Leave: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('LEAVE_MANAGEMENT', 'VIEW');
  const { allowed: canCreate } = usePermission('LEAVE_MANAGEMENT', 'CREATE');
  const { allowed: canEdit } = usePermission('LEAVE_MANAGEMENT', 'EDIT');
  const { allowed: canApprove } = usePermission('LEAVE_MANAGEMENT', 'APPROVE');

  const [nurseId, setNurseId] = useState<number | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [range, setRange] = useState<[string, string] | undefined>();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [action, setAction] = useState<{ kind: ActionKind; id: number } | null>(null);
  const [balanceNurseId, setBalanceNurseId] = useState<number | undefined>();
  const [form] = Form.useForm();
  const [actionForm] = Form.useForm();

  const { data: summary } = useAnalyticsSummary(canView);
  const { data: types } = useLeaveTypes(canView);
  const { data: nurses } = useQuery({
    queryKey: ['nurses-lite-leave'],
    queryFn: fetchNursesLite,
    enabled: canView,
  });
  const { data, isLoading, isFetching, refetch } = useLeaveRequests(
    {
      nurseId,
      status,
      type,
      from: range?.[0],
      to: range?.[1],
      page,
      limit: 10,
    },
    canView,
  );
  const { data: balances } = useLeaveBalances(balanceNurseId, canView);
  const { data: detail, isLoading: detailLoading } = useLeaveRequest(detailId);

  const createMut = useCreateLeaveRequest();
  const updateMut = useUpdateLeaveRequest();
  const actionMut = useLeaveAction();

  const items = data?.items || [];
  const pagination = data?.pagination;

  const nurseOptions = useMemo(
    () =>
      (nurses || []).map((n: any) => ({
        value: n.id,
        label: `${n.jobNo || n.employeeNumber} — ${n.firstName} ${n.lastName}`,
      })),
    [nurses],
  );
  const typeOptions = useMemo(
    () =>
      (types || []).map((t) => ({
        value: t.code,
        label: `${t.name}${t.paid ? ` (${t.annualEntitlement}d/yr)` : ' (unpaid)'}`,
      })),
    [types],
  );

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on LEAVE_MANAGEMENT"
        type="error"
        showIcon
      />
    );
  }

  const openEdit = (row: any) => {
    setEditingId(row.id);
    form.setFieldsValue({
      nurseId: row.nurseId,
      leaveTypeCode: row.leaveTypeCode,
      dates: [dayjs(row.startDate), dayjs(row.endDate)],
      reason: row.reason,
      contactInfo: row.contactInfo,
    });
    setModalOpen(true);
  };

  const submitForm = (values: any) => {
    const body = {
      nurseId: values.nurseId,
      leaveTypeCode: values.leaveTypeCode,
      startDate: values.dates[0].format('YYYY-MM-DD'),
      endDate: values.dates[1].format('YYYY-MM-DD'),
      reason: values.reason,
      contactInfo: values.contactInfo,
    };
    if (editingId) {
      updateMut.mutate(
        { id: editingId, data: body },
        {
          onSuccess: () => {
            message.success('Request updated');
            setModalOpen(false);
            setEditingId(null);
            form.resetFields();
          },
          onError: (e: any) => message.error(e?.response?.data?.message || 'Update failed'),
        },
      );
    } else {
      createMut.mutate(body, {
        onSuccess: (res) => {
          message.success(`Request #${res.request.id} created (Draft, ${res.request.days} days)`);
          if (res.warnings?.length) {
            Modal.warning({
              title: 'Roster cover needed',
              content: (
                <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
                  {res.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ),
            });
          }
          setModalOpen(false);
          form.resetFields();
        },
        onError: (e: any) => message.error(e?.response?.data?.message || 'Create failed'),
      });
    }
  };

  const runAction = (values: any) => {
    if (!action) return;
    actionMut.mutate(
      { id: action.id, action: action.kind, note: values.note },
      {
        onSuccess: (res) => {
          message.success(`Request ${res.action}d → ${res.request.status}`);
          setAction(null);
          actionForm.resetFields();
        },
        onError: (e: any) => message.error(e?.response?.data?.message || 'Action failed'),
      },
    );
  };

  const columns = [
    {
      title: '#',
      dataIndex: 'id',
      key: 'id',
      width: 60,
      render: (v: number, row: any) => (
        <Button type="link" onClick={() => setDetailId(row.id)} style={{ padding: 0 }}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Nurse',
      key: 'nurse',
      render: (_: any, row: any) => row.nurse?.fullName || `#${row.nurseId}`,
    },
    {
      title: 'Type',
      key: 'type',
      render: (_: any, row: any) => row.leaveType?.name || row.leaveTypeCode,
    },
    {
      title: 'Period',
      key: 'period',
      render: (_: any, row: any) => `${row.startDate} → ${row.endDate}`,
    },
    { title: 'Days', dataIndex: 'days', key: 'days', width: 70 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={leaveStatusColor[s]}>{s}</Tag>,
    },
    {
      title: 'Decided by',
      key: 'decided',
      render: (_: any, row: any) => row.decidedByUser?.fullName || '—',
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, row: any) => (
        <Space size="small" wrap>
          {canEdit && row.status === 'Draft' && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                Edit
              </Button>
              <Button
                size="small"
                icon={<SendOutlined />}
                onClick={() => setAction({ kind: 'submit', id: row.id })}
              >
                Submit
              </Button>
            </>
          )}
          {canApprove && row.status === 'Submitted' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => setAction({ kind: 'approve', id: row.id })}
              >
                Approve
              </Button>
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => setAction({ kind: 'reject', id: row.id })}
              >
                Reject
              </Button>
            </>
          )}
          {canEdit && ['Draft', 'Submitted', 'Approved'].includes(row.status) && (
            <Button
              size="small"
              icon={<StopOutlined />}
              onClick={() => setAction({ kind: 'cancel', id: row.id })}
            >
              Cancel
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const balanceColumns = [
    {
      title: 'Nurse',
      key: 'nurse',
      render: (_: any, row: any) => `${row.nurse.fullName} (${row.nurse.employeeNumber})`,
    },
    {
      title: 'Type',
      key: 'type',
      render: (_: any, row: any) => row.leaveTypeName,
    },
    { title: 'Entitled', dataIndex: 'entitled', key: 'entitled', width: 90 },
    { title: 'Used', dataIndex: 'used', key: 'used', width: 70 },
    { title: 'Pending', dataIndex: 'pending', key: 'pending', width: 80 },
    {
      title: 'Remaining',
      key: 'remaining',
      width: 220,
      render: (_: any, row: any) =>
        row.remaining === null ? (
          <Text type="secondary">Uncapped (unpaid)</Text>
        ) : (
          <Space>
            <Progress
              percent={row.entitled ? Math.round((row.used / row.entitled) * 100) : 0}
              size="small"
              style={{ width: 120 }}
              status={row.remaining <= row.entitled * 0.2 ? 'exception' : 'normal'}
            />
            <Text strong={row.remaining <= row.entitled * 0.2}>{row.remaining}d</Text>
          </Space>
        ),
    },
  ];

  const balanceRows = (balances || []).flatMap((nb) =>
    nb.balances.map((b) => ({ key: `${nb.nurse.id}-${b.leaveTypeCode}`, nurse: nb.nurse, ...b })),
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>
          <CalendarOutlined style={{ marginRight: 8 }} />
          Leave Management
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            Refresh
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingId(null);
                form.resetFields();
                setModalOpen(true);
              }}
            >
              New request
            </Button>
          )}
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Pending approvals" value={summary?.leave.pendingApprovals ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="On leave today" value={summary?.leave.onLeaveToday ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Requests (filter total)" value={pagination?.total ?? items.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Text type="secondary">Balances derive from approved + submitted requests — they can't drift.</Text>
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="requests"
        items={[
          {
            key: 'requests',
            label: 'Requests',
            children: (
              <>
                <Card size="small" style={{ marginBottom: 16 }}>
                  <Space wrap>
                    <Select
                      allowClear
                      placeholder="Nurse"
                      style={{ width: 240 }}
                      options={nurseOptions}
                      onChange={(v) => {
                        setNurseId(v);
                        setPage(1);
                      }}
                    />
                    <Select
                      allowClear
                      placeholder="Leave type"
                      style={{ width: 190 }}
                      options={typeOptions}
                      onChange={(v) => {
                        setType(v);
                        setPage(1);
                      }}
                    />
                    <Select
                      allowClear
                      placeholder="Status"
                      style={{ width: 150 }}
                      options={Object.keys(leaveStatusColor).map((s) => ({ value: s, label: s }))}
                      onChange={(v) => {
                        setStatus(v);
                        setPage(1);
                      }}
                    />
                    <RangePicker
                      onChange={(_, ds) => {
                        setRange(ds[0] && ds[1] ? [ds[0], ds[1]] : undefined);
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
              </>
            ),
          },
          {
            key: 'balances',
            label: 'Balances',
            children: (
              <>
                <Card size="small" style={{ marginBottom: 16 }}>
                  <Space>
                    <Text>Show balances for:</Text>
                    <Select
                      allowClear
                      placeholder="All active nurses"
                      style={{ width: 260 }}
                      options={nurseOptions}
                      onChange={(v) => setBalanceNurseId(v)}
                    />
                  </Space>
                </Card>
                <Table
                  rowKey="key"
                  columns={balanceColumns as any}
                  dataSource={balanceRows}
                  pagination={{ pageSize: 16 }}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title={editingId ? `Edit request #${editingId} (Draft)` : 'New leave request'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingId(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={submitForm}>
          <Form.Item name="nurseId" label="Nurse" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={nurseOptions} disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="leaveTypeCode" label="Leave type" rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item name="dates" label="Period (inclusive)" rules={[{ required: true, message: 'Pick start and end dates' }]}>
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="contactInfo" label="Contact during leave">
            <Input placeholder="Phone / email" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={action ? ACTION_META[action.kind].title : ''}
        open={!!action}
        onCancel={() => {
          setAction(null);
          actionForm.resetFields();
        }}
        onOk={() => actionForm.submit()}
        confirmLoading={actionMut.isPending}
        okButtonProps={{ danger: action ? ACTION_META[action.kind].danger : false }}
        destroyOnClose
      >
        <Form form={actionForm} layout="vertical" onFinish={runAction}>
          <Form.Item
            name="note"
            label={action && ACTION_META[action.kind].noteRequired ? 'Decision note (required)' : 'Note (optional)'}
            rules={action && ACTION_META[action.kind].noteRequired ? [{ required: true, message: 'A note is required' }] : []}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `Leave request #${detail.id}` : 'Leave request'}
        width={520}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        destroyOnClose
      >
        {detailLoading && <Card loading />}
        {detail && (
          <>
            {(detail.rosterClashes?.length || 0) > 0 && (
              <Alert
                type="warning"
                showIcon
                message="Roster cover needed"
                description={
                  <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
                    {detail.rosterClashes!.map((c) => (
                      <li key={c.assignmentId}>
                        {c.date} — {c.unitCode} {c.shiftCode} ({c.status}), assignment #{c.assignmentId}
                      </li>
                    ))}
                  </ul>
                }
                style={{ marginBottom: 16 }}
              />
            )}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Status">
                <Tag color={leaveStatusColor[detail.status]}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Nurse">
                {detail.nurse ? `${detail.nurse.fullName} (${detail.nurse.employeeNumber})` : detail.nurseId}
              </Descriptions.Item>
              <Descriptions.Item label="Type">
                {detail.leaveType?.name || detail.leaveTypeCode}
              </Descriptions.Item>
              <Descriptions.Item label="Period">
                {detail.startDate} → {detail.endDate} ({detail.days} days)
              </Descriptions.Item>
              <Descriptions.Item label="Reason">{detail.reason || '—'}</Descriptions.Item>
              <Descriptions.Item label="Contact">{detail.contactInfo || '—'}</Descriptions.Item>
              <Descriptions.Item label="Submitted">{detail.submittedAt || '—'}</Descriptions.Item>
              <Descriptions.Item label="Decided by">
                {detail.decidedByUser ? `${detail.decidedByUser.fullName} (${detail.decidedByUser.username})` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Decided at">{detail.decidedAt || '—'}</Descriptions.Item>
              <Descriptions.Item label="Decision note">{detail.decisionNote || '—'}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>
    </div>
  );
};
