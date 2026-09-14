import React from 'react';
import { Card, Typography, Avatar, Tag, Descriptions, Table, Row, Col, Space } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiClient } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { LoginHistoryItem, UserSession } from '../types';

const { Title, Text } = Typography;

export const Profile: React.FC = () => {
  const { user } = useAuth();

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['profile-login-history', user?.id],
    queryFn: async () => {
      const res = await apiClient.get(`/users/${user!.id}/login-history`);
      return res.data.data.items as LoginHistoryItem[];
    },
    enabled: !!user,
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['profile-sessions', user?.id],
    queryFn: async () => {
      const res = await apiClient.get(`/users/${user!.id}/sessions`);
      return res.data.data.items as UserSession[];
    },
    enabled: !!user,
  });

  if (!user) return <Card loading />;

  return (
    <div>
      <Title level={4}>My Profile</Title>
      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card>
            <Space direction="vertical" align="center" style={{ width: '100%' }}>
              <Avatar size={80} icon={<UserOutlined />} style={{ backgroundColor: '#1677ff' }} />
              <Title level={5} style={{ marginBottom: 0 }}>
                {user.fullName}
              </Title>
              <Text type="secondary">@{user.username}</Text>
              <div>
                <Tag color={user.status === 'Active' ? 'green' : 'red'}>{user.status}</Tag>
                <Tag color="blue">{user.role}</Tag>
              </div>
            </Space>
          </Card>
          <Card title="Roles" size="small" style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text type="secondary">Primary: </Text>
                <Tag color="blue">{user.primaryRole?.code || user.role}</Tag>
              </div>
              <div>
                <Text type="secondary">All active: </Text>
                <div style={{ marginTop: 4 }}>
                  {(user.roles || []).map((r) => (
                    <Tag key={r.code} style={{ marginBottom: 4 }}>
                      {r.code}
                    </Tag>
                  ))}
                </div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title="Account" size="small" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
              <Descriptions.Item label="Role name">{user.roleName}</Descriptions.Item>
              <Descriptions.Item label="User ID">{user.id}</Descriptions.Item>
              <Descriptions.Item label="Status">{user.status}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Card title="Recent login activity" size="small" style={{ marginBottom: 16 }} loading={historyLoading}>
            <Table
              size="small"
              rowKey="id"
              pagination={{ pageSize: 5 }}
              dataSource={history || []}
              columns={[
                {
                  title: 'When',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  render: (d: string) => dayjs(d).format('YYYY-MM-DD HH:mm'),
                },
                {
                  title: 'Result',
                  dataIndex: 'status',
                  key: 'status',
                  render: (s: string) => <Tag color={s === 'Success' ? 'green' : 'red'}>{s}</Tag>,
                },
                { title: 'Action', dataIndex: 'action', key: 'action' },
                { title: 'IP', dataIndex: 'ipAddress', key: 'ipAddress' },
              ]}
            />
          </Card>
          <Card title="Sessions" size="small" loading={sessionsLoading}>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={sessions || []}
              columns={[
                { title: 'IP', dataIndex: 'ipAddress', key: 'ipAddress' },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  key: 'status',
                  render: (s: string) => <Tag color={s === 'Active' ? 'green' : 'default'}>{s}</Tag>,
                },
                {
                  title: 'Last activity',
                  dataIndex: 'lastActivityAt',
                  key: 'lastActivityAt',
                  render: (d: string) => dayjs(d).format('YYYY-MM-DD HH:mm'),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};
