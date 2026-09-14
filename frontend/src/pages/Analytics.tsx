import React, { useState } from 'react';
import {
  Card,
  Typography,
  Alert,
  Tag,
  Table,
  Button,
  Space,
  Statistic,
  Row,
  Col,
  Tabs,
  DatePicker,
  Select,
} from 'antd';
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiClient } from '../api/client';
import { usePermission } from '../hooks/useEffectiveAccess';
import {
  useAnalyticsSummary,
  useAnalyticsCredentials,
  useAnalyticsContracts,
  useAnalyticsRoster,
  useAnalyticsLeave,
  breakdownRows,
} from '../hooks/useAnalytics';
import { useNursingLookups } from '../hooks/useNursing';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const BreakdownCard: React.FC<{ title: string; data?: Record<string, number>; loading?: boolean }> = ({
  title,
  data,
  loading,
}) => (
  <Card title={title} size="small" loading={loading}>
    <Table
      size="small"
      pagination={false}
      dataSource={breakdownRows(data)}
      columns={[
        { title: 'Group', dataIndex: 'label', key: 'label' },
        { title: 'Count', dataIndex: 'count', key: 'count', width: 80 },
      ]}
    />
  </Card>
);

export const Analytics: React.FC = () => {
  const qc = useQueryClient();
  const { allowed: canView, isLoading: viewLoading } = usePermission('WORKFORCE_ANALYTICS', 'VIEW');

  const [rosterRange, setRosterRange] = useState<[string, string] | undefined>();
  const [rosterUnitId, setRosterUnitId] = useState<number | undefined>();
  const [leaveYear, setLeaveYear] = useState<string | undefined>();

  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary(canView);
  const { data: creds, isLoading: credsLoading } = useAnalyticsCredentials(canView);
  const { data: contracts, isLoading: contractsLoading } = useAnalyticsContracts(canView);
  const { data: roster, isLoading: rosterLoading } = useAnalyticsRoster(
    { from: rosterRange?.[0], to: rosterRange?.[1], unitId: rosterUnitId },
    canView,
  );
  const { data: leave, isLoading: leaveLoading } = useAnalyticsLeave(leaveYear, canView);
  const { data: lookups } = useNursingLookups();
  const { data: agencies } = useQuery({
    queryKey: ['contract-agencies-analytics'],
    queryFn: async () => {
      const { data } = await apiClient.get('/contracts/agencies');
      return data.data as any[];
    },
    enabled: canView,
  });

  if (viewLoading) return <Card loading />;

  if (!canView) {
    return (
      <Alert
        message="Access Denied"
        description="You don't have VIEW permission on WORKFORCE_ANALYTICS"
        type="error"
        showIcon
      />
    );
  }

  const agencyName = (id: string | number) => {
    const a = (agencies || []).find((x: any) => String(x.id) === String(id));
    return a ? `${a.code} — ${a.name}` : `Agency #${id}`;
  };

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['analyticsSummary'] });
    qc.invalidateQueries({ queryKey: ['analyticsCredentials'] });
    qc.invalidateQueries({ queryKey: ['analyticsContracts'] });
    qc.invalidateQueries({ queryKey: ['analyticsRoster'] });
    qc.invalidateQueries({ queryKey: ['analyticsLeave'] });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>
          <BarChartOutlined style={{ marginRight: 8 }} />
          Workforce Analytics
        </Title>
        <Space>
          <Text type="secondary">
            {summary ? `Generated ${dayjs(summary.generatedAt).format('HH:mm:ss')}` : ''}
          </Text>
          <Button icon={<ReloadOutlined />} onClick={refreshAll}>
            Refresh
          </Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={4}>
          <Card size="small" loading={summaryLoading}>
            <Statistic title="Active nurses" value={summary?.headcount.total ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card size="small" loading={summaryLoading}>
            <Statistic title="On leave today" value={summary?.leave.onLeaveToday ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card size="small" loading={summaryLoading}>
            <Statistic
              title="Pending leave"
              value={summary?.leave.pendingApprovals ?? 0}
              valueStyle={{ color: (summary?.leave.pendingApprovals || 0) > 0 ? '#faad14' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card size="small" loading={summaryLoading}>
            <Statistic
              title="Creds expiring ≤30d"
              value={summary?.credentials.expiring30 ?? 0}
              valueStyle={{ color: (summary?.credentials.expiring30 || 0) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card size="small" loading={summaryLoading}>
            <Statistic
              title="Contracts exp ≤90d"
              value={summary?.contracts.expiring90 ?? 0}
              valueStyle={{ color: (summary?.contracts.expiring90 || 0) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card size="small" loading={summaryLoading}>
            <Statistic
              title="No valid contract"
              value={summary?.contracts.withoutValidContract ?? 0}
              valueStyle={{ color: (summary?.contracts.withoutValidContract || 0) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      {(summary?.contracts.withoutValidContract || 0) > 0 && (
        <Alert
          type="error"
          showIcon
          message={`${summary?.contracts.withoutValidContract} active nurse(s) have no valid employment contract today — they cannot be rostered. See Contracts tab.`}
          style={{ marginBottom: 16 }}
        />
      )}

      <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: 'Headcount',
            children: (
              <Row gutter={16}>
                <Col xs={24} lg={8}>
                  <BreakdownCard title="By role" data={summary?.headcount.byRole} loading={summaryLoading} />
                </Col>
                <Col xs={24} lg={8}>
                  <BreakdownCard title="By home unit" data={summary?.headcount.byUnit} loading={summaryLoading} />
                </Col>
                <Col xs={24} lg={8}>
                  <BreakdownCard
                    title="By employment type"
                    data={summary?.headcount.byEmploymentType}
                    loading={summaryLoading}
                  />
                </Col>
              </Row>
            ),
          },
          {
            key: 'credentials',
            label: `Credentials (${creds?.total ?? 0})`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Row gutter={16}>
                  <Col xs={24} lg={12}>
                    <BreakdownCard title="By status" data={creds?.byStatus} loading={credsLoading} />
                  </Col>
                  <Col xs={24} lg={12}>
                    <BreakdownCard title="By category" data={creds?.byCategory} loading={credsLoading} />
                  </Col>
                </Row>
                <Card title="Expiring within 30 days" size="small" loading={credsLoading}>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={creds?.expiring30 || []}
                    columns={[
                      { title: 'Nurse', key: 'nurse', render: (_: any, r: any) => r.nurse?.fullName || `#${r.nurseId}` },
                      { title: 'Credential', dataIndex: 'name', key: 'name' },
                      { title: 'Expiry', dataIndex: 'expiryDate', key: 'expiryDate' },
                      {
                        title: 'Days left',
                        dataIndex: 'daysUntilExpiry',
                        key: 'daysUntilExpiry',
                        render: (d: number) => <Tag color={d <= 7 ? 'red' : 'orange'}>{d}d</Tag>,
                      },
                    ]}
                  />
                </Card>
                {(creds?.expired.length || 0) > 0 && (
                  <Card title="Expired" size="small" loading={credsLoading}>
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={creds?.expired || []}
                      columns={[
                        { title: 'Nurse', key: 'nurse', render: (_: any, r: any) => r.nurse?.fullName || `#${r.nurseId}` },
                        { title: 'Credential', dataIndex: 'name', key: 'name' },
                        { title: 'Expiry', dataIndex: 'expiryDate', key: 'expiryDate' },
                      ]}
                    />
                  </Card>
                )}
              </Space>
            ),
          },
          {
            key: 'contracts',
            label: `Contracts (${contracts?.total ?? 0})`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Row gutter={16}>
                  <Col xs={24} lg={8}>
                    <BreakdownCard title="By status" data={contracts?.byStatus} loading={contractsLoading} />
                  </Col>
                  <Col xs={24} lg={8}>
                    <BreakdownCard title="By type" data={contracts?.byType} loading={contractsLoading} />
                  </Col>
                  <Col xs={24} lg={8}>
                    <Card title="By agency" size="small" loading={contractsLoading}>
                      <Table
                        size="small"
                        pagination={false}
                        dataSource={Object.entries(contracts?.byAgency || {}).map(([id, count]) => ({
                          key: id,
                          label: agencyName(id),
                          count,
                        }))}
                        columns={[
                          { title: 'Agency', dataIndex: 'label', key: 'label' },
                          { title: 'Count', dataIndex: 'count', key: 'count', width: 80 },
                        ]}
                      />
                    </Card>
                  </Col>
                </Row>
                <Card title="Expiring within 90 days" size="small" loading={contractsLoading}>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={contracts?.expiring90 || []}
                    columns={[
                      { title: 'Contract #', dataIndex: 'contractNumber', key: 'contractNumber' },
                      { title: 'Nurse', key: 'nurse', render: (_: any, r: any) => r.nurse?.fullName || `#${r.nurseId}` },
                      { title: 'Type', dataIndex: 'contractType', key: 'contractType' },
                      { title: 'End', dataIndex: 'endDate', key: 'endDate' },
                    ]}
                  />
                </Card>
                <Card title="Active nurses WITHOUT a valid contract" size="small" loading={contractsLoading}>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={contracts?.uncoveredNurses || []}
                    columns={[
                      { title: 'Nurse', dataIndex: 'fullName', key: 'fullName' },
                      { title: 'Employee #', dataIndex: 'employeeNumber', key: 'employeeNumber' },
                      { title: 'Job No.', dataIndex: 'jobNo', key: 'jobNo' },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'roster',
            label: 'Roster coverage',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Card size="small">
                  <Space wrap>
                    <RangePicker
                      onChange={(_, ds) => setRosterRange(ds[0] && ds[1] ? [ds[0], ds[1]] : undefined)}
                    />
                    <Select
                      allowClear
                      placeholder="All units"
                      style={{ width: 220 }}
                      options={(lookups?.units || []).map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
                      onChange={(v) => setRosterUnitId(v)}
                    />
                    <Text type="secondary">
                      {roster ? `${roster.total} assignment(s), ${roster.from} → ${roster.to}` : ''}
                    </Text>
                  </Space>
                </Card>
                <Row gutter={16}>
                  <Col xs={24} lg={14}>
                    <Card title="Assignments per day" size="small" loading={rosterLoading}>
                      <Table
                        size="small"
                        rowKey="date"
                        pagination={{ pageSize: 10 }}
                        dataSource={roster?.daily || []}
                        columns={[
                          { title: 'Date', dataIndex: 'date', key: 'date' },
                          { title: 'Total', dataIndex: 'total', key: 'total', width: 70 },
                          {
                            title: 'By shift',
                            key: 'shifts',
                            render: (_: any, r: any) =>
                              Object.entries(r.byShift || {})
                                .map(([k, v]) => `${k}:${v}`)
                                .join(' · ') || '—',
                          },
                          {
                            title: 'By status',
                            key: 'status',
                            render: (_: any, r: any) =>
                              Object.entries(r.byStatus || {})
                                .map(([k, v]) => `${k}:${v}`)
                                .join(' · ') || '—',
                          },
                        ]}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} lg={10}>
                    <Card title="Busiest nurses (period)" size="small" loading={rosterLoading}>
                      <Table
                        size="small"
                        rowKey="nurseId"
                        pagination={false}
                        dataSource={roster?.topNurses || []}
                        columns={[
                          { title: 'Nurse', dataIndex: 'fullName', key: 'fullName' },
                          { title: 'Assignments', dataIndex: 'assignments', key: 'assignments', width: 110 },
                        ]}
                      />
                    </Card>
                  </Col>
                </Row>
              </Space>
            ),
          },
          {
            key: 'leave',
            label: 'Leave',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Card size="small">
                  <Space>
                    <Text>Year:</Text>
                    <Select
                      allowClear
                      placeholder={String(new Date().getFullYear())}
                      style={{ width: 130 }}
                      options={[0, 1, 2].map((i) => {
                        const y = String(new Date().getFullYear() - i);
                        return { value: y, label: y };
                      })}
                      onChange={(v) => setLeaveYear(v)}
                    />
                  </Space>
                </Card>
                <Row gutter={16}>
                  <Col xs={24} lg={8}>
                    <BreakdownCard title="Requests by status" data={leave?.requestsByStatus} loading={leaveLoading} />
                  </Col>
                  <Col xs={24} lg={8}>
                    <BreakdownCard title="Approved days by type" data={leave?.approvedDaysByType} loading={leaveLoading} />
                  </Col>
                  <Col xs={24} lg={8}>
                    <BreakdownCard title="Approved days by month" data={leave?.approvedDaysByMonth} loading={leaveLoading} />
                  </Col>
                </Row>
                <Card title="Low balances (≤20% of entitlement)" size="small" loading={leaveLoading}>
                  <Table
                    size="small"
                    rowKey={(r: any) => `${r.nurseId}-${r.leaveTypeCode}`}
                    pagination={false}
                    dataSource={leave?.lowBalances || []}
                    columns={[
                      { title: 'Nurse', dataIndex: 'fullName', key: 'fullName' },
                      { title: 'Type', dataIndex: 'leaveTypeName', key: 'leaveTypeName' },
                      { title: 'Entitled', dataIndex: 'entitled', key: 'entitled' },
                      { title: 'Used', dataIndex: 'used', key: 'used' },
                      {
                        title: 'Remaining',
                        dataIndex: 'remaining',
                        key: 'remaining',
                        render: (v: number) => <Tag color="red">{v}d</Tag>,
                      },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
};
