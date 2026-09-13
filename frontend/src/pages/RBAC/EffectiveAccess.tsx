import React, { useState } from 'react';
import { Card, Form, Select, InputNumber, Button, Typography, Alert, Descriptions, Tag, Table, Space } from 'antd';
import { SafetyOutlined, SearchOutlined } from '@ant-design/icons';
import { useEvaluateAccess, useUserFullAccess, usePreviewAccessChange } from '../../hooks/useEffectiveAccess';
import { useAuth } from '../../hooks/useAuth';

const { Title } = Typography;

export const EffectiveAccessPage: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const evaluateMutation = useEvaluateAccess();
  const fullAccessQuery = useUserFullAccess();
  const previewMutation = usePreviewAccessChange();

  const [evaluateResult, setEvaluateResult] = useState<any>(null);

  const onEvaluate = async (values: any) => {
    try {
      const result = await evaluateMutation.mutateAsync({
        userId: values.userId || user!.id,
        menuCode: values.menuCode,
        permissionCode: values.permissionCode,
        resourceId: values.resourceId,
      });
      setEvaluateResult(result);
    } catch (error) {
      console.error(error);
    }
  };

  const menuOptions = [
    'DASHBOARD',
    'NURSE_MASTER',
    'NURSE_ROSTER',
    'LEAVE_MANAGEMENT',
    'USER_MANAGEMENT',
    'ROLES_PERMISSIONS',
    'AUDIT_LOGS',
    'SYSTEM_SETTINGS',
    'ACCESS_LEVEL_MASTER',
    'MENU_MASTER',
  ];

  const permOptions = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'MANAGE', 'APPROVE', 'EXPORT', 'ASSIGN'];

  return (
    <div>
      <Title level={4}>
        <SafetyOutlined /> Effective Access Evaluation
      </Title>

      <Alert
        message="Single Source of Truth: rbac.evaluate_access()"
        description="This page directly calls the fixed SQL function with multi-role support (BOOL_OR logic). AND-logic: Menu accessible AND Permission granted AND Data scope valid AND User Active AND Temporal valid. Deny by default."
        type="info"
        style={{ marginBottom: 16 }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Evaluate Specific Access" size="small">
          <Form form={form} layout="vertical" onFinish={onEvaluate} initialValues={{ userId: user?.id, menuCode: 'NURSE_MASTER', permissionCode: 'VIEW' }}>
            <Form.Item name="userId" label="User ID">
              <InputNumber style={{ width: '100%' }} placeholder={String(user?.id)} />
            </Form.Item>

            <Form.Item name="menuCode" label="Menu Code" rules={[{ required: true }]}>
              <Select options={menuOptions.map((m) => ({ label: m, value: m }))} showSearch />
            </Form.Item>

            <Form.Item name="permissionCode" label="Permission Code" rules={[{ required: true }]}>
              <Select options={permOptions.map((p) => ({ label: p, value: p }))} />
            </Form.Item>

            <Form.Item name="resourceId" label="Resource ID (optional, for data scope)">
              <InputNumber style={{ width: '100%' }} placeholder="e.g., nurse ID" />
            </Form.Item>

            <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={evaluateMutation.isPending} block>
              Evaluate Access
            </Button>
          </Form>

          {evaluateResult && (
            <Card size="small" style={{ marginTop: 16, background: evaluateResult.decision.allowed ? '#f6ffed' : '#fff2f0' }}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Decision">
                  <Tag color={evaluateResult.decision.allowed ? 'green' : 'red'} style={{ fontSize: 14 }}>
                    {evaluateResult.decision.allowed ? 'ALLOW' : 'DENY'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Reason">{evaluateResult.decision.reason}</Descriptions.Item>
                <Descriptions.Item label="Menu Accessible">{evaluateResult.decision.menuAccessible ? '✅' : '❌'}</Descriptions.Item>
                <Descriptions.Item label="Permission Granted">{evaluateResult.decision.permissionGranted ? '✅' : '❌'}</Descriptions.Item>
                <Descriptions.Item label="Data Scope Valid">{evaluateResult.decision.dataScopeValid ? '✅' : '❌'}</Descriptions.Item>
                <Descriptions.Item label="Roles">{evaluateResult.decision.roles?.join(', ')}</Descriptions.Item>
                <Descriptions.Item label="Cache TTL">{evaluateResult.decision.cacheTtl}s</Descriptions.Item>
                <Descriptions.Item label="Evaluated At">{new Date(evaluateResult.decision.evaluatedAt).toLocaleString()}</Descriptions.Item>
              </Descriptions>
            </Card>
          )}
        </Card>

        <Card title="Full Access Matrix" size="small" loading={fullAccessQuery.isLoading}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <strong>User:</strong> {user?.username} (ID: {user?.id})
            </div>
            <div>
              <strong>Accessible Menus:</strong> {fullAccessQuery.data?.menus?.length || 0}
            </div>
            <div>
              <strong>Total Matrix Rows:</strong> {fullAccessQuery.data?.summary?.totalRows || fullAccessQuery.data?.fullMatrix?.length || 0} (menus x perms)
            </div>

            <Table
              size="small"
              dataSource={fullAccessQuery.data?.menus?.slice(0, 10) || []}
              rowKey="id"
              pagination={false}
              columns={[
                { title: 'Menu', dataIndex: 'code', key: 'code', render: (c: string) => <Tag>{c}</Tag> },
                { title: 'Name', dataIndex: 'name', key: 'name' },
                {
                  title: 'Permissions',
                  key: 'perms',
                  render: (_: any, rec: any) => (
                    <div>
                      {Object.entries(rec.permissions || {})
                        .filter(([_, allowed]) => allowed)
                        .map(([perm]) => (
                          <Tag key={perm} color="green" style={{ marginBottom: 2 }}>
                            {perm}
                          </Tag>
                        ))}
                    </div>
                  ),
                },
              ]}
            />

            <Alert message="This uses rbac.get_user_full_access() with multi-role BOOL_OR fix" type="info" showIcon />
          </Space>
        </Card>
      </div>

      <Card title="Preview Access Change (Impact Analysis)" size="small" style={{ marginTop: 16 }}>
        <Alert
          message="Admin feature: preview impact before committing"
          description="Calls rbac.preview_access_change() which shows current vs proposed decision and affected users count. Useful for high-risk MANAGE/DELETE permission changes."
          type="warning"
          style={{ marginBottom: 16 }}
        />

        <Space>
          <Button
            onClick={async () => {
              try {
                const res = await previewMutation.mutateAsync({
                  userId: user!.id,
                  changeType: 'PERMISSION_GRANT',
                  menuId: 1,
                  permissionId: 1,
                  proposedAllowed: true,
                });
                console.log(res);
              } catch (e) {
                console.error(e);
              }
            }}
          >
            Test Preview (DASHBOARD VIEW)
          </Button>
          {previewMutation.data && (
            <div>
              <Tag>Current: {previewMutation.data.current_decision}</Tag>
              <Tag>Proposed: {previewMutation.data.proposed_decision}</Tag>
              <Tag>Affected: {previewMutation.data.affected_users} users</Tag>
              <div>{previewMutation.data.impact_description}</div>
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
};
