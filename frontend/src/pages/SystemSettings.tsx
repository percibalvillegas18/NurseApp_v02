import React, { useEffect } from 'react';
import {
  Card,
  Typography,
  Alert,
  Button,
  Space,
  Form,
  Input,
  InputNumber,
  Switch,
  message,
  Row,
  Col,
} from 'antd';
import { SettingOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../api/client';
import { SystemSettings as SystemSettingsType } from '../types';
import { usePermission } from '../hooks/useEffectiveAccess';

const { Title, Text } = Typography;

export const SystemSettings: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('SYSTEM_SETTINGS', 'VIEW');
  const { allowed: canEdit } = usePermission('SYSTEM_SETTINGS', 'EDIT');
  const qc = useQueryClient();
  const [form] = Form.useForm();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: async () => {
      const res = await settingsApi.getSettings();
      return res.data.data as SystemSettingsType;
    },
    enabled: canView,
  });

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMut = useMutation({
    mutationFn: async (body: any) => (await settingsApi.updateSettings(body)).data.data,
    onSuccess: () => {
      message.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['systemSettings'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.message || 'Save failed'),
  });

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return <Alert message="Access Denied" description="Need VIEW on SYSTEM_SETTINGS" type="error" showIcon />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>
          <SettingOutlined style={{ marginRight: 8 }} />
          System Settings
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            Reload
          </Button>
          {canEdit && (
            <Button type="primary" icon={<SaveOutlined />} loading={saveMut.isPending} onClick={() => form.submit()}>
              Save changes
            </Button>
          )}
        </Space>
      </div>

      {!canEdit && (
        <Alert
          type="warning"
          showIcon
          message="Read-only — you need EDIT on SYSTEM_SETTINGS to change these."
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        disabled={!canEdit}
        onFinish={(v) => saveMut.mutate(v)}
      >
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Card title="Hospital identity" size="small" style={{ marginBottom: 16 }} loading={isLoading}>
              <Form.Item name="hospitalName" label="Hospital name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="hospitalNameAr" label="Hospital name (Arabic)">
                <Input dir="rtl" />
              </Form.Item>
              <Form.Item name="hospitalCode" label="Hospital code" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Card>

            <Card title="Sessions & tokens" size="small" style={{ marginBottom: 16 }} loading={isLoading}>
              <Form.Item name="accessTokenTtlSec" label="Access token TTL (seconds)">
                <InputNumber min={60} max={86400} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="refreshTokenTtlSec" label="Refresh token TTL (seconds)">
                <InputNumber min={3600} max={2592000} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="maxSessionsPerUser" label="Max sessions per user">
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
            </Card>

            <Card title="Maintenance" size="small" style={{ marginBottom: 16 }} loading={isLoading}>
              <Form.Item name="maintenanceMode" label="Maintenance mode" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Text type="secondary">When on, only SYSTEM_ADMIN can sign in (enforced by the real backend).</Text>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title="Password policy" size="small" style={{ marginBottom: 16 }} loading={isLoading}>
              <Form.Item name="passwordMinLength" label="Minimum length">
                <InputNumber min={6} max={64} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="passwordRequireComplexity" label="Require complexity (upper/lower/digit/symbol)" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="passwordExpiryDays" label="Expiry (days, 0 = never)">
                <InputNumber min={0} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Card>

            <Card title="Lockout" size="small" style={{ marginBottom: 16 }} loading={isLoading}>
              <Form.Item name="lockoutMaxAttempts" label="Max failed attempts">
                <InputNumber min={3} max={20} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="lockoutMinutes" label="Lock duration (minutes)">
                <InputNumber min={1} max={1440} style={{ width: '100%' }} />
              </Form.Item>
              <Text type="secondary">Locks are per-account; unknown usernames are throttled per IP.</Text>
            </Card>

            <Card title="Roster & alerts" size="small" style={{ marginBottom: 16 }} loading={isLoading}>
              <Form.Item name="rosterRequiresValidContract" label="Roster requires a valid contract" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="rosterHorizonDays" label="Default roster horizon (days)">
                <InputNumber min={1} max={90} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="credentialAlertDays" label="Credential expiry alert horizon (days)">
                <InputNumber min={1} max={365} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="contractAlertDays" label="Contract expiry alert horizon (days)">
                <InputNumber min={1} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
          </Col>
        </Row>

        {data?.updatedAt && (
          <Text type="secondary">Last updated: {data.updatedAt}. Preview note: settings reset when the mock server restarts.</Text>
        )}
      </Form>
    </div>
  );
};
