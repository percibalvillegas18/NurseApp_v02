import React, { useMemo, useState } from 'react';
import {
  Card,
  Typography,
  Alert,
  Tag,
  Tree,
  Input,
  Row,
  Col,
  Descriptions,
  Statistic,
} from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { rbacApi } from '../../api/client';
import { usePermission } from '../../hooks/useEffectiveAccess';

const { Title, Text } = Typography;

interface FlatMenu {
  id: number;
  code: string;
  name: string;
  route?: string;
  icon?: string;
  status?: string;
  parentCode: string | null;
  childrenCount: number;
}

export const MenuMaster: React.FC = () => {
  const { allowed: canView, isLoading: viewLoading } = usePermission('MENU_MASTER', 'VIEW');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<React.Key | null>(null);

  const { data: menus, isLoading } = useQuery({
    queryKey: ['menu-master'],
    queryFn: async () => {
      const res = await rbacApi.getMenus();
      return res.data.data.menus as any[];
    },
    enabled: canView,
  });

  const flat: FlatMenu[] = useMemo(() => {
    const out: FlatMenu[] = [];
    const walk = (nodes: any[], parent: string | null) => {
      for (const m of nodes || []) {
        out.push({
          id: m.id,
          code: m.code,
          name: m.name,
          route: m.route,
          icon: m.icon,
          status: m.status || 'Active',
          parentCode: parent,
          childrenCount: (m.children || []).length,
        });
        walk(m.children || [], m.code);
      }
    };
    walk(menus || [], null);
    return out;
  }, [menus]);

  const treeData = useMemo(() => {
    const q = search.trim().toLowerCase();
    const build = (nodes: any[]): any[] =>
      (nodes || [])
        .filter((m) => !q || m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
        .map((m) => ({
          key: m.code,
          title: `${m.name} (${m.code})`,
          children: (m.children || []).length ? build(m.children) : undefined,
        }));
    // When searching, search across the flattened list but keep tree shape from roots
    if (!q) return build(menus || []);
    const matches = new Set(
      flat.filter((m) => m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).map((m) => m.code),
    );
    const buildFiltered = (nodes: any[]): any[] =>
      (nodes || [])
        .filter((m) => matches.has(m.code) || (m.children || []).some((c: any) => matches.has(c.code)))
        .map((m) => ({
          key: m.code,
          title: `${m.name} (${m.code})`,
          children: (m.children || []).length ? buildFiltered(m.children) : undefined,
        }));
    return buildFiltered(menus || []);
  }, [menus, search, flat]);

  const selected = flat.find((m) => m.code === selectedKey) || null;

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return <Alert message="Access Denied" description="Need VIEW on MENU_MASTER" type="error" showIcon />;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4}>
          <MenuOutlined style={{ marginRight: 8 }} />
          Menu Master
        </Title>
        <Text type="secondary">
          The menu registry every guard and sidebar reads from. Role visibility is managed on the
          Roles &amp; Permissions page; this page is the read-only catalog.
        </Text>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Root menus" value={(menus || []).length} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Total entries" value={flat.length} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Routed pages" value={flat.filter((m) => m.route).length} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card title="Menu tree" size="small" loading={isLoading}>
            <Input.Search
              placeholder="Filter by code or name"
              allowClear
              style={{ marginBottom: 12 }}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Tree
              treeData={treeData}
              defaultExpandAll
              autoExpandParent
              selectedKeys={selectedKey ? [selectedKey] : []}
              onSelect={(keys) => setSelectedKey(keys[0] ?? null)}
              style={{ maxHeight: 480, overflow: 'auto' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Entry detail" size="small">
            {!selected ? (
              <Text type="secondary">Select a menu entry to inspect it.</Text>
            ) : (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Code">
                  <Tag color="blue">{selected.code}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Name">{selected.name}</Descriptions.Item>
                <Descriptions.Item label="Route">
                  {selected.route ? <Text code>{selected.route}</Text> : <Text type="secondary">Parent group (no page)</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="Icon">{selected.icon || '—'}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <Tag color={selected.status === 'Active' ? 'green' : 'red'}>{selected.status}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Parent">{selected.parentCode || '— (root)'}</Descriptions.Item>
                <Descriptions.Item label="Children">{selected.childrenCount}</Descriptions.Item>
                <Descriptions.Item label="Menu ID">{selected.id}</Descriptions.Item>
              </Descriptions>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};
