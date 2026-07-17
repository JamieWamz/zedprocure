import React, { useState, useEffect } from 'react';
import { Form, Input, DatePicker, InputNumber, Switch, Select, Button, message, Alert } from 'antd';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function CreateBidWizard() {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const visibility = Form.useWatch('visibility', form);

  useEffect(() => {
    if (user?.tenantId) {
      setTenantId(user.tenantId);
    } else if (user?.role === 'business_admin') {
      axios.get('/api/tenant/list').then(res => setTenants(res.data)).catch(() => {});
    }
  }, [user]);

  // Pre-fill draft status info
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  const onFinish = async (values) => {
    const tid = values.tenant_id || tenantId;
    if (!tid) {
      message.error('Please select a tenant');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...values,
        deadline: values.deadline.toISOString(),
        delivery_start: values.delivery_start?.toISOString(),
        delivery_end: values.delivery_end?.toISOString(),
        visibility: values.visibility || 'global',
        business_category: values.business_category || null,
      };

      const res = await axios.post(`/api/tenants/${tid}/bids`, payload);
      const bid = res.data;

      if (!saveAsDraft) {
        // Publish immediately
        await axios.put(`/api/bids/${bid.id}/publish`);
        message.success('Bid published and suppliers notified');
      } else {
        message.success('Bid saved as draft. Publish it later from the dashboard.');
      }

      navigate('/admin/bids');
    } catch (err) {
      message.error(err.response?.data?.error || 'Creation failed');
    } finally {
      setLoading(false);
    }
  };

  const businessCategories = [
    'Construction & Infrastructure',
    'ICT & Software',
    'Healthcare & Medical',
    'Agriculture & Food',
    'Transport & Logistics',
    'Education & Training',
    'Professional Services',
    'Manufacturing',
    'Energy & Utilities',
    'Other',
  ];

  return (
    <div style={{ maxWidth: 800, margin: 'auto' }}>
      <h2>Create New Bid</h2>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Open Marketplace Mode — Bids are visible to all verified suppliers. You can save as draft first, then publish."
      />
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          evaluation_method: 'lowest_price',
          visibility: 'global',
        }}
      >
        {!tenantId && tenants.length > 0 && (
          <Form.Item name="tenant_id" label="Tenant (Organization)" rules={[{ required: true }]}>
            <Select placeholder="Select a tenant" onChange={val => setTenantId(val)}>
              {tenants.map(t => (
                <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}

        <Form.Item name="title" label="Bid Title" rules={[{ required: true }]}>
          <Input placeholder="e.g. Supply of Medical Equipment" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={4} placeholder="Describe the bid scope, requirements, and evaluation criteria" />
        </Form.Item>

        <Form.Item name="deadline" label="Bid Deadline" rules={[{ required: true }]}>
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="delivery_start" label="Delivery Start">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="delivery_end" label="Delivery End">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="visibility" label="Visibility" rules={[{ required: true }]}>
          <Select>
            <Select.Option value="global">Global (All verified suppliers can see and bid)</Select.Option>
            <Select.Option value="restricted">Restricted (Invite-only)</Select.Option>
          </Select>
        </Form.Item>

        {visibility === 'global' && (
          <Form.Item name="business_category" label="Business Category">
            <Select placeholder="Filter by category (optional)">
              {businessCategories.map(cat => (
                <Select.Option key={cat} value={cat}>{cat}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}

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

        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading && !saveAsDraft}
              onClick={() => setSaveAsDraft(false)}
            >
              Publish Now
            </Button>
          </Form.Item>
          <Form.Item>
            <Button
              htmlType="submit"
              loading={loading && saveAsDraft}
              onClick={() => setSaveAsDraft(true)}
            >
              Save as Draft
            </Button>
          </Form.Item>
        </div>
      </Form>
    </div>
  );
}
