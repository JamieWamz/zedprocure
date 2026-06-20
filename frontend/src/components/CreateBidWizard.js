import React, { useState, useEffect } from 'react';
import { Form, Input, DatePicker, InputNumber, Switch, Select, Button, message } from 'antd';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function CreateBidWizard() {
  const [verifiedSuppliers, setVerifiedSuppliers] = useState([]);
  const [tenantId, setTenantId] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/me').then(res => setTenantId(res.data.tenantId));
  }, []);

  useEffect(() => {
    axios.get('/api/suppliers/verified').then(res => setVerifiedSuppliers(res.data));
  }, []);

  const onFinish = async (values) => {
    if (!tenantId) {
      message.error('Tenant not identified');
      return;
    }
    if (values.supplier_ids.length < 3) {
      message.error('Minimum 3 verified suppliers required by Zambian Public Procurement Act.');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`/api/tenants/${tenantId}/bids`, {
        ...values,
        deadline: values.deadline.toISOString(),
        delivery_start: values.delivery_start?.toISOString(),
        delivery_end: values.delivery_end?.toISOString(),
      });
      message.success('Bid created and opened');
      navigate('/admin/bids');
    } catch (err) {
      message.error(err.response?.data?.error || 'Creation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: 'auto' }}>
      <h2>Create New Bid</h2>
      <Form layout="vertical" onFinish={onFinish} initialValues={{ evaluation_method: 'lowest_price' }}>
        <Form.Item name="title" label="Title" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea />
        </Form.Item>
        <Form.Item name="deadline" label="Supplier Acceptance Deadline" rules={[{ required: true }]}>
          <DatePicker showTime />
        </Form.Item>
        <Form.Item name="delivery_start" label="Delivery Start">
          <DatePicker showTime />
        </Form.Item>
        <Form.Item name="delivery_end" label="Delivery End">
          <DatePicker showTime />
        </Form.Item>
        <Form.Item name="requires_large_contract" label="Large Contract?" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="evaluation_method" label="Evaluation Method" rules={[{ required: true }]}>
          <Select>
            <Select.Option value="lowest_price">Lowest Price</Select.Option>
            <Select.Option value="best_value">Best Value</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="bidding_fee_amount" label="Bidding Fee (ZMW)" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="supplier_ids" label="Select Suppliers (minimum 3)" rules={[{ required: true }]}>
          <Select mode="multiple" placeholder="Choose verified suppliers">
            {verifiedSuppliers.map(s => (
              <Select.Option key={s.id} value={s.id}>{s.company_name}</Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            Create Bid
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}