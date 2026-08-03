import React, { useEffect, useState } from 'react';
import { Alert, Button, Divider, Empty, Form, Input, List, Modal, Result, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, CustomerServiceOutlined, SendOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;

export default function SupportIssueModal({ open, onClose }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [recentIssues, setRecentIssues] = useState([]);
  const [conversationIssue, setConversationIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replyForm] = Form.useForm();

  const loadRecentIssues = () => axios.get('/api/support/issues/mine')
    .then(({ data }) => {
      const next = Array.isArray(data) ? data : [];
      setRecentIssues(next);
      return next;
    })
    .catch(() => {
      setRecentIssues([]);
      return [];
    });

  useEffect(() => {
    if (open) {
      loadRecentIssues();
      return;
    }
    form.resetFields();
    setSubmitted(null);
    setSubmitting(false);
    setRecentIssues([]);
    setConversationIssue(null);
    setComments([]);
    setConversationLoading(false);
    setReplying(false);
    replyForm.resetFields();
  }, [form, open, replyForm]);

  const openConversation = async (issue) => {
    setConversationIssue(issue);
    setConversationLoading(true);
    try {
      const { data } = await axios.get(`/api/support/issues/${issue.id}/comments`);
      setComments(Array.isArray(data) ? data : []);
    } catch (error) {
      message.error(error.response?.data?.error || 'Unable to load this conversation');
      setComments([]);
    } finally {
      setConversationLoading(false);
    }
  };

  const sendReply = async ({ body }) => {
    setReplying(true);
    try {
      const { data } = await axios.post(`/api/support/issues/${conversationIssue.id}/comments`, { body });
      setComments(current => [...current, data.comment]);
      setConversationIssue(current => ({ ...current, status: data.status }));
      replyForm.resetFields();
      await loadRecentIssues();
      message.success(data.status === 'open' ? 'Reply sent and issue reopened' : 'Reply sent to customer care');
    } catch (error) {
      message.error(error.response?.data?.error || 'Unable to add your reply');
    } finally {
      setReplying(false);
    }
  };

  const submit = async (values) => {
    setSubmitting(true);
    try {
      const { data } = await axios.post('/api/support/issues', values);
      setSubmitted(data);
      message.success('Your issue was sent to customer care');
    } catch (error) {
      message.error(error.response?.data?.error || 'Unable to submit your issue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={<span><CustomerServiceOutlined /> Customer care</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      {conversationIssue ? (
        <div className="support-conversation">
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => setConversationIssue(null)} className="support-conversation-back">
            My issues
          </Button>
          <Space wrap className="support-conversation-heading">
            <Text code>{conversationIssue.reference}</Text>
            <Text strong>{conversationIssue.subject}</Text>
            <Tag color={conversationIssue.status === 'resolved' ? 'success' : conversationIssue.status === 'in_progress' ? 'processing' : 'default'}>
              {conversationIssue.status.replace('_', ' ')}
            </Tag>
          </Space>
          <Alert
            type="info"
            showIcon
            message="Your original report"
            description={<Text style={{ whiteSpace: 'pre-wrap' }}>{conversationIssue.description}</Text>}
          />
          <Divider orientation="left">Conversation</Divider>
          <Spin spinning={conversationLoading}>
            <List
              className="support-comment-list"
              dataSource={comments}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No replies yet" /> }}
              renderItem={comment => {
                const fromCare = comment.author_user_type === 'platform_admin';
                return (
                  <List.Item className={fromCare ? 'support-comment support-comment--care' : 'support-comment support-comment--reporter'}>
                    <List.Item.Meta
                      title={<Space><Text strong>{fromCare ? 'Customer care' : 'You'}</Text><Text type="secondary">{new Date(comment.created_at).toLocaleString()}</Text></Space>}
                      description={<Text style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</Text>}
                    />
                  </List.Item>
                );
              }}
            />
          </Spin>
          {conversationIssue.resolution_note && (
            <Alert type="success" showIcon message="Resolution" description={conversationIssue.resolution_note} />
          )}
          <Form form={replyForm} layout="vertical" onFinish={sendReply} className="support-reply-form">
            <Form.Item name="body" label="Add a reply" rules={[{ required: true, min: 2, max: 4000 }]}>
              <Input.TextArea rows={3} maxLength={4000} showCount placeholder="Share an update or answer customer care." />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={replying}>Send reply</Button>
          </Form>
        </div>
      ) : submitted ? (
        <Result
          status="success"
          title="Your issue has been sent"
          subTitle={<>Both platform administrators have been notified. Keep reference <Text code copyable>{submitted.reference}</Text> for follow-up.</>}
          extra={<Button type="primary" onClick={onClose}>Return to workspace</Button>}
        />
      ) : (
        <>
          <Alert
            className="support-modal-intro"
            type="info"
            showIcon
            message="Tell us what happened"
            description="Your report goes directly to the System Administrator and Business Administrator. Never include passwords, PINs, or payment verification codes."
          />
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ category: 'technical', priority: 'normal' }}
            onFinish={submit}
          >
            <Form.Item name="category" label="What do you need help with?" rules={[{ required: true }]}>
              <Select options={[
                { value: 'technical', label: 'Technical problem' },
                { value: 'account', label: 'Account or access' },
                { value: 'bid', label: 'Bid or procurement process' },
                { value: 'payment', label: 'Payment or payout' },
                { value: 'security', label: 'Security concern' },
                { value: 'other', label: 'Something else' },
              ]} />
            </Form.Item>
            <Form.Item
              name="subject"
              label="Short summary"
              rules={[{ required: true, min: 5, max: 120 }]}
            >
              <Input maxLength={120} showCount placeholder="For example: Unable to upload a bid document" />
            </Form.Item>
            <Form.Item
              name="description"
              label="What happened?"
              extra="Include the action you were taking, what you expected, and any error message shown."
              rules={[{ required: true, min: 20, max: 4000 }]}
            >
              <Input.TextArea rows={6} maxLength={4000} showCount placeholder="Describe the issue without sharing confidential credentials." />
            </Form.Item>
            <Form.Item name="priority" label="Impact" rules={[{ required: true }]}>
              <Select options={[
                { value: 'low', label: 'Low — I can continue working' },
                { value: 'normal', label: 'Normal — part of my work is blocked' },
                { value: 'high', label: 'High — I cannot continue' },
              ]} />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={submitting} block size="large">
              Send to customer care
            </Button>
          </Form>
          {recentIssues.length > 0 && (
            <div className="support-recent-issues">
              <Divider />
              <Text strong>My recent issues</Text>
              <List
                size="small"
                dataSource={recentIssues.slice(0, 5)}
                renderItem={issue => (
                  <List.Item extra={<Space><Tag color={issue.status === 'resolved' ? 'success' : issue.status === 'in_progress' ? 'processing' : 'default'}>{issue.status.replace('_', ' ')}</Tag><Button size="small" onClick={() => openConversation(issue)}>View</Button></Space>}>
                    <List.Item.Meta
                      title={<span><Text code>{issue.reference}</Text> {issue.subject}</span>}
                      description={`${issue.comment_count || 0} replies · Updated ${new Date(issue.latest_comment_at || issue.updated_at || issue.created_at).toLocaleString()}`}
                    />
                  </List.Item>
                )}
              />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
