import React, { useState, useEffect } from 'react';
import { Form, Input, DatePicker, InputNumber, Switch, Select, Button, message, Alert, Space, Upload } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, InboxOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const { Dragger } = Upload;

const INCOTERMS = [
  { value: 'EXW', label: 'EXW – Ex Works' },
  { value: 'FCA', label: 'FCA – Free Carrier' },
  { value: 'FAS', label: 'FAS – Free Alongside Ship' },
  { value: 'FOB', label: 'FOB – Free on Board' },
  { value: 'CFR', label: 'CFR – Cost and Freight' },
  { value: 'CIF', label: 'CIF – Cost, Insurance & Freight' },
  { value: 'CPT', label: 'CPT – Carriage Paid To' },
  { value: 'CIP', label: 'CIP – Carriage & Insurance Paid To' },
  { value: 'DPU', label: 'DPU – Delivered at Place Unloaded' },
  { value: 'DAP', label: 'DAP – Delivered at Place' },
  { value: 'DDP', label: 'DDP – Delivered Duty Paid' },
];

const UNIT_OF_MEASURE = [
  { value: 'each', label: 'Each' },
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'g', label: 'Gram (g)' },
  { value: 'ton', label: 'Ton' },
  { value: 'meters', label: 'Meters' },
  { value: 'cm', label: 'Centimeters (cm)' },
  { value: 'liters', label: 'Liters' },
  { value: 'ml', label: 'Milliliters (ml)' },
  { value: 'sqm', label: 'Square Meters (sqm)' },
  { value: 'sqft', label: 'Square Feet (sqft)' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'months', label: 'Months' },
  { value: 'lump_sum', label: 'Lump Sum' },
  { value: 'boxes', label: 'Boxes' },
  { value: 'pairs', label: 'Pairs' },
  { value: 'sets', label: 'Sets' },
];

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

export default function CreateBidWizard() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, activeTenantId, setActiveTenantId, tenants } = useAuth();
  const [form] = Form.useForm();
  const visibility = Form.useWatch('visibility', form);

  const [techSpecFile, setTechSpecFile] = useState(null);
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  const onFinish = async (values) => {
    const tid = values.tenant_id || activeTenantId;
    if (!tid) {
      message.error('Please select a Workspace/Organization before creating a bid');
      return;
    }

    const validLineItems = (values.line_items || []).filter(item => item && item.item_description && item.item_description.trim());
    if (validLineItems.length === 0) {
      message.error('At least one line item with a description is required in the Bill of Quantities');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('title', values.title);
      formData.append('description', values.description || '');
      formData.append('deadline', values.deadline.toISOString());
      formData.append('delivery_terms', values.delivery_terms);
      formData.append('delivery_start', values.delivery_start?.toISOString() || '');
      formData.append('delivery_end', values.delivery_end?.toISOString() || '');
      formData.append('visibility', values.visibility || 'global');
      formData.append('business_category', values.business_category || '');
      formData.append('requires_large_contract', values.requires_large_contract ? 'true' : 'false');
      formData.append('evaluation_method', values.evaluation_method || 'lowest_price');
      formData.append('bidding_fee_amount', String(values.bidding_fee_amount || 0));
      formData.append('technical_specifications', values.technical_specifications || '');
      formData.append('line_items', JSON.stringify(validLineItems.map((item, idx) => ({
        ...item,
        item_description: item.item_description.trim(),
        quantity: Number(item.quantity),
        unit_price_estimate: item.unit_price_estimate ? Number(item.unit_price_estimate) : null,
        line_order: idx + 1,
      }))));

      if (techSpecFile) {
        formData.append('technical_specifications_file', techSpecFile);
      }

      const res = await axios.post(`/api/tenants/${tid}/bids`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const bid = res.data;

      if (!saveAsDraft) {
        await axios.put(`/api/bids/${bid.id}/publish`);
        message.success('Bid published and suppliers notified');
      } else {
        message.success('Bid saved as draft. Publish it later from the dashboard.');
      }

      navigate('/admin/bids');
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Creation failed';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: 'auto' }}>
      <h2>Create New Bid — Bill of Quantities</h2>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Open Marketplace Mode — Bids require a structured Bill of Quantities, Incoterms, and at least one line item before publishing."
      />
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          evaluation_method: 'lowest_price',
          visibility: 'global',
          line_items: [{ item_description: '', unit_of_measure: 'each', quantity: 1, unit_price_estimate: null }],
        }}
      >
        {!activeTenantId && tenants.length > 0 && (
          <Form.Item name="tenant_id" label="Workspace/Organization" rules={[{ required: true }]}>
            <Select placeholder="Select a Workspace/Organization" onChange={val => setActiveTenantId(val)}>
              {tenants.map(t => (
                <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}

        <Form.Item name="title" label="Bid Title" rules={[{ required: true, message: 'Bid title is required' }]}>
          <Input placeholder="e.g. Supply of Medical Equipment to Lusaka Teaching Hospital" />
        </Form.Item>

        <Form.Item name="description" label="Description / Scope of Work">
          <Input.TextArea rows={4} placeholder="Describe the bid scope, deliverables, and evaluation criteria" />
        </Form.Item>

        <Form.Item name="delivery_terms" label="Delivery Terms (Incoterms) *"
          rules={[{ required: true, message: 'Incoterms delivery terms are required' }]}>
          <Select placeholder="Select Incoterms delivery terms">
            {INCOTERMS.map(inc => (
              <Select.Option key={inc.value} value={inc.value}>{inc.label}</Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="deadline" label="Bid Deadline *" rules={[{ required: true, message: 'Bid deadline is required' }]}>
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

        <div style={{ marginBottom: 16 }}>
          <h3>Bill of Quantities (BoQ) — Line Items</h3>
          <p style={{ color: '#666', fontSize: 13 }}>
            Define the line items for this bid. Each item must have a description, unit of measure, and quantity.
            At least one line item is required before publishing.
          </p>
          <Form.List name="line_items">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'item_description']}
                      rules={[{ required: true, message: 'Description is required' }]}
                      style={{ width: '300px' }}
                    >
                      <Input placeholder="Item Description" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'unit_of_measure']}
                      rules={[{ required: true, message: 'UoM is required' }]}
                       style={{ width: '150px' }}
                    >
                      <Select placeholder="Unit of Measure">
                        {UNIT_OF_MEASURE.map(uom => (
                          <Select.Option key={uom.value} value={uom.value}>{uom.label}</Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'quantity']}
                      rules={[{ required: true, message: 'Quantity is required' }]}
                       style={{ width: '100px' }}
                    >
                      <InputNumber min={0.0001} placeholder="Quantity" style={{width: '100%'}} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'unit_price_estimate']}
                       style={{ width: '130px' }}
                    >
                      <InputNumber min={0} placeholder="Est. Price" style={{width: '100%'}} />
                    </Form.Item>
                    <DeleteOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    Add Line Item
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3>Technical Specifications</h3>
          <Form.Item name="technical_specifications" label="Technical Specifications (Text)">
            <Input.TextArea rows={4} placeholder="Enter detailed technical specifications, standards, and compliance requirements" />
          </Form.Item>
          <Form.Item label="Technical Specifications (PDF Upload)">
            <Dragger
              name="technical_specifications_file"
              accept=".pdf"
              maxCount={1}
              beforeUpload={(file) => {
                if (file.type !== 'application/pdf') {
                  message.error('Technical specifications must be a PDF file');
                  return Upload.LIST_IGNORE;
                }
                if (file.size > 20 * 1024 * 1024) {
                  message.error('File size must be less than 20MB');
                  return Upload.LIST_IGNORE;
                }
                setTechSpecFile(file);
                return false; // Prevent auto-upload
              }}
              onRemove={() => setTechSpecFile(null)}
              fileList={techSpecFile ? [{ uid: '-1', name: techSpecFile.name, status: 'done' }] : []}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">Click or drag a PDF file here</p>
              <p className="ant-upload-hint">Upload detailed technical specifications (PDF, max 20MB)</p>
            </Dragger>
          </Form.Item>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading && !saveAsDraft}
              onClick={() => setSaveAsDraft(false)}
              size="large"
            >
              Publish Now
            </Button>
          </Form.Item>
          <Form.Item>
            <Button
              htmlType="submit"
              loading={loading && saveAsDraft}
              onClick={() => setSaveAsDraft(true)}
              size="large"
            >
              Save as Draft
            </Button>
          </Form.Item>
        </div>
      </Form>
    </div>
  );
}