import React, { useState } from 'react';
import { Card, Form, InputNumber, Input, Button, message } from 'antd';
import axios from 'axios';

export default function CustomerDashboard() {
  const [loading, setLoading] = useState(false);
  const onFinish = async (values) => {
    setLoading(true);
    try {
      await axios.post(`/api/bids/${values.bid_id}/requirements`, values);
      message.success('Requirement submitted');
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    } finally { setLoading(false); }
  };
  return (
    <div style={{ padding: 24 }}>
      <h2>Customer Portal</h2>
      <Card title="Submit Requirements for a Bid">
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="bid_id" label="Bid ID" rules={[{ required: true }]}>
            <Input placeholder="Enter bid UUID" />
          </Form.Item>
          <Form.Item name="budget_amount" label="Budget (ZMW) - hidden from suppliers">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="expected_delivery_time" label="Expected Delivery (e.g., 14 days)">
            <Input />
          </Form.Item>
          <Form.Item name="payment_method" label="Payment Method">
            <Input />
          </Form.Item>
          <Form.Item name="certification_standards" label="Certification Standards">
            <Input.TextArea />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>Submit</Button>
        </Form>
      </Card>
    </div>
  );
}
