import React, { useState } from 'react';
import { Card, Table, Tag, Typography, Alert, DatePicker, Select, Space, Input } from 'antd';
import { AuditOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../../api/client';
import { usePermission } from '../../hooks/useEffectiveAccess';

const { Title } = Typography;
const { RangePicker } = DatePicker;

export const AuditLogs: React.FC = () => {
  const { allowed: canView } = usePermission('AUDIT_LOGS', 'VIEW');
  const [filters, setFilters] = useState<any>({ page: 1, limit: 20 });

  const { data, isLoading } = useQuery({
    queryKey: ['auditLogs', filters],
    queryFn: async () => {
      const res = await auditApi.getLogs(filters);
      return res.data.data;
    },
    enabled: canView,
  });

  const { data: stats } = useQuery({
    queryKey: ['auditStats'],
    queryFn: async () => {
      const res = await auditApi.getStatistics('7days');
      return res.data.data;
    },
    enabled: canView,
  });

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: 'User', dataIndex: 'username', key: 'username', render: (u: string) => u || '-' },
    { title: 'Action', dataIndex: 'action', key: 'action', render: (a: string) => <Tag color={a.includes('DENIED') ? 'red' : a.includes('SUCCESS') ? 'green' : 'blue'}>{a}</Tag> },
    { title: 'Entity', dataIndex: 'entity_type', key: 'entity_type' },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={s === 'Success' ? 'green' : s === 'Denied' ? 'red' : 'orange'}>{s}</Tag> },
    { title: 'IP', dataIndex: 'ip_address', key: 'ip_address' },
    { title: 'Time', dataIndex: 'created_at', key: 'created_at', render: (t: string) => new Date(t).toLocaleString() },
  ];

  if (!canView) {
    return <Alert message="Access Denied" description="Need VIEW on AUDIT_LOGS" type="error" showIcon />;
  }

  return (
    <div>
      <Title level={4}>
        <AuditOutlined /> Audit Logs
      </Title>

      <Alert
        message="Immutable Audit Trail"
        description={`Total logs: ${stats?.totals?.totalLogs || 0} | Denied: ${stats?.totals?.deniedLogs || 0} | Failed logins: ${stats?.totals?.failedLogins || 0} | Config changes: ${stats?.totals?.configChanges || 0}. RLS prevents UPDATE/DELETE. Retention 1 year.`}
        type="info"
        style={{ marginBottom: 16 }}
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            placeholder="Action"
            style={{ width: 180 }}
            allowClear
            options={[
              { label: 'LOGIN_SUCCESS', value: 'LOGIN_SUCCESS' },
              { label: 'LOGIN_FAILURE', value: 'LOGIN_FAILURE' },
              { label: 'ACCESS_DENIED', value: 'ACCESS_DENIED' },
              { label: 'CONFIGURATION_CHANGE', value: 'CONFIGURATION_CHANGE' },
            ]}
            onChange={(v) => setFilters({ ...filters, action: v, page: 1 })}
          />
          <Select
            placeholder="Status"
            style={{ width: 120 }}
            allowClear
            options={[
              { label: 'Success', value: 'Success' },
              { label: 'Failure', value: 'Failure' },
              { label: 'Denied', value: 'Denied' },
            ]}
            onChange={(v) => setFilters({ ...filters, status: v, page: 1 })}
          />
          <Input.Search
            placeholder="Search entity"
            style={{ width: 200 }}
            onSearch={(v) => setFilters({ ...filters, entityType: v, page: 1 })}
          />
          <RangePicker onChange={(dates) => setFilters({ ...filters, startDate: dates?.[0], endDate: dates?.[1], page: 1 })} />
        </Space>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={data?.items || []}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: filters.page,
            pageSize: filters.limit,
            total: data?.pagination?.total || 0,
            onChange: (page, pageSize) => setFilters({ ...filters, page, limit: pageSize }),
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} logs`,
          }}
          size="small"
          scroll={{ x: 1000 }}
        />
      </Card>

      {stats?.byAction && (
        <Card title="Top Actions (7 days)" size="small" style={{ marginTop: 16 }}>
          <Space wrap>
            {stats.byAction.map((item: any) => (
              <Tag key={item.action} style={{ marginBottom: 4 }}>
                {item.action}: {item.count}
              </Tag>
            ))}
          </Space>
        </Card>
      )}
    </div>
  );
};
