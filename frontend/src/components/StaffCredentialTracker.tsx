import React, { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { nursingApi, apiClient } from '../api/client';
import { useCreateCredential, useNurseCredentials, useNurses, useNursingLookups, useVerifyCredential } from '../hooks/useNursing';
import { usePermission } from '../hooks/useEffectiveAccess';
import { CredentialTemplate, NurseCredential } from '../types';

const errorText = (e: any) => {
  const text = e?.response?.data?.message;
  return Array.isArray(text) ? text.join(', ') : text || 'The request failed. Please try again.';
};

export const StaffCredentialTracker: React.FC = () => {
  const { allowed: canCreate } = usePermission('CREDENTIALS', 'CREATE');
  const { allowed: canEdit } = usePermission('CREDENTIALS', 'EDIT');
  const { allowed: canVerify } = usePermission('CREDENTIALS', 'VERIFY');
  const [search, setSearch] = useState('');
  const [nurseId, setNurseId] = useState<number>();
  const nurses = useNurses({ search, limit: 100 });
  const lookups = useNursingLookups();
  const credentials = useNurseCredentials(nurseId);
  const create = useCreateCredential();
  const verify = useVerifyCredential();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NurseCredential | null>(null);
  const [viewing, setViewing] = useState<NurseCredential | null>(null);
  const templateCode = Form.useWatch('template_code', form);
  const templates = lookups.data?.credentialTemplates ?? [];
  const selected = templates.find(t => t.code === templateCode);
  const viewTemplate = templates.find(t => t.code === viewing?.templateCode);
  const document = useQuery({
    queryKey: ['credentialDocument', viewing?.id],
    enabled: !!viewing,
    queryFn: async () => (await apiClient.get(`/nursing/credentials/${viewing!.id}/document`)).data.data as
      { fileName: string; size: number } | null,
  });
  const invalidate = () => {
    for (const key of ['nurseCredentials', 'nurse', 'nurses', 'expiringCredentials', 'credentialDocument']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  const save = useMutation({
    mutationFn: async (payload: any) => editing
      ? (await nursingApi.updateCredential(editing.id, payload)).data.data.credential
      : create.mutateAsync({ ...payload, nurse_id: nurseId }),
    onSuccess: () => { invalidate(); setOpen(false); message.success('Credential saved for verification'); },
    onError: e => message.error(errorText(e)),
  });
  const edit = (credential?: NurseCredential) => {
    setEditing(credential ?? null);
    form.resetFields();
    if (credential) {
      const template = templates.find(t => t.code === credential.templateCode);
      const tracking = { ...credential.trackingData } as Record<string, any>;
      for (const field of template?.fields ?? []) if (field.type === 'date' && tracking[field.key]) tracking[field.key] = dayjs(tracking[field.key]);
      form.setFieldsValue({
        template_code: credential.templateCode, name: credential.name, credential_type: credential.credentialType,
        credential_number: credential.credentialNumber, issuing_authority: credential.issuingAuthority,
        issued_date: credential.issuedDate ? dayjs(credential.issuedDate) : null,
        expiry_date: credential.expiryDate ? dayjs(credential.expiryDate) : null,
        tracking_data: tracking,
      });
    }
    setOpen(true);
  };
  const submit = async () => {
    try {
      const values = await form.validateFields();
      const tracking: Record<string, string | number> = {};
      for (const field of selected?.fields ?? []) {
        const value = values.tracking_data?.[field.key];
        if (value !== undefined && value !== null && value !== '') tracking[field.key] = field.type === 'date' ? value.format('YYYY-MM-DD') : value;
      }
      const payload = {
        ...(selected && { template_code: selected.code }),
        name: selected?.name ?? editing?.name,
        credential_type: selected?.credentialType ?? editing?.credentialType,
        credential_number: values.credential_number || null,
        issuing_authority: values.issuing_authority || null,
        issued_date: values.issued_date?.format('YYYY-MM-DD') ?? null,
        expiry_date: values.expiry_date?.format('YYYY-MM-DD') ?? null,
        tracking_data: tracking,
      };
      save.mutate(payload);
    } catch { /* The form displays validation errors next to their fields. */ }
  };
  const download = async () => {
    if (!viewing || !document.data) return;
    try {
      const response = await apiClient.get(`/nursing/credentials/${viewing.id}/document/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = window.document.createElement('a');
      link.href = url; link.download = document.data.fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { message.error(errorText(e)); }
  };
  const displayTracking = (field: CredentialTemplate['fields'][number], data: NurseCredential) => {
    const value = data.trackingData?.[field.key];
    return field.type === 'unit' ? lookups.data?.units.find(u => u.id === value)?.name ?? value ?? '—' : value ?? '—';
  };

  return <Card title="Staff Credential Tracking" style={{ marginBottom: 24 }}>
    <Space wrap style={{ width: '100%', marginBottom: 16 }}>
      <Select aria-label="Select staff member" placeholder="Search staff by name, job no. or employee number" showSearch filterOption={false}
        style={{ width: 420, maxWidth: '100%' }} value={nurseId} onSearch={setSearch}
        onChange={id => { setNurseId(id); setViewing(null); setOpen(false); }} loading={nurses.isFetching}
        options={nurses.data?.items.map(n => ({ value: n.id, label: `${n.fullName} — ${n.jobNo || n.employeeNumber}` }))} />
      {canCreate && <Button type="primary" disabled={!nurseId || !templates.length} onClick={() => edit()}>Add Credential</Button>}
    </Space>
    {(nurses.isError || lookups.isError || credentials.isError) && <Alert type="error" showIcon message="Could not load staff or credential data" action={<Button onClick={() => { nurses.refetch(); lookups.refetch(); credentials.refetch(); }}>Retry</Button>} />}
    {!nurseId ? <Typography.Paragraph type="secondary">Select a staff member to record identity documents, licenses, clearances, competencies, and life support certificates.</Typography.Paragraph> :
      <Table rowKey="id" loading={credentials.isLoading} dataSource={credentials.data ?? []} pagination={{ pageSize: 10 }} scroll={{ x: 760 }}
        locale={{ emptyText: 'No credentials recorded for this staff member' }} columns={[
          { title: 'Category', dataIndex: 'category', render: value => value ?? 'Other' },
          { title: 'Credential', dataIndex: 'name' },
          { title: 'Expiry / Reassessment', dataIndex: 'expiryDate', render: (value, c) => value ? <Space>{value}<Tag color={(c.daysUntilExpiry ?? 0) < 0 ? 'red' : (c.daysUntilExpiry ?? 0) <= 30 ? 'orange' : 'green'}>{(c.daysUntilExpiry ?? 0) < 0 ? 'Overdue' : `${c.daysUntilExpiry}d`}</Tag></Space> : 'No expiry' },
          { title: 'Verification', dataIndex: 'status', render: value => <Tag color={value === 'PendingVerification' ? 'orange' : value === 'Valid' ? 'green' : 'default'}>{value === 'PendingVerification' ? 'Pending Verification' : value}</Tag> },
          { title: 'Actions', render: (_, c) => <Space>
            <Button size="small" onClick={() => setViewing(c)}>View</Button>
            {canEdit && <Button size="small" onClick={() => edit(c)}>Edit</Button>}
            {canVerify && <Button size="small" disabled={(c.daysUntilExpiry ?? 0) < 0} title={(c.daysUntilExpiry ?? 0) < 0 ? 'Update the expiry date before verification' : undefined} loading={verify.isPending} onClick={() => Modal.confirm({ title: `Verify ${c.name}?`, content: 'Confirm that the recorded details and supporting document have been checked.', onOk: async () => { try { await verify.mutateAsync({ id: c.id }); invalidate(); message.success('Credential verified'); } catch (e) { message.error(errorText(e)); throw e; } } })}>Verify</Button>}
          </Space> },
        ]} />}
    <Modal title={editing ? `Edit ${editing.name}` : 'Add Credential'} open={open} width={760} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={save.isPending}>
      <Form form={form} layout="vertical" preserve={false}>
        {(!editing || editing.templateCode) && <Form.Item name="template_code" label="Credential" rules={[{ required: true }]}>
          <Select disabled={!!editing} showSearch optionFilterProp="label" onChange={() => {
            form.setFieldsValue({ tracking_data: {}, credential_number: null, issuing_authority: null, issued_date: null, expiry_date: null });
          }} options={[...new Set(templates.map(t => t.category))].map(category => ({ label: category, options: templates.filter(t => t.category === category).map(t => ({ value: t.code, label: t.name })) }))} />
        </Form.Item>}
        {selected && <Typography.Paragraph type="secondary">{selected.description}</Typography.Paragraph>}
        <Row gutter={16}>
          {(selected?.numberLabel || editing && !selected) && <Col xs={24} sm={12}><Form.Item name="credential_number" label={selected?.numberLabel ?? 'Credential Number'} rules={[{ max: 100 }]}><Input maxLength={100} /></Form.Item></Col>}
          {(selected?.authorityLabel || editing && !selected) && <Col xs={24} sm={12}><Form.Item name="issuing_authority" label={selected?.authorityLabel ?? 'Issuing Authority'} rules={[{ max: 255 }]}><Input maxLength={255} /></Form.Item></Col>}
          <Col xs={24} sm={12}><Form.Item name="issued_date" label={selected?.issuedLabel ?? 'Issue Date'}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          {(selected?.expiryLabel || editing && !selected) && <Col xs={24} sm={12}><Form.Item name="expiry_date" label={selected?.expiryLabel ?? 'Expiry Date'} dependencies={['issued_date']} rules={[({ getFieldValue }) => ({ validator: (_, value) => !value || !getFieldValue('issued_date') || !value.isBefore(getFieldValue('issued_date'), 'day') ? Promise.resolve() : Promise.reject(new Error('Must be on or after the issue/assessment date')) })]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>}
          {selected?.fields.map(field => <Col xs={24} sm={12} key={`${selected.code}-${field.key}`}><Form.Item name={['tracking_data', field.key]} label={field.label}
            rules={field.key === 'expiryDateHijri' ? [{ pattern: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$/, message: 'Use YYYY-MM-DD (Hijri)' }] : []}>
            {field.type === 'date' ? <DatePicker style={{ width: '100%' }} /> : field.type === 'number' ? <InputNumber min={0} precision={field.key === 'supervisedCasesCount' ? 0 : 2} style={{ width: '100%' }} /> : field.type === 'select' ? <Select allowClear options={field.options?.map(value => ({ value, label: value }))} /> : field.type === 'unit' ? <Select allowClear showSearch optionFilterProp="label" options={lookups.data?.units.map(u => ({ value: u.id, label: u.name }))} /> : <Input maxLength={500} />}
          </Form.Item></Col>)}
        </Row>
        <Typography.Paragraph type="secondary">Save the record, then use View to upload its supporting copy. Changes require verification again.</Typography.Paragraph>
      </Form>
    </Modal>
    <Modal title={viewing?.name} open={!!viewing} width={760} onCancel={() => setViewing(null)} footer={<Button onClick={() => setViewing(null)}>Close</Button>}>
      {viewing && <>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="Category">{viewing.category ?? viewing.credentialType}</Descriptions.Item>
          <Descriptions.Item label={viewTemplate?.numberLabel ?? 'Document / Certificate Number'}>{viewing.credentialNumber ?? '—'}</Descriptions.Item>
          <Descriptions.Item label={viewTemplate?.authorityLabel ?? 'Issuing Authority'}>{viewing.issuingAuthority ?? '—'}</Descriptions.Item>
          <Descriptions.Item label={viewTemplate?.issuedLabel ?? 'Issue Date'}>{viewing.issuedDate ?? '—'}</Descriptions.Item>
          <Descriptions.Item label={viewTemplate?.expiryLabel ?? 'Expiry / Reassessment'}>{viewing.expiryDate ?? '—'}</Descriptions.Item>
          {viewTemplate?.fields.map(field => <Descriptions.Item key={field.key} label={field.label}>{displayTracking(field, viewing)}</Descriptions.Item>)}
        </Descriptions>
        <Typography.Title level={5}>Uploaded Copy</Typography.Title>
        {document.isError ? <Alert type="error" message="Could not load document information" /> : document.isLoading ? 'Loading document…' : document.data ? <Button onClick={download}>{document.data.fileName} — Download</Button> : <Typography.Paragraph>No copy uploaded.</Typography.Paragraph>}
        {canEdit && <Upload accept=".pdf,.jpg,.jpeg,.png" maxCount={1} showUploadList={false} beforeUpload={file => {
          if (file.size > 5 * 1024 * 1024) { message.error('Maximum file size is 5 MB'); return Upload.LIST_IGNORE; }
          return true;
        }} customRequest={async ({ file, onSuccess, onError }) => {
          try {
            const data = new FormData(); data.append('file', file as File);
            await apiClient.post(`/nursing/credentials/${viewing.id}/document`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
            invalidate(); onSuccess?.({}); message.success('Document saved; credential requires verification');
          } catch (e) { message.error(errorText(e)); onError?.(e as Error); }
        }}><Button style={{ marginTop: 12 }}>{document.data ? 'Replace Copy' : 'Upload Copy'} (PDF/JPEG/PNG, up to 5 MB)</Button></Upload>}
      </>}
    </Modal>
  </Card>;
};
