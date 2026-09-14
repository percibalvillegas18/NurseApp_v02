import React from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Typography, Alert, Space, Button } from 'antd';
import {
  TeamOutlined,
  ScheduleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuth } from '../hooks/useAuth';
import { useUserFullAccess, useAccessibleMenus } from '../hooks/useEffectiveAccess';
import { useAnalyticsSummary } from '../hooks/useAnalytics';
import { useRoster, rosterStatusColor } from '../hooks/useNursing';

const { Title, Text } = Typography;

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: fullAccess } = useUserFullAccess();
  const { data: menus } = useAccessibleMenus();
  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary();

  const today = dayjs().format('YYYY-MM-DD');
  const { data: rosterToday, isLoading: rosterLoading } = useRoster({ from: today, to: today });

  const stats = [
    {
      title: 'Total Nurses (active)',
      value: summary?.headcount.total ?? 0,
      icon: <TeamOutlined />,
      color: '#1677ff',
      loading: summaryLoading,
    },
    {
      title: 'On Duty Today',
      value: rosterToday?.items.length ?? 0,
      icon: <ScheduleOutlined />,
      color: '#52c41a',
      loading: rosterLoading,
    },
    {
      title: 'Pending Leaves',
      value: summary?.leave.pendingApprovals ?? 0,
      icon: <ClockCircleOutlined />,
      color: '#faad14',
      loading: summaryLoading,
    },
    {
      title: 'Credentials Expiring ≤30d',
      value: summary?.credentials.expiring30 ?? 0,
      icon: <WarningOutlined />,
      color: '#ff4d4f',
      loading: summaryLoading,
    },
  ];

  const columns = [
    { title: 'Nurse', dataIndex: 'nurseName', key: 'nurseName' },
    { title: 'Unit', dataIndex: 'unitCode', key: 'unitCode' },
    { title: 'Shift', dataIndex: 'shiftName', key: 'shiftName' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={rosterStatusColor[status] || 'default'}>{status}</Tag>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={4}>Welcome back, {user?.fullName}!</Title>
        <Text type="secondary">
          Role: {user?.roleName} ({user?.role}) | Roles: {user?.roles?.map((r) => r.code).join(', ') || user?.role} | Access evaluated via rbac.evaluate_access()
        </Text>
      </div>

      <Alert
        message="RBAC Effective Access Active"
        description={`You have access to ${menus?.length || 0} menus. Full access matrix has ${fullAccess?.fullMatrix?.length || 0} rows (menus x permissions). Multi-role support: ${user?.roles?.length || 1} active roles.`}
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      {(summary?.contracts.withoutValidContract || 0) > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Contract coverage gap"
          description={`${summary?.contracts.withoutValidContract} active nurse(s) have no valid employment contract and cannot be rostered.`}
          action={<Button size="small" onClick={() => navigate('/nursing/contract')}>Open contracts</Button>}
        />
      )}
      {(summary?.credentials.expired || 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Expired credentials"
          description={`${summary?.credentials.expired} credential(s) are expired and need renewal.`}
          action={<Button size="small" onClick={() => navigate('/nursing/credentials')}>Open credentials</Button>}
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {stats.map((stat) => (
          <Col xs={24} sm={12} lg={6} key={stat.title}>
            <Card loading={stat.loading}>
              <Statistic
                title={stat.title}
                value={stat.value}
                prefix={React.cloneElement(stat.icon, { style: { color: stat.color } })}
                valueStyle={{ color: stat.color }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title={`Today's Roster (${today})`}
            extra={
              <Button type="link" onClick={() => navigate('/scheduling/roster')}>
                View All
              </Button>
            }
            loading={rosterLoading}
          >
            <Table
              rowKey="id"
              columns={columns}
              dataSource={rosterToday?.items || []}
              pagination={false}
              size="small"
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="Your Access Summary" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text strong>Primary Role:</Text> <Tag color="blue">{user?.role}</Tag>
                </div>
                <div>
                  <Text strong>All Active Roles:</Text>
                  <div style={{ marginTop: 4 }}>
                    {user?.roles?.map((r) => (
                      <Tag key={r.code} style={{ marginBottom: 4 }}>
                        {r.code}
                      </Tag>
                    )) || <Tag>{user?.role}</Tag>}
                  </div>
                </div>
                <div>
                  <Text strong>Accessible Menus:</Text> {menus?.length ?? 'Loading...'}
                </div>
                <div>
                  <Text strong>Granted Permissions:</Text>{' '}
                  {fullAccess?.summary?.grantedPermissions ?? fullAccess?.fullMatrix?.length ?? 'Loading...'}
                </div>
              </Space>
            </Card>

            <Card title="RBAC Guard Status" size="small">
              <Space direction="vertical">
                <div>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} /> Backend guard active
                </div>
                <div>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} /> Frontend usePermission hook active
                </div>
                <div>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} /> Multi-role OR logic enabled
                </div>
                <div>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} /> Audit logging enabled
                </div>
              </Space>
            </Card>

            <Card title="Quick Actions" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button block onClick={() => navigate('/scheduling/roster')}>
                  View Roster
                </Button>
                <Button block onClick={() => navigate('/scheduling/leave')}>
                  Request Leave
                </Button>
                <Button block type="primary" onClick={() => navigate('/admin/effective-access')}>
                  Evaluate My Access
                </Button>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
};
