import React from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Typography, Alert, Space, Button } from 'antd';
import {
  TeamOutlined,
  ScheduleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useAuth } from '../hooks/useAuth';
import { useUserFullAccess, useAccessibleMenus } from '../hooks/useEffectiveAccess';

const { Title, Text } = Typography;

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { data: fullAccess, isLoading: accessLoading } = useUserFullAccess();
  const { data: menus } = useAccessibleMenus();

  const stats = [
    {
      title: 'Total Nurses',
      value: 42,
      icon: <TeamOutlined />,
      color: '#1677ff',
    },
    {
      title: 'On Duty Today',
      value: 18,
      icon: <ScheduleOutlined />,
      color: '#52c41a',
    },
    {
      title: 'Pending Leaves',
      value: 5,
      icon: <ClockCircleOutlined />,
      color: '#faad14',
    },
    {
      title: 'Credentials Expiring',
      value: 3,
      icon: <WarningOutlined />,
      color: '#ff4d4f',
    },
  ];

  const recentRoster = [
    { key: '1', nurse: 'Maria Garcia', unit: 'ICU_A', shift: 'Morning', status: 'Confirmed' },
    { key: '2', nurse: 'Ahmed Hassan', unit: 'ICU_A', shift: 'Evening', status: 'Confirmed' },
    { key: '3', nurse: 'Jennifer Smith', unit: 'ICU_A', shift: 'Night', status: 'Pending' },
    { key: '4', nurse: 'David Kim', unit: 'ICU_A', shift: 'Morning', status: 'Confirmed' },
  ];

  const columns = [
    { title: 'Nurse', dataIndex: 'nurse', key: 'nurse' },
    { title: 'Unit', dataIndex: 'unit', key: 'unit' },
    { title: 'Shift', dataIndex: 'shift', key: 'shift' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'Confirmed' ? 'green' : 'orange'}>{status}</Tag>
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

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {stats.map((stat) => (
          <Col xs={24} sm={12} lg={6} key={stat.title}>
            <Card>
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
          <Card title="Today's Roster" extra={<Button type="link">View All</Button>}>
            <Table columns={columns} dataSource={recentRoster} pagination={false} size="small" />
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
                  <Text strong>Accessible Menus:</Text> {menus?.length || 'Loading...'}
                </div>
                <div>
                  <Text strong>Data Scope:</Text> <Tag>ICU_A</Tag> <Tag>Hospital</Tag>
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
                <Button block>View My Roster</Button>
                <Button block>Request Leave</Button>
                <Button block type="primary">
                  Evaluate My Access
                </Button>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>

      {fullAccess && (
        <Card title="Full Access Matrix (Debug)" style={{ marginTop: 16 }} size="small">
          <Text type="secondary" style={{ fontSize: 12 }}>
            This shows raw output of rbac.get_user_full_access({user?.id}) - {fullAccess.summary?.totalRows || fullAccess.fullMatrix?.length} combinations
          </Text>
          <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 8, fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
            <pre>{JSON.stringify(fullAccess.summary || { accessibleMenus: menus?.length }, null, 2)}</pre>
          </div>
        </Card>
      )}
    </div>
  );
};
