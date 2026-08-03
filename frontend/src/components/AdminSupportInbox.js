import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, List, Modal, Row, Select, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { CustomerServiceOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
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
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
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
      loadComments(issue.id);
    }
  }, [form, issues, location.search]);

  const loadComments = async (issueId) => {
    setCommentsLoading(true);
    try {
      const { data } = await axios.get(`/api/support/issues/${issueId}/comments`);
      setComments(Array.isArray(data) ? data : []);
    } catch (error) {
      message.error(error.response?.data?.error || 'Unable to load the issue conversation');
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const visibleIssues = useMemo(() => {
    if (statusFilter === 'all') return issues;
    if (statusFilter === 'active') return issues.filter(issue => ['open', 'in_progress'].includes(issue.status));
    return issues.filter(issue => issue.status === statusFilter);
  }, [issues, statusFilter]);

  const openIssue = (issue) => {
    setSelected(issue);
    setCommentBody('');
    form.setFieldsValue({ status: issue.status, resolution_note: issue.resolution_note || '' });
    loadComments(issue.id);
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (body.length < 2) return message.error('Enter at least 2 characters for your reply');
    setCommentSaving(true);
    try {
      const { data } = await axios.post(`/api/support/issues/${selected.id}/comments`, { body });
      setComments(current => [...current, data.comment]);
      setSelected(current => ({ ...current, status: data.status }));
      form.setFieldValue('status', data.status);
      setCommentBody('');
      await load();
      message.success('Comment added and reporter notified');
    } catch (error) {
      message.error(error.response?.data?.error || 'Unable to add the comment');
    } finally {
      setCommentSaving(false);
    }
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
        onCancel={() => { setSelected(null); setComments([]); setCommentBody(''); }}
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
            <Divider orientation="left">Conversation</Divider>
            <Spin spinning={commentsLoading}>
              <List
                className="support-comment-list"
                dataSource={comments}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No comments yet" /> }}
                renderItem={comment => {
                  const fromCare = comment.author_user_type === 'platform_admin';
                  return (
                    <List.Item className={fromCare ? 'support-comment support-comment--care' : 'support-comment support-comment--reporter'}>
                      <List.Item.Meta
                        title={<Space><Text strong>{fromCare ? comment.author_name || 'Customer care' : selected.reporter_name || 'Customer'}</Text><Text type="secondary">{new Date(comment.created_at).toLocaleString()}</Text></Space>}
                        description={<Text style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</Text>}
                      />
                    </List.Item>
                  );
                }}
              />
            </Spin>
            <div className="support-comment-composer">
              <Input.TextArea
                rows={3}
                maxLength={4000}
                showCount
                value={commentBody}
                onChange={event => setCommentBody(event.target.value)}
                placeholder="Write a response to the customer. This is added to the conversation and cannot overwrite earlier comments."
              />
              <Button type="primary" icon={<SendOutlined />} onClick={addComment} loading={commentSaving}>Add comment</Button>
            </div>
            <Divider orientation="left">Status and resolution</Divider>
            <Form form={form} layout="vertical" onFinish={updateIssue} className="support-resolution-form">
              <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                <Select options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
              <Form.Item
                name="resolution_note"
                label="Final resolution note"
                dependencies={['status']}
                rules={[({ getFieldValue }) => ({
                  validator: (_, value) => !['resolved', 'closed'].includes(getFieldValue('status')) || String(value || '').trim().length >= 5
                    ? Promise.resolve()
                    : Promise.reject(new Error('Add a resolution note before resolving this issue')),
                })]}
              >
                <Input.TextArea rows={4} maxLength={2000} showCount placeholder="Summarise the final outcome when resolving or closing the issue." />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>Save and notify reporter</Button>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}
