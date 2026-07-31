import React, { useEffect, useState } from 'react';
import { Alert, Button, Divider, Form, Input, List, Modal, Result, Select, Tag, Typography, message } from 'antd';
import { CustomerServiceOutlined, SendOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;

export default function SupportIssueModal({ open, onClose }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [recentIssues, setRecentIssues] = useState([]);

  useEffect(() => {
    if (open) {
      axios.get('/api/support/issues/mine')
        .then(({ data }) => setRecentIssues(Array.isArray(data) ? data : []))
        .catch(() => setRecentIssues([]));
      return;
    }
    form.resetFields();
    setSubmitted(null);
    setSubmitting(false);
    setRecentIssues([]);
  }, [form, open]);

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
      {submitted ? (
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
                  <List.Item extra={<Tag color={issue.status === 'resolved' ? 'success' : issue.status === 'in_progress' ? 'processing' : 'default'}>{issue.status.replace('_', ' ')}</Tag>}>
                    <List.Item.Meta
                      title={<span><Text code>{issue.reference}</Text> {issue.subject}</span>}
                      description={issue.resolution_note || new Date(issue.created_at).toLocaleString()}
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
