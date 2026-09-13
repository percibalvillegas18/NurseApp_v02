import React from 'react';
import { Card, Typography, Alert, Tag, List } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { usePermission } from '../hooks/useEffectiveAccess';

const { Title, Text } = Typography;

const PLANNED = [
  'Document repository per nurse: ID / passport, license, certificates, contracts, other',
  'File upload + preview with expiry date and issuing authority metadata',
  'Expiry tracking and renewal reminders (ties into credential alerts)',
  'Document categories and verification status workflow',
  'Download access audit trail; RBAC-guarded (menu DOCUMENTS: VIEW / CREATE / EDIT / DELETE / UPLOAD)',
];

export const Documents: React.FC = () => {
  const { allowed: canView, isLoading } = usePermission('DOCUMENTS', 'VIEW');

  if (isLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on DOCUMENTS"
        type="error"
        showIcon
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>
          <FolderOpenOutlined style={{ marginRight: 8 }} />
          Documents
        </Title>
        <Tag color="orange">TO DO</Tag>
      </div>

      <Alert
        message="Menu placeholder - feature not built yet"
        description="Nurse document repository. Menu entry retained per the Nursing area definition; pages, API and tables will be implemented on request."
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Card title="Planned scope" size="small">
        <List
          size="small"
          dataSource={PLANNED}
          renderItem={(item) => (
            <List.Item>
              <Text>{item}</Text>
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
};
