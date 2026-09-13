import React, { useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Typography,
  Alert,
  Space,
  Segmented,
  Button,
  Popconfirm,
  message,
  Tooltip,
  Empty,
} from 'antd';
import { CheckCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { usePermission } from '../hooks/useEffectiveAccess';
import { useExpiringCredentials, useVerifyCredential } from '../hooks/useNursing';
import { NurseCredential } from '../types';
import { StaffCredentialTracker } from '../components/StaffCredentialTracker';

const { Title } = Typography;

const dayColor = (d: number | null) => {
  if (d === null) return 'default';
  if (d < 0) return 'red';
  if (d <= 14) return 'volcano';
  if (d <= 30) return 'orange';
  return 'green';
};

export const Credentials: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('CREDENTIALS', 'VIEW');
  const { allowed: canVerify } = usePermission('CREDENTIALS', 'VERIFY');

  const [days, setDays] = useState(30);
  const { data, isLoading } = useExpiringCredentials(days);
  const verify = useVerifyCredential();

  const items = data?.items ?? [];
  const expiredCount = items.filter((c) => (c.daysUntilExpiry ?? 0) < 0).length;

  const handleVerify = async (cred: NurseCredential) => {
    try {
      await verify.mutateAsync({ id: cred.id });
      message.success(`${cred.name} verified for ${cred.nurse?.fullName ?? `nurse #${cred.nurseId}`}`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'Verify failed');
    }
  };

  const columns = [
    {
      title: 'Nurse',
      key: 'nurse',
      render: (_: any, c: NurseCredential) =>
        c.nurse ? (
          <Space direction="vertical" size={0}>
            <span>{c.nurse.fullName}</span>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {c.nurse.employeeNumber}
            </Typography.Text>
          </Space>
        ) : (
          `#${c.nurseId}`
        ),
    },
    {
      title: 'Credential',
      key: 'name',
      render: (_: any, c: NurseCredential) => (
        <Space>
          <SafetyCertificateOutlined />
          <span>{c.name}</span>
          <Tag>{c.credentialType}</Tag>
        </Space>
      ),
    },
    { title: 'Authority', dataIndex: 'issuingAuthority', key: 'auth', render: (a?: string | null) => a ?? '—' },
    {
      title: 'Expiry Date',
      dataIndex: 'expiryDate',
      key: 'expiry',
      defaultSortOrder: 'ascend' as const,
      sorter: (a: NurseCredential, b: NurseCredential) =>
        (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''),
    },
    {
      title: 'Days Left',
      dataIndex: 'daysUntilExpiry',
      key: 'days',
      render: (d: number | null) =>
        d === null ? '—' : <Tag color={dayColor(d)}>{d < 0 ? `${Math.abs(d)}d overdue` : `${d}d`}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <Tag color={s === 'Valid' ? 'green' : s === 'PendingVerification' ? 'orange' : 'red'}>{s}</Tag>
      ),
    },
    {
      title: 'Verified',
      key: 'verified',
      render: (_: any, c: NurseCredential) =>
        c.verifiedAt ? new Date(c.verifiedAt).toLocaleDateString() : <Tag color="orange">Unverified</Tag>,
    },
    ...(canVerify
      ? [
          {
            title: 'Action',
            key: 'action',
            render: (_: any, c: NurseCredential) => (
              <Tooltip title="Mark as verified and valid">
                <Popconfirm title={`Verify ${c.name}?`} onConfirm={() => handleVerify(c)}>
                  <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />}>
                    Verify
                  </Button>
                </Popconfirm>
              </Tooltip>
            ),
          },
        ]
      : []),
  ];

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on CREDENTIALS. Enforced by rbac.evaluate_access() backend guard."
        type="error"
        showIcon
      />
    );
  }

  return (
    <div>
      <StaffCredentialTracker />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>Credential Compliance Radar</Title>
        <Space>
          <span>Window:</span>
          <Segmented
            value={days}
            onChange={(v) => setDays(v as number)}
            options={[7, 30, 60, 90].map((d) => ({ value: d, label: `${d}d` }))}
          />
          <Tag>VERIFY: {canVerify ? '✅' : '❌'}</Tag>
        </Space>
      </div>

      <Alert
        type={expiredCount > 0 ? 'error' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          expiredCount > 0
            ? `${expiredCount} credential(s) ALREADY EXPIRED - immediate action required`
            : `${items.length} credential(s) expiring within ${days} days`
        }
        description={
          <>
            Data from <code>/api/v1/nursing/credentials/expiring</code> (mirrors the{' '}
            <code>nursing.credentials_expiring_soon</code> view). Only active nurses with Valid/ExpiringSoon
            credentials are listed.
          </>
        }
      />

      <Card>
        <Table
          rowKey="id"
          columns={columns as any}
          dataSource={items}
          loading={isLoading}
          locale={{ emptyText: <Empty description="Nothing expiring in this window" /> }}
          pagination={{ pageSize: 15 }}
        />
      </Card>
    </div>
  );
};
