import React, { useState } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Tag,
  Input,
  Typography,
  Alert,
  Modal,
  Form,
  Select,
  DatePicker,
  Popconfirm,
  Drawer,
  Descriptions,
  Row,
  Col,
  message,
  Tooltip,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  EyeOutlined,
  DeleteOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePermission } from '../hooks/useEffectiveAccess';
import {
  useNurses,
  useNurse,
  useCreateNurse,
  useUpdateNurse,
  useDeleteNurse,
  useNursingLookups,
  useExpiringCredentials,
  credentialSummaryMeta,
  rosterStatusColor,
} from '../hooks/useNursing';
import { Nurse, NurseCredential } from '../types';

const { Title, Text } = Typography;

const apiError = (e: any, fallback: string) =>
  e?.response?.data?.message || fallback;

export const NurseMaster: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('NURSE_MASTER', 'VIEW');
  const { allowed: canCreate } = usePermission('NURSE_MASTER', 'CREATE');
  const { allowed: canEdit } = usePermission('NURSE_MASTER', 'EDIT');
  const { allowed: canDelete } = usePermission('NURSE_MASTER', 'DELETE');
  const { allowed: canViewCredentials } = usePermission('CREDENTIALS', 'VIEW');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading, isFetching } = useNurses({ search: search || undefined, page, limit: pageSize });
  const { data: lookups } = useNursingLookups();
  const { data: expiring } = useExpiringCredentials(30);

  const [editing, setEditing] = useState<Nurse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const { data: viewedNurse, isLoading: detailLoading } = useNurse(viewId ?? undefined);

  const createNurse = useCreateNurse();
  const updateNurse = useUpdateNurse();
  const deleteNurse = useDeleteNurse();
  const [form] = Form.useForm();

  // Live full-name preview: First + Middle + Last (matches backend composition)
  const departmentId = Form.useWatch('departmentId', form);
  const wFirst = Form.useWatch('firstName', form);
  const wMiddle = Form.useWatch('middleName', form);
  const wLast = Form.useWatch('lastName', form);
  const computedFullName = [wFirst, wMiddle, wLast].filter((s) => s && String(s).trim()).join(' ');

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (nurse: Nurse) => {
    setEditing(nurse);
    form.resetFields();
    form.setFieldsValue({
      positionCode: nurse.positionCode,
      departmentId: nurse.homeUnit?.departmentId,
      homeUnitId: nurse.homeUnit?.id,
      jobNo: nurse.jobNo,
      firstName: nurse.firstName,
      middleName: nurse.middleName,
      lastName: nurse.lastName,
      gender: nurse.gender,
      dateOfBirth: nurse.dateOfBirth ? dayjs(nurse.dateOfBirth) : null,
      nationality: nurse.nationality,
      contactNo: nurse.phone,
      primaryRoleId: nurse.primaryRole?.id,
      status: nurse.status,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload: any = {
      position_code: values.positionCode,
      home_unit_id: values.homeUnitId,
      job_no: values.jobNo,
      first_name: values.firstName,
      middle_name: values.middleName || undefined,
      last_name: values.lastName,
      gender: values.gender,
      date_of_birth: values.dateOfBirth ? values.dateOfBirth.format('YYYY-MM-DD') : undefined,
      nationality: values.nationality,
      phone: values.contactNo || undefined,
      primary_role_id: values.primaryRoleId,
    };

    try {
      if (editing) {
        if (values.status !== editing.status) payload.status = values.status;
        await updateNurse.mutateAsync({ id: editing.id, data: payload });
        message.success(`${computedFullName || 'Nurse'} updated`);
      } else {
        const created = await createNurse.mutateAsync(payload);
        message.success(`${computedFullName || 'Nurse'} registered as ${created.employeeNumber}`);
      }
      setModalOpen(false);
    } catch (e: any) {
      message.error(apiError(e, 'Save failed'));
    }
  };

  const handleDelete = async (nurse: Nurse) => {
    try {
      await deleteNurse.mutateAsync(nurse.id);
      message.success(`${nurse.fullName} deleted`);
    } catch (e: any) {
      message.error(apiError(e, 'Delete failed'));
    }
  };

  const credColumns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Type', dataIndex: 'credentialType', key: 'type' },
    {
      title: 'Expiry',
      dataIndex: 'expiryDate',
      key: 'expiry',
      render: (d: string | null, cred: NurseCredential) =>
        d ? (
          <span>
            {d}{' '}
            <Tag color={cred.daysUntilExpiry! < 0 ? 'red' : cred.daysUntilExpiry! <= 30 ? 'orange' : 'green'}>
              {cred.daysUntilExpiry! < 0 ? `${Math.abs(cred.daysUntilExpiry!)}d ago` : `${cred.daysUntilExpiry}d`}
            </Tag>
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <Tag color={s === 'Valid' ? 'green' : s === 'PendingVerification' ? 'orange' : 'red'}>{s}</Tag>
      ),
    },
  ];

  const columns = [
    {
      title: 'Job No. / Emp #',
      dataIndex: 'jobNo',
      key: 'jobno',
      width: 128,
      render: (jobNo: string, nurse: Nurse) => (
        <Space direction="vertical" size={0}>
          <Text strong>{jobNo ?? '—'}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{nurse.employeeNumber}</Text>
        </Space>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'fullName',
      key: 'name',
      render: (name: string, nurse: Nurse) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          {nurse.username && <Text type="secondary" style={{ fontSize: 11 }}>@{nurse.username}</Text>}
        </Space>
      ),
    },
    {
      title: 'Position',
      dataIndex: 'positionCode',
      key: 'position',
      render: (code: string | null) => code ? <Tag color="cyan">{code}</Tag> : '—',
    },
    {
      title: 'Role',
      dataIndex: ['primaryRole', 'code'],
      key: 'role',
      render: (_: any, nurse: Nurse) =>
        nurse.primaryRole ? <Tag color="blue">{nurse.primaryRole.code}</Tag> : '—',
    },
    {
      title: 'Unit',
      key: 'unit',
      render: (_: any, nurse: Nurse) => <Space direction="vertical" size={0}><Text>{nurse.homeUnit?.name ?? '—'}</Text><Text type="secondary">{nurse.department?.name}</Text></Space>,
    },
    {
      title: 'Type',
      dataIndex: 'employmentType',
      key: 'emptype',
      width: 100,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'Active' ? 'green' : status === 'OnLeave' ? 'orange' : 'red'}>{status}</Tag>
      ),
    },
    {
      title: 'Credentials',
      dataIndex: 'credentialSummary',
      key: 'creds',
      render: (summary: string, nurse: Nurse) => {
        const meta = credentialSummaryMeta[summary] || credentialSummaryMeta.None;
        return (
          <Tooltip
            title={`${nurse.credentialCounts.total} total, ${nurse.credentialCounts.expiringSoon} expiring, ${nurse.credentialCounts.expired} expired`}
          >
            <Tag color={meta.color} icon={<SafetyCertificateOutlined />}>
              {meta.label} ({nurse.credentialCounts.total})
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Action',
      key: 'action',
      width: 200,
      render: (_: any, nurse: Nurse) => (
        <Space>
          {canView && (
            <Button size="small" icon={<EyeOutlined />} onClick={() => setViewId(nurse.id)}>
              View
            </Button>
          )}
          {canEdit && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(nurse)}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Popconfirm title={`Delete ${nurse.fullName}?`} onConfirm={() => handleDelete(nurse)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on NURSE_MASTER. This is enforced by rbac.evaluate_access() backend guard."
        type="error"
        showIcon
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>Nurse Master</Title>
        <Space>
          <Input.Search
            placeholder="Search name, job no. or employee #"
            prefix={<SearchOutlined />}
            style={{ width: 240 }}
            allowClear
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Nurse
            </Button>
          )}
        </Space>
      </div>

      <Alert
        message="RBAC Permissions Active"
        description={
          <span>
            VIEW: {canView ? '✅' : '❌'} | CREATE: {canCreate ? '✅' : '❌'} | EDIT: {canEdit ? '✅' : '❌'} | DELETE: {canDelete ? '✅' : '❌'} |
            Data served from <code>/api/v1/nursing/nurses</code> (nursing.nurses, V3_0)
          </span>
        }
        type="info"
        style={{ marginBottom: 16 }}
      />

      {canViewCredentials && expiring && expiring.items.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${expiring.items.length} credential(s) expiring within ${expiring.days} days`}
          description={expiring.items
            .slice(0, 3)
            .map((c) => `${c.nurse?.fullName}: ${c.name} (${c.daysUntilExpiry}d)`)
            .join(' • ')}
          action={<Button size="small" href="/nursing/credentials">Review</Button>}
        />
      )}

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading || isFetching}
          locale={{ emptyText: <Empty description="No nurses found" /> }}
          pagination={{
            current: page,
            pageSize,
            total: data?.pagination?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t) => `${t} nurses`,
            onChange: (p, ps) => {
              setPage(ps !== pageSize ? 1 : p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      {/* Create / Edit modal - personal info entry */}
      <Modal
        title={editing ? `Edit ${editing.fullName}` : 'Add Nurse'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={createNurse.isPending || updateNurse.isPending}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="firstName" label="First Name" rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="e.g. Maria" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="middleName" label="Middle Name">
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lastName" label="Last Name" rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="e.g. Garcia" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Full Name (auto: First + Middle + Last)">
            <Input
              value={computedFullName}
              readOnly
              placeholder="Fills automatically as you type the names above"
              style={{ background: '#f5f5f5', color: computedFullName ? '#1677ff' : undefined, fontWeight: 600 }}
            />
          </Form.Item>

          <Form.Item
            name="jobNo"
            label="Job No."
            rules={[
              { required: true, message: 'Required' },
              { max: 50, message: 'Maximum 50 characters' },
              { whitespace: true, message: 'Job No. cannot be blank' },
            ]}
            extra="Unique per nurse - entered here, unlike the auto-generated Employee #."
          >
            <Input placeholder="e.g. JOB-1001" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="gender" label="Gender" rules={[{ required: true, message: 'Required' }]}>
                <Select
                  placeholder="Select"
                  options={['Male', 'Female'].map((g) => ({ value: g, label: g }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateOfBirth" label="Date of Birth" rules={[{ required: true, message: 'Required' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="nationality" label="Nationality" rules={[{ required: true, message: 'Required' }]}>
                <Select
                  showSearch
                  placeholder="Select country"
                  optionFilterProp="label"
                  options={(lookups?.countries ?? []).map((c) => ({ value: c, label: c }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="contactNo" label="Contact No. (Mobile)" rules={[{ required: true, message: 'Required' }]}>
                <Input placeholder="+966-5X-XXX-XXXX" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="primaryRoleId" label="Primary Role" rules={[{ required: true, message: 'Required' }]}>
                <Select
                  placeholder="Select role"
                  options={(lookups?.roles ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="positionCode" label="Position" rules={[{ required: true, message: 'Select a position' }]}>
            <Select showSearch optionFilterProp="label" options={[...(lookups?.positions ?? [])].sort((a, b) =>
              (a.hierarchyLevel ?? 0) - (b.hierarchyLevel ?? 0) || a.code.localeCompare(b.code),
            ).map(p => ({
              value: p.code,
              label: `${'— '.repeat(p.hierarchyLevel ?? 0)}${p.code} (${p.name})`,
            }))} />
          </Form.Item>
          <Form.Item name="departmentId" label="Department" rules={[{ required: true, message: 'Select a department' }]}>
            <Select showSearch optionFilterProp="label" onChange={() => form.setFieldValue('homeUnitId', undefined)} options={(lookups?.departments ?? []).map(d => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item name="homeUnitId" label="Nursing Unit" rules={[{ required: true, message: 'Select a nursing unit' }]}>
            <Select showSearch optionFilterProp="label" disabled={!departmentId} options={(lookups?.units ?? []).filter(u => u.department_id === departmentId).map(u => ({ value: u.id, label: u.name }))} />
          </Form.Item>

          {editing && (
            <Form.Item name="status" label="Status" style={{ marginBottom: 8 }}>
              <Select
                options={['Active', 'OnLeave', 'Suspended', 'Terminated'].map((s) => ({ value: s, label: s }))}
              />
            </Form.Item>
          )}

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 0 }}
            message={
              editing
                ? `Job No.: ${editing.jobNo ?? '—'} • Employee #: ${editing.employeeNumber}${editing.email ? ' • Email (from user account): ' + editing.email : ''}`
                : 'Employee # is auto-generated on save; Job No. is the one identifier you type, and it must be unique. The email address comes from the user account. Select the staff position and department to choose a nursing unit.'
            }
          />
        </Form>
      </Modal>

      {/* Detail drawer */}
      <Drawer
        title={viewedNurse ? viewedNurse.fullName : 'Nurse'}
        open={viewId !== null}
        onClose={() => setViewId(null)}
        width={620}
        loading={detailLoading as any}
      >
        {viewedNurse && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Job No.">{viewedNurse.jobNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Employee #">{viewedNurse.employeeNumber}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={viewedNurse.status === 'Active' ? 'green' : 'orange'}>{viewedNurse.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Full Name">{viewedNurse.fullName}</Descriptions.Item>
              <Descriptions.Item label="Gender">{viewedNurse.gender ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Date of Birth">
                {viewedNurse.dateOfBirth
                  ? `${viewedNurse.dateOfBirth} (${dayjs().diff(dayjs(viewedNurse.dateOfBirth), 'year')} yrs)`
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Nationality">{viewedNurse.nationality ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Contact No.">{viewedNurse.phone ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Email">{viewedNurse.email ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Primary Role">{viewedNurse.primaryRole?.name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Position">{viewedNurse.positionCode ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Department">{viewedNurse.department?.name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Home Unit">{viewedNurse.homeUnit?.name ?? '—'}</Descriptions.Item>
            </Descriptions>

            <Title level={5}>Credentials ({viewedNurse.credentials.length})</Title>
            <Table
              rowKey="id"
              size="small"
              columns={credColumns}
              dataSource={viewedNurse.credentials}
              pagination={false}
              style={{ marginBottom: 24 }}
            />

            <Title level={5}>Upcoming Assignments</Title>
            <Table
              rowKey="id"
              size="small"
              dataSource={viewedNurse.upcomingAssignments}
              pagination={false}
              locale={{ emptyText: <Empty description="Nothing scheduled" /> }}
              columns={[
                { title: 'Date', dataIndex: 'assignmentDate', key: 'date' },
                { title: 'Shift', dataIndex: 'shiftName', key: 'shift' },
                { title: 'Unit', dataIndex: 'unitCode', key: 'unit' },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  key: 'status',
                  render: (s: string) => <Tag color={rosterStatusColor[s]}>{s}</Tag>,
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
};
