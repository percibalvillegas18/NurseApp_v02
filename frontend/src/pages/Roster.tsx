import React, { useMemo, useState } from 'react';
import {
  Card,
  Calendar,
  Badge,
  Typography,
  Alert,
  Space,
  Tag,
  Button,
  Modal,
  Form,
  Select,
  DatePicker,
  Input,
  message,
  Popconfirm,
  Empty,
  List,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { usePermission } from '../hooks/useEffectiveAccess';
import {
  useRoster,
  useNurses,
  useNursingLookups,
  useCreateAssignment,
  useUpdateAssignment,
  useDeleteAssignment,
  rosterStatusColor,
} from '../hooks/useNursing';
import { RosterAssignment, RosterStatus } from '../types';

const { Title, Text } = Typography;

const shiftMeta: Record<string, { status: 'success' | 'warning' | 'processing'; color: string }> = {
  MORNING: { status: 'success', color: 'green' },
  EVENING: { status: 'warning', color: 'orange' },
  NIGHT: { status: 'processing', color: 'geekblue' },
};

const EDITABLE_STATUSES: RosterStatus[] = [
  'Scheduled',
  'Confirmed',
  'Completed',
  'Swapped',
  'NoShow',
];

export const Roster: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('NURSE_ROSTER', 'VIEW');
  const { allowed: canCreate } = usePermission('NURSE_ROSTER', 'CREATE');
  const { allowed: canEdit } = usePermission('NURSE_ROSTER', 'EDIT');
  const { allowed: canAssign } = usePermission('NURSE_ROSTER', 'ASSIGN');
  const { allowed: canDelete } = usePermission('NURSE_ROSTER', 'DELETE');

  // Visible month drives the fetch window
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const from = month.startOf('month').format('YYYY-MM-DD');
  const to = month.endOf('month').format('YYYY-MM-DD');

  const [unitId, setUnitId] = useState<number | undefined>(undefined);
  const { data: rosterData, isLoading } = useRoster({ from, to, unitId });
  const { data: lookups } = useNursingLookups();
  const { data: nursesData } = useNurses({ limit: 100 });

  const createAssignment = useCreateAssignment();
  const updateAssignment = useUpdateAssignment();
  const deleteAssignment = useDeleteAssignment();

  const [createOpen, setCreateOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [form] = Form.useForm();
  const watchUnitId = Form.useWatch('unitId', form);

  const byDate = useMemo(() => {
    const map: Record<string, RosterAssignment[]> = {};
    for (const a of rosterData?.items ?? []) {
      (map[a.assignmentDate] ||= []).push(a);
    }
    return map;
  }, [rosterData]);

  const dayAssignments = dayOpen ? byDate[dayOpen] ?? [] : [];

  const cellRender = (value: Dayjs) => {
    const list = byDate[value.format('YYYY-MM-DD')] ?? [];
    return (
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {list.slice(0, 3).map((a) => (
          <li key={a.id}>
            <Badge
              status={shiftMeta[a.shiftCode ?? '']?.status ?? 'default'}
              text={
                <span style={{ fontSize: 10 }}>
                  {a.nurseName} · {a.shiftCode}
                </span>
              }
            />
          </li>
        ))}
        {list.length > 3 && (
          <li style={{ fontSize: 10, color: '#888' }}>+{list.length - 3} more</li>
        )}
      </ul>
    );
  };

  const handleCreate = async () => {
    const v = await form.validateFields();
    const payload = {
      nurse_id: v.nurseId,
      nursing_unit_id: v.unitId,
      shift_id: v.shiftId,
      post_id: v.postId,
      assignment_date: v.date.format('YYYY-MM-DD'),
      notes: v.notes || undefined,
    };
    try {
      await createAssignment.mutateAsync(payload);
      message.success('Assignment created');
      setCreateOpen(false);
      form.resetFields();
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Create failed');
    }
  };

  const handleStatusChange = async (a: RosterAssignment, status: string) => {
    try {
      await updateAssignment.mutateAsync({ id: a.id, data: { status } });
      message.success(`Assignment marked ${status}`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Update failed');
    }
  };

  const handleDelete = async (a: RosterAssignment) => {
    try {
      await deleteAssignment.mutateAsync(a.id);
      message.success('Assignment deleted');
      if (dayAssignments.length === 1) setDayOpen(null);
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Delete failed');
    }
  };

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on NURSE_ROSTER"
        type="error"
        showIcon
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>Nurse Roster</Title>
        <Space>
          <Select
            allowClear
            placeholder="All units"
            style={{ width: 170 }}
            value={unitId}
            onChange={(v) => setUnitId(v)}
            options={(lookups?.units ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))}
          />
          <Tag>VIEW: {canView ? '✅' : '❌'}</Tag>
          <Tag>CREATE: {canCreate ? '✅' : '❌'}</Tag>
          <Tag>EDIT: {canEdit ? '✅' : '❌'}</Tag>
          <Tag>ASSIGN: {canAssign ? '✅' : '❌'}</Tag>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Create Assignment
            </Button>
          )}
        </Space>
      </div>

      <Alert
        message="Live roster data"
        description={
          <>
            Window <b>{from}</b> → <b>{to}</b> from <code>/api/v1/nursing/roster</code>. Click a day to inspect
            assignments; create/edit/delete respect NURSE_ROSTER permissions. Double-booking (same nurse, date,
            shift) is rejected by the database (<code>uq_roster_nurse_date_shift</code>).
          </>
        }
        type="info"
        style={{ marginBottom: 16 }}
      />

      <Card loading={isLoading}>
        <Calendar
          value={month}
          onPanelChange={(value) => setMonth(value)}
          onSelect={(value, { source }) => {
            setMonth(value);
            if (source === 'date' && byDate[value.format('YYYY-MM-DD')]) {
              setDayOpen(value.format('YYYY-MM-DD'));
            }
          }}
          cellRender={cellRender}
        />
      </Card>

      {/* Create assignment modal */}
      <Modal
        title="Create Roster Assignment"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={createAssignment.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="nurseId" label="Nurse" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select nurse"
              options={(nursesData?.items ?? [])
                .filter((n) => n.status === 'Active')
                .map((n) => ({
                  value: n.id,
                  label: `${n.fullName} (${n.employeeNumber} · ${n.primaryRole?.code ?? 'N/A'})`,
                }))}
            />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="unitId" label="Unit" rules={[{ required: true }]} style={{ width: '50%', marginRight: 8 }}>
              <Select
                placeholder="Select unit"
                options={(lookups?.units ?? []).map((u) => ({ value: u.id, label: u.name }))}
              />
            </Form.Item>
            <Form.Item name="shiftId" label="Shift" rules={[{ required: true }]} style={{ width: '50%' }}>
              <Select
                placeholder="Select shift"
                options={(lookups?.shifts ?? []).map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.start_time}-${s.end_time})`,
                }))}
              />
            </Form.Item>
          </Space.Compact>
          <Space.Compact block>
            <Form.Item name="postId" label="Post (optional)" style={{ width: '50%', marginRight: 8 }}>
              <Select
                allowClear
                placeholder="Select post"
                options={(lookups?.posts ?? [])
                  .filter((p) => !watchUnitId || p.nursing_unit_id === watchUnitId)
                  .map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
            <Form.Item name="date" label="Date" rules={[{ required: true }]} style={{ width: '50%' }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Day detail modal */}
      <Modal
        title={dayOpen ? `Assignments on ${dayjs(dayOpen).format('ddd, MMM D, YYYY')}` : ''}
        open={dayOpen !== null}
        onCancel={() => setDayOpen(null)}
        footer={null}
        width={560}
      >
        {dayAssignments.length === 0 ? (
          <Empty description="No assignments this day" />
        ) : (
          <List
            dataSource={dayAssignments}
            renderItem={(a) => (
              <List.Item
                actions={[
                  canEdit || canAssign ? (
                    <Select
                      key="status"
                      size="small"
                      value={a.status}
                      style={{ width: 130 }}
                      onChange={(status) => handleStatusChange(a, status)}
                      options={EDITABLE_STATUSES.map((s) => ({ value: s, label: s }))}
                    />
                  ) : (
                    <Tag key="status" color={rosterStatusColor[a.status]}>{a.status}</Tag>
                  ),
                  canDelete ? (
                    <Popconfirm key="del" title="Delete assignment?" onConfirm={() => handleDelete(a)}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  ) : null,
                ].filter(Boolean) as React.ReactNode[]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Text strong>{a.nurseName}</Text>
                      <Tag color={shiftMeta[a.shiftCode ?? '']?.color ?? 'default'}>{a.shiftName}</Tag>
                      <Tag color={rosterStatusColor[a.status]}>{a.status}</Tag>
                    </Space>
                  }
                  description={
                    <span>
                      {a.unitName} {a.postName ? `· ${a.postName}` : ''}
                      {a.notes ? <><br /><Text type="secondary">📝 {a.notes}</Text></> : null}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </div>
  );
};
