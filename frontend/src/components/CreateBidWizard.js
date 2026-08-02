import React, { useState, useEffect } from 'react';
import { Form, Input, DatePicker, InputNumber, Switch, Select, Button, message, Alert, Space, Upload, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, InboxOutlined, MenuOutlined, ArrowLeftOutlined, SendOutlined, SaveOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import ProgressSteps from './ProgressSteps';
import { buildProcurementRequestPrefill } from '../utils/procurementRequestPrefill';

const { Dragger } = Upload;
const { Title, Text } = Typography;

const creationSteps = [
  { title: 'Define', description: 'Set the scope, dates, and sourcing rules.' },
  { title: 'Price', description: 'Build the bill of quantities and fee settings.' },
  { title: 'Publish', description: 'Validate the bid and notify eligible suppliers.' },
  { title: 'Evaluate', description: 'Compare responses and award the order.' },
];

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
  const location = useLocation();
  const { user, activeTenantId, setActiveTenantId, tenants } = useAuth();
  const [form] = Form.useForm();
  const visibility = Form.useWatch('visibility', form);

  const [techSpecFile, setTechSpecFile] = useState(null);
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [sourceRequest, setSourceRequest] = useState(null);
  const [verifiedSuppliers, setVerifiedSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [suppliersError, setSuppliersError] = useState('');

  useEffect(() => {
    const requestData = location.state?.request;
    if (requestData) {
      const prefill = buildProcurementRequestPrefill(requestData);
      setSourceRequest(requestData);
      form.setFieldsValue(prefill);
      if (requestData.tenant_id) {
        setActiveTenantId(requestData.tenant_id);
      }
    }
  }, [location.state, form, setActiveTenantId]);

  useEffect(() => {
    if (visibility !== 'restricted' || verifiedSuppliers.length > 0) return;

    let active = true;
    setSuppliersLoading(true);
    setSuppliersError('');
    axios.get('/api/suppliers/verified')
      .then(({ data }) => {
        if (active) setVerifiedSuppliers(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        if (active) {
          setSuppliersError(error.response?.data?.error || 'Verified suppliers could not be loaded');
        }
      })
      .finally(() => {
        if (active) setSuppliersLoading(false);
      });

    return () => { active = false; };
  }, [visibility, verifiedSuppliers.length]);

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
      formData.append('supplier_ids', JSON.stringify(
        values.visibility === 'restricted' ? (values.invited_supplier_ids || []) : []
      ));
      if (values.business_category) {
        formData.append('business_category', values.business_category);
      }
      formData.append('requires_large_contract', values.requires_large_contract ? 'true' : 'false');
      formData.append('evaluation_method', values.evaluation_method || 'lowest_price');
      formData.append('bidding_fee_amount', String(values.bidding_fee_amount || 0));
      formData.append('express_match', values.express_match ? 'true' : 'false');
      formData.append('technical_specifications', values.technical_specifications || '');
      formData.append('line_items', JSON.stringify(validLineItems.map((item, idx) => ({
        ...item,
        item_description: item.item_description.trim(),
        quantity: Number(item.quantity),
        unit_price_estimate: item.unit_price_estimate ? Number(item.unit_price_estimate) : null,
        line_order: idx + 1,
      }))));
      if (sourceRequest?.id) formData.append('source_request_id', sourceRequest.id);

      if (techSpecFile) {
        formData.append('technical_specifications_file', techSpecFile);
      }

      const res = await axios.post(`/api/tenants/${tid}/bids`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const bid = res.data;

      if (!saveAsDraft) {
        await axios.put(`/api/bids/${bid.id}/publish`);
        message.success(values.visibility === 'restricted'
          ? 'Invite-only bid published and selected suppliers notified'
          : 'Bid published and suppliers notified');
      } else {
        message.success('Bid saved as draft. Publish it later from the dashboard.');
      }

      navigate('/admin/bids', {
        state: {
          completedAction: {
            title: saveAsDraft ? 'Draft saved successfully' : 'Bid published successfully',
            description: saveAsDraft
              ? 'Review the draft from the bid list, then publish it when the requirements are ready.'
              : 'Suppliers can now discover the opportunity. Monitor invitations and responses from the bid details page.',
            bidId: bid.id,
          },
        },
      });
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Creation failed';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(form.getFieldValue('line_items'));
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    form.setFieldsValue({ line_items: items });
  };
  
  return (
    <div className="workflow-page">
      <div className="workflow-page-heading">
        <div>
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/bids')} className="workflow-back-button">
            Back to all bids
          </Button>
          <Title level={2}>Create a procurement bid</Title>
          <Text type="secondary">Complete the sourcing details below. Required fields are validated before anything is published.</Text>
        </div>
      </div>
      <div className="workflow-steps-card">
        <ProgressSteps steps={creationSteps} current={0} />
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Open Marketplace Mode — Bids require a structured Bill of Quantities, Incoterms, and at least one line item before publishing."
      />
      {sourceRequest && (
        <Alert
          className="request-prefill-alert"
          type="success"
          showIcon
          closable={false}
          style={{ marginBottom: 16 }}
          message={`Prepared from customer request: ${sourceRequest.title}`}
          description="Scope, quantity, budget estimate, technical requirements and the needed-by date were transferred into this tender. Confirm the suggested supplier deadline and delivery window before publishing."
        />
      )}
      <Form
        className="workflow-form"
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          evaluation_method: 'lowest_price',
          visibility: 'global',
          line_items: [{ item_description: '', unit_of_measure: 'each', quantity: 1, unit_price_estimate: null }],
        }}
      >
        <div className="workflow-form-section workflow-form-section--flat">
          <div className="workflow-section-heading">
            <span className="workflow-section-number">1</span>
            <div><h3>Bid scope and sourcing rules</h3><p>Set the opportunity, supplier audience, deadline, and commercial controls.</p></div>
          </div>
        </div>
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

        <Form.Item name="deadline" label="Supplier response deadline *" rules={[{ required: true, message: 'Supplier response deadline is required' }]}>
          <DatePicker showTime style={{ width: '100%' }} disabledDate={date => date && date.endOf('day').isBefore(new Date())} />
        </Form.Item>

        <Form.Item
          name="delivery_start"
          label="Delivery Start"
          dependencies={['deadline']}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                const deadlineValue = getFieldValue('deadline');
                if (value && deadlineValue && !value.isAfter(deadlineValue)) {
                  return Promise.reject(new Error('Delivery must start after the supplier response deadline'));
                }
                return Promise.resolve();
              },
            }),
          ]}
        >
          <DatePicker showTime style={{ width: '100%' }} disabledDate={date => date && date.endOf('day').isBefore(new Date())} />
        </Form.Item>

        <Form.Item
          name="delivery_end"
          label="Delivery End / Customer Needed-by Date"
          dependencies={['deadline', 'delivery_start']}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value) return Promise.resolve();
                const deadlineValue = getFieldValue('deadline');
                const startValue = getFieldValue('delivery_start');
                if (deadlineValue && !value.isAfter(deadlineValue)) return Promise.reject(new Error('Delivery end must be after the response deadline'));
                if (startValue && value.isBefore(startValue)) return Promise.reject(new Error('Delivery end cannot be before delivery start'));
                return Promise.resolve();
              },
            }),
          ]}
        >
          <DatePicker showTime style={{ width: '100%' }} disabledDate={date => date && date.endOf('day').isBefore(new Date())} />
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

        {visibility === 'restricted' && (
          <Form.Item
            name="invited_supplier_ids"
            label="Invited Suppliers"
            extra="Only these verified suppliers will be able to discover, open, and respond to this bid."
            rules={[{ required: true, type: 'array', min: 1, message: 'Select at least one verified supplier' }]}
          >
            <Select
              mode="multiple"
              loading={suppliersLoading}
              placeholder={suppliersLoading ? 'Loading verified suppliers…' : 'Select verified suppliers to invite'}
              optionFilterProp="label"
              options={verifiedSuppliers.map(supplier => ({
                value: supplier.id,
                label: supplier.company_name,
              }))}
              notFoundContent={suppliersLoading ? 'Loading…' : 'No verified suppliers available'}
              status={suppliersError ? 'error' : undefined}
            />
          </Form.Item>
        )}

        {visibility === 'restricted' && suppliersError && (
          <Alert
            type="error"
            showIcon
            message={suppliersError}
            style={{ marginTop: -8, marginBottom: 16 }}
          />
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
        <Form.Item
          name="express_match"
          label="Express Match"
          valuePropName="checked"
          extra="Prioritizes this urgent bid in supplier feeds. The configured express fee is shown in the buyer checkout before payment."
        >
          <Switch checkedChildren="Priority" unCheckedChildren="Standard" />
        </Form.Item>

        <div className="workflow-form-section">
          <div className="workflow-section-heading">
            <span className="workflow-section-number">2</span>
            <div><h3>Bill of Quantities</h3><p>Define what suppliers must price.</p></div>
          </div>
          <p className="workflow-helper-text">
            Define the line items for this bid. Each item must have a description, unit of measure, and quantity.
            At least one line item is required before publishing. You can drag and drop to reorder the items.
          </p>
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="line_items">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef}>
                  <Form.List name="line_items">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...restField }, index) => (
                          <Draggable key={key} draggableId={`item-${key}`} index={index}>
                            {(provided) => (
                              <Space
                                className="boq-line-item"
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                style={{ display: 'flex', marginBottom: 8, ...provided.draggableProps.style }}
                                align="baseline"
                              >
                                <div {...provided.dragHandleProps} style={{ cursor: 'grab' }}>
                                  <MenuOutlined style={{ marginRight: 8 }} />
                                </div>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'item_description']}
                                  rules={[{ required: true, message: 'Description is required' }]}
                                  style={{ width: '300px' }}
                                >
                                  <Input placeholder="Item description" aria-label={`Line item ${index + 1} description`} />
                                </Form.Item>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'unit_of_measure']}
                                  rules={[{ required: true, message: 'UoM is required' }]}
                                   style={{ width: '150px' }}
                                >
                                  <Select placeholder="Unit of measure" aria-label={`Line item ${index + 1} unit of measure`}>
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
                                  <InputNumber min={0.0001} placeholder="Quantity" aria-label={`Line item ${index + 1} quantity`} style={{width: '100%'}} />
                                </Form.Item>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'unit_price_estimate']}
                                   style={{ width: '130px' }}
                                >
                                  <InputNumber min={0} placeholder="Est. price" aria-label={`Line item ${index + 1} estimated unit price`} style={{width: '100%'}} />
                                </Form.Item>
                                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} aria-label={`Remove line item ${index + 1}`} />
                              </Space>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        <Form.Item>
                          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                            Add Line Item
                          </Button>
                        </Form.Item>
                      </>
                    )}
                  </Form.List>
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>

        <div className="workflow-form-section">
          <div className="workflow-section-heading">
            <span className="workflow-section-number">3</span>
            <div><h3>Technical specifications</h3><p>Add standards, compliance requirements, and supporting documents.</p></div>
          </div>
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

        <div className="workflow-action-bar">
          <div>
            <Text strong>Ready to continue?</Text>
            <Text type="secondary">Publish now or keep an editable draft.</Text>
          </div>
          <Space wrap>
          <Form.Item noStyle>
            <Button size="large" onClick={() => navigate('/admin/bids')}>Cancel</Button>
          </Form.Item>
          <Form.Item noStyle>
            <Button
              htmlType="submit"
              loading={loading && saveAsDraft}
              onClick={() => setSaveAsDraft(true)}
              size="large"
              icon={<SaveOutlined />}
            >
              Save draft
            </Button>
          </Form.Item>
          <Form.Item noStyle>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading && !saveAsDraft}
              onClick={() => setSaveAsDraft(false)}
              size="large"
              icon={<SendOutlined />}
            >
              Validate & publish
            </Button>
          </Form.Item>
          </Space>
        </div>
      </Form>
    </div>
  );
}
