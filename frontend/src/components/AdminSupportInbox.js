import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Row, Select, Statistic, Table, Tag, Typography, message } from 'antd';
import { CustomerServiceOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

const { Text } = Typography;
const STATUS_META = {
  open: { label: 'Open', color: 'error' },
  in_progress: { label: 'In progress', color: 'processing' },
  resolved: { label: 'Resolved', color: 'success' },
  closed: { label: 'Closed', color: 'default' },
};

export default function AdminSupportInbox() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [selected, setSelected] = useState(null);
  const [form] = Form.useForm();
  const location = useLocation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/support/issues');
      setIssues(Array.isArray(data) ? data : []);
    } catch (error) {
      message.error(error.response?.data?.error || 'Unable to load customer-care issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const focus = new URLSearchParams(location.search).get('focus');
    if (!focus || !issues.length) return;
    const issue = issues.find(item => item.id === focus);
    if (issue) {
      setSelected(issue);
      form.setFieldsValue({ status: issue.status, resolution_note: issue.resolution_note || '' });
    }
  }, [form, issues, location.search]);

  const visibleIssues = useMemo(() => {
    if (statusFilter === 'all') return issues;
    if (statusFilter === 'active') return issues.filter(issue => ['open', 'in_progress'].includes(issue.status));
    return issues.filter(issue => issue.status === statusFilter);
  }, [issues, statusFilter]);

  const openIssue = (issue) => {
    setSelected(issue);
    form.setFieldsValue({ status: issue.status, resolution_note: issue.resolution_note || '' });
  };

  const updateIssue = async (values) => {
    setSaving(true);
    try {
      await axios.put(`/api/support/issues/${selected.id}`, values);
      message.success('Issue updated and reporter notified');
      setSelected(null);
      form.resetFields();
      await load();
    } catch (error) {
      message.error(error.response?.data?.error || 'Unable to update issue');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { title: 'Reference', dataIndex: 'reference', render: value => <Text code>{value}</Text> },
    {
      title: 'Issue',
      dataIndex: 'subject',
      render: (value, row) => <div className="portal-table-primary"><strong>{value}</strong><small>{row.category.replace('_', ' ')} · {row.reporter_email}</small></div>,
    },
    { title: 'Priority', dataIndex: 'priority', render: value => <Tag color={value === 'high' ? 'error' : value === 'normal' ? 'warning' : 'default'}>{value}</Tag> },
    { title: 'Status', dataIndex: 'status', render: value => <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.label || value}</Tag> },
    { title: 'Received', dataIndex: 'created_at', render: value => new Date(value).toLocaleString() },
    { title: 'Next step', render: (_, row) => <Button type="link" onClick={() => openIssue(row)}>Review</Button> },
  ];

  return (
    <div className="support-inbox">
      <Row gutter={[14, 14]} className="support-summary-row">
        <Col xs={12} md={6}><Card><Statistic title="Open" value={issues.filter(issue => issue.status === 'open').length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="In progress" value={issues.filter(issue => issue.status === 'in_progress').length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="High priority" value={issues.filter(issue => issue.priority === 'high' && !['resolved', 'closed'].includes(issue.status)).length} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Resolved" value={issues.filter(issue => issue.status === 'resolved').length} /></Card></Col>
      </Row>
      <Card
        className="table-card"
        title={<span><CustomerServiceOutlined /> Customer-care inbox</span>}
        extra={<div className="support-inbox-actions"><Select value={statusFilter} onChange={setStatusFilter} options={[
          { value: 'active', label: 'Active issues' },
          { value: 'open', label: 'Open' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All issues' },
        ]} /><Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button></div>}
      >
        <Alert type="info" showIcon message="Reports are delivered to both platform administrators. Opening or resolving an issue is recorded in the audit trail." className="support-inbox-alert" />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visibleIssues}
          columns={columns}
          scroll={{ x: 920 }}
          pagination={{ pageSize: 12 }}
          locale={{ emptyText: <Empty description="No customer-care issues in this view" /> }}
        />
      </Card>

      <Modal
        title={selected ? `Issue ${selected.reference}` : 'Customer-care issue'}
        open={Boolean(selected)}
        onCancel={() => setSelected(null)}
        footer={null}
        width={720}
      >
        {selected && (
          <>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} className="support-issue-details">
              <Descriptions.Item label="Reporter">{selected.reporter_name || selected.reporter_email}</Descriptions.Item>
              <Descriptions.Item label="Email">{selected.reporter_email}</Descriptions.Item>
              <Descriptions.Item label="Category">{selected.category.replace('_', ' ')}</Descriptions.Item>
              <Descriptions.Item label="Priority">{selected.priority}</Descriptions.Item>
              <Descriptions.Item label="Subject" span={2}>{selected.subject}</Descriptions.Item>
              <Descriptions.Item label="Details" span={2}><Text style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</Text></Descriptions.Item>
            </Descriptions>
            <Form form={form} layout="vertical" onFinish={updateIssue} className="support-resolution-form">
              <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                <Select options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
              <Form.Item
                name="resolution_note"
                label="Response or resolution note"
                dependencies={['status']}
                rules={[({ getFieldValue }) => ({
                  validator: (_, value) => !['resolved', 'closed'].includes(getFieldValue('status')) || String(value || '').trim().length >= 5
                    ? Promise.resolve()
                    : Promise.reject(new Error('Add a resolution note before resolving this issue')),
                })]}
              >
                <Input.TextArea rows={4} maxLength={2000} showCount placeholder="Record what was checked, changed, or communicated." />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>Save and notify reporter</Button>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}
