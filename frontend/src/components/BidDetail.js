import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Tag, List, Typography, Spin, Alert, Button, message, Input, Divider, Space, Steps, Table, InputNumber, Modal, Select, Form } from 'antd';
import { useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CheckCircleOutlined, CloseCircleOutlined, DollarOutlined, FileTextOutlined, ShoppingCartOutlined, PlusOutlined, InfoCircleOutlined, EditOutlined } from '@ant-design/icons';

import axios from 'axios';

const { Text, Title } = Typography;

export default function BidDetail() {
  // Extract bidId from either route params (for /supplier/bids/:bidId) or from pathname (for /admin/bids/:bidId)
  const params = useParams();
  const location = useLocation();
  const bidId = params.bidId;

  const { user } = useAuth();
  const [bid, setBid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Supplier actions
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [expressInterestLoading, setExpressInterestLoading] = useState(false);
  const [responseSpecs, setResponseSpecs] = useState('');
  const [responseFile, setResponseFile] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [lineItemPrices, setLineItemPrices] = useState({});

  // Invite suppliers state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [selectedSuppliersToInvite, setSelectedSuppliersToInvite] = useState([]);
  const [invitingLoading, setInvitingLoading] = useState(false);

  // Edit customer requirements state & handlers
  const [editReqModalOpen, setEditReqModalOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState(null);
  const [editReqLoading, setEditReqLoading] = useState(false);
  const [editForm] = Form.useForm();

  const isAdmin = () => user?.role === 'business_admin' || user?.role === 'system_admin' || user?.role === 'tenant_admin';

  const handleEditRequirementClick = (req) => {
    setSelectedReq(req);
    editForm.setFieldsValue({
      budget_amount: req.budget_amount,
      expected_delivery_time: req.expected_delivery_time,
      payment_method: req.payment_method,
      certification_standards: req.certification_standards,
      specifications_file_path: req.specifications_file_path,
    });
    setEditReqModalOpen(true);
  };

  const handleEditRequirementSubmit = async (values) => {
    if (!selectedReq) return;
    setEditReqLoading(true);
    try {
      await axios.put(`/api/bids/${bidId}/requirements/${selectedReq.id}`, {
        budget_amount: values.budget_amount,
        expected_delivery_time: values.expected_delivery_time,
        payment_method: values.payment_method,
        certification_standards: values.certification_standards,
        specifications_file_path: values.specifications_file_path,
      });
      message.success('Requirements updated successfully!');
      setEditReqModalOpen(false);
      fetchBid();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to update requirements');
    } finally {
      setEditReqLoading(false);
    }
  };

  const handleSendInvitations = async () => {
    if (!selectedSuppliersToInvite || selectedSuppliersToInvite.length === 0) {
      return message.error('Please select at least one supplier to invite');
    }
    setInvitingLoading(true);
    try {
      await axios.post(`/api/bids/${bidId}/invite`, {
        supplier_ids: selectedSuppliersToInvite,
      });
      message.success('Invitations sent successfully!');
      setInviteModalOpen(false);
      setSelectedSuppliersToInvite([]);
      fetchBid();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to send invitations');
    } finally {
      setInvitingLoading(false);
    }
  };

  const isSupplier = () => user?.role === 'supplier_user';

  const fetchBid = async () => {
    try {
      const { data } = await axios.get(`/api/bids/${bidId}`);
      setBid(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load bid');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (bidId) fetchBid(); }, [bidId]);

  const handleAccept = async (bidSupplierId, accepted) => {
    setAcceptLoading(true);
    try {
      await axios.post(`/api/supplier/bids/${bidSupplierId}/respond`, { accepted });
      message.success(accepted ? 'Invitation Accepted' : 'Invitation Declined');
      fetchBid();
    } catch { message.error('Action failed'); }
    finally { setAcceptLoading(false); }
  };

  const handleExpressInterest = async () => {
    setExpressInterestLoading(true);
    try {
      await axios.post(`/api/supplier/bids/${bidId}/express-interest`);
      message.success('Interest expressed! You can now submit your response.');
      fetchBid();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to express interest');
    } finally {
      setExpressInterestLoading(false);
    }
  };

  const handlePayFee = async () => {
    if (!bid) return;
    setPayLoading(true);
    try {
      const initRes = await axios.post('/api/payments/bidding-fee', {
        bid_id: bid.id,
        payment_method: 'mobile_money',
      });
      const ref = initRes.data.transaction_ref;
      await axios.post('/api/payments/confirm', { transaction_ref: ref, bid_id: bid.id });
      message.success('Bidding fee paid successfully');
      fetchBid();
    } catch { message.error('Payment failed'); }
    finally { setPayLoading(false); }
  };

  // Initialize line item prices from BoQ data
  useEffect(() => {
    if (bid?.line_items) {
      const initial = {};
      bid.line_items.forEach(item => {
        initial[item.id] = '';
      });
      setLineItemPrices(initial);
    }
  }, [bid?.line_items]);

  const updateLineItemPrice = (lineItemId, value) => {
    setLineItemPrices(prev => ({ ...prev, [lineItemId]: value }));
  };

  const calculateResponseTotal = () => {
    if (!bid?.line_items) return 0;
    return bid.line_items.reduce((sum, item) => {
      const price = Number(lineItemPrices[item.id]) || 0;
      return sum + (price * Number(item.quantity));
    }, 0);
  };

  const handleSubmitResponse = async () => {
    if (!responseSpecs.trim()) return message.error('Please enter product specifications');
    
    // Validate line-item prices
    if (bid?.line_items?.length > 0) {
      const missingPrices = bid.line_items.filter(item => !lineItemPrices[item.id] || Number(lineItemPrices[item.id]) <= 0);
      if (missingPrices.length > 0) {
        return message.error(`Please provide unit prices for all line items. Missing: ${missingPrices.map(i => i.item_description).join(', ')}`);
      }
    }

    setSubmittingResponse(true);
    try {
      const bidSupplierId = bid.suppliers?.find(s => s.accepted !== false)?.bid_supplier_id;
      if (!bidSupplierId) {
        message.error('No valid bid supplier entry found');
        return;
      }

      // Build line_item_prices array
      const pricesArray = (bid.line_items || []).map(item => ({
        bid_line_item_id: item.id,
        unit_price: Number(lineItemPrices[item.id]),
        notes: '',
      }));

      const formData = new FormData();
      formData.append('product_specifications', responseSpecs);
      formData.append('terms_conditions_accepted', termsAccepted);
      formData.append('line_item_prices', JSON.stringify(pricesArray));
      if (responseFile) formData.append('file', responseFile);

      await axios.post(`/api/supplier/bids/${bidSupplierId}/response`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      message.success('Response submitted successfully with pricing');
      setResponseSpecs('');
      setTermsAccepted(false);
      setResponseFile(null);
      setLineItemPrices({});
      fetchBid();
    } catch (e) {
      const errorMsg = e.response?.data?.error || 'Failed to submit response';
      message.error(errorMsg);
    }
    finally { setSubmittingResponse(false); }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />;
  if (error) return <Alert type="error" message={error} showIcon />;
  if (!bid) return <Alert type="warning" message="Bid not found" showIcon />;

  const supplierEntry = isSupplier() && bid.suppliers ? bid.suppliers.find(s => s.company_name) : null;
  const bidSupplierId = supplierEntry?.bid_supplier_id;

  const statusColor = { draft: 'default', open: 'blue', evaluation: 'orange', awarded: 'green', closed: 'red' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>{bid.title}</Title>
        <Tag color={statusColor[bid.status] || 'default'} style={{ fontSize: 14, padding: '2px 12px' }}>{bid.status.toUpperCase()}</Tag>
      </Space>

      {/* Bid Details */}
      <Card title="Bid Information" style={{ marginBottom: 20 }}>
        {/* Bid Progress Steps */}
        <div style={{ marginBottom: 24, padding: '0 8px' }}>
          <Steps
            current={['draft', 'open', 'evaluation', 'awarded', 'closed'].indexOf(bid.status)}
            items={[
              { title: 'Draft', description: 'Initial creation' },
              { title: 'Open', description: 'Accepting supplier bids' },
              { title: 'Evaluation', description: 'Reviewing submissions' },
              { title: 'Awarded', description: 'Supplier has been selected' },
              { title: 'Closed', description: 'Procurement complete' },
            ]}
          />
        </div>

        <Descriptions column={{ xs: 1, sm: 1, md: 2 }} bordered size="small">
          <Descriptions.Item label="Description" span={2}>{bid.description || 'No description provided'}</Descriptions.Item>
          <Descriptions.Item label="Supplier Deadline">{new Date(bid.deadline).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Evaluation Method">{bid.evaluation_method === 'lowest_price' ? 'Lowest Price' : 'Best Value'}</Descriptions.Item>
          {bid.delivery_start && <Descriptions.Item label="Delivery Start">{new Date(bid.delivery_start).toLocaleString()}</Descriptions.Item>}
          {bid.delivery_end && <Descriptions.Item label="Delivery End">{new Date(bid.delivery_end).toLocaleString()}</Descriptions.Item>}
          <Descriptions.Item label="Delivery Terms (Incoterms)"><Tag color="blue">{bid.delivery_terms || 'Not set'}</Tag></Descriptions.Item>
          <Descriptions.Item label="Bidding Fee"><Text strong>{Number(bid.bidding_fee_amount).toLocaleString()} ZMW</Text></Descriptions.Item>
          <Descriptions.Item label="Views">{bid.views_count}</Descriptions.Item>
          <Descriptions.Item label="Large Contract">{bid.requires_large_contract ? 'Yes' : 'No'}</Descriptions.Item>
          <Descriptions.Item label="Line Items"><Tag>{bid.total_line_items || 0} items</Tag></Descriptions.Item>
          <Descriptions.Item label="Created">{new Date(bid.created_at).toLocaleString()}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Bill of Quantities (BoQ) Line Items */}
      {bid.line_items && bid.line_items.length > 0 && (
        <Card title={<span><ShoppingCartOutlined /> Bill of Quantities ({bid.line_items.length} line items)</span>} style={{ marginBottom: 20 }}>
          <Table
            dataSource={bid.line_items}
            rowKey="id"
            pagination={false}
            size="small"
            bordered
            scroll={{ x: 500 }}
            columns={[
              { title: '#', width: 40, render: (_, __, idx) => idx + 1 },
              { title: 'Item Description', dataIndex: 'item_description' },
              { title: 'Unit of Measure', dataIndex: 'unit_of_measure', render: v => <Tag>{v}</Tag> },
              { title: 'Quantity', dataIndex: 'quantity', render: v => Number(v).toLocaleString() },
              {
                title: 'Est. Unit Price (ZMW)',
                dataIndex: 'unit_price_estimate',
                render: v => v != null ? Number(v).toLocaleString() : '-',
              },
            ]}
          />
        </Card>
      )}

      {/* Technical Specifications */}
      {(bid.technical_specifications || bid.technical_specifications_path) && (
        <Card title="Technical Specifications" size="small" style={{ marginBottom: 20 }}>
          {bid.technical_specifications && <p>{bid.technical_specifications}</p>}
          {bid.technical_specifications_path && (
            <a href={bid.technical_specifications_path} target="_blank" rel="noreferrer">
              <FileTextOutlined /> View Technical Specification Document (PDF)
            </a>
          )}
        </Card>
      )}

      {/* Invited Suppliers */}
      <Card
        title={`Invited Suppliers (${bid.suppliers?.length || 0})`}
        extra={
          (user?.role === 'business_admin' || user?.role === 'system_admin' || user?.role === 'customer') && (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={async () => {
                setInviteModalOpen(true);
                try {
                  const { data } = await axios.get('/api/admin/suppliers/pending');
                  setAllSuppliers(data || []);
                } catch (_) {
                  // Fallback
                  setAllSuppliers([]);
                }
              }}
            >
              Invite Suppliers
            </Button>
          )
        }
        style={{ marginBottom: 20 }}
      >
        {bid.suppliers && bid.suppliers.length > 0 ? (
          <List
            dataSource={bid.suppliers}
            renderItem={item => (
              <List.Item>
                <List.Item.Meta
                  avatar={item.accepted === true ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} /> : 
                         item.accepted === false ? <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 20 }} /> : 
                         <FileTextOutlined style={{ color: '#faad14', fontSize: 20 }} />}
                  title={item.company_name}
                  description={
                    item.accepted === true ? 'Accepted' : 
                    item.accepted === false ? 'Declined' : 
                    'Awaiting Response'
                  }
                />
              </List.Item>
            )}
          />
        ) : <Text type="secondary">No suppliers invited yet. Click "Invite Suppliers" above to invite companies to bid.</Text>}
      </Card>

      {/* Customer Requirements */}
      <Card title="Customer Requirements" style={{ marginBottom: 20 }}>
        {bid.requirements && bid.requirements.length > 0 ? (
          bid.requirements.map((req, idx) => (
            <div key={idx} style={{ marginBottom: 16 }}>
              {isAdmin() && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<EditOutlined />}
                    onClick={() => handleEditRequirementClick(req)}
                  >
                    Edit Requirements
                  </Button>
                </div>
              )}
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="Budget (ZMW)">{req.budget_amount != null ? Number(req.budget_amount).toLocaleString() : 'Not specified'}</Descriptions.Item>
                <Descriptions.Item label="Expected Delivery">{req.expected_delivery_time || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Payment Method">{req.payment_method || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Certification Standards">{req.certification_standards || 'N/A'}</Descriptions.Item>
                {req.specifications_file_path && <Descriptions.Item label="Specifications File" span={2}><a href={req.specifications_file_path} target="_blank" rel="noreferrer">View File</a></Descriptions.Item>}
              </Descriptions>
            </div>
          ))
        ) : <Text type="secondary">No customer requirements submitted yet.</Text>}
      </Card>

      {/* Supplier Actions */}
      {isSupplier() && bid.status === 'open' && (
        <Card title="Your Response" style={{ marginBottom: 20 }}>
          {bidSupplierId ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <Text strong>Invitation Status: </Text>
                <Tag color={supplierEntry.accepted === null ? 'gold' : supplierEntry.accepted ? 'green' : 'red'}>
                  {supplierEntry.accepted == null ? 'Pending' : supplierEntry.accepted ? 'Accepted' : 'Declined'}
                </Tag>
              </div>
              
              <Space style={{ marginBottom: 16 }}>
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => handleAccept(bidSupplierId, true)} loading={acceptLoading}>
                  Accept Invitation
                </Button>
                <Button danger icon={<CloseCircleOutlined />} onClick={() => handleAccept(bidSupplierId, false)} loading={acceptLoading}>
                  Decline
                </Button>
              </Space>

              <Divider />
              
              <Space style={{ marginBottom: 16 }}>
                <Button icon={<DollarOutlined />} onClick={handlePayFee} loading={payLoading}>
                  Pay Bidding Fee ({Number(bid.bidding_fee_amount).toLocaleString()} ZMW)
                </Button>
              </Space>

              <Divider />

              {/* Line Item Pricing Table (Supplier) */}
              {bid.line_items && bid.line_items.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <Title level={5}>Your Pricing — Bill of Quantities</Title>
                  <Text type="secondary">Enter your unit price for each line item. Total will be calculated automatically.</Text>
                  <Table
                    dataSource={bid.line_items}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    bordered
                    style={{ marginTop: 8 }}
                    columns={[
                      { title: '#', width: 40, render: (_, __, idx) => idx + 1 },
                      { title: 'Item Description', dataIndex: 'item_description' },
                      { title: 'UoM', dataIndex: 'unit_of_measure', width: 80, render: v => <Tag>{v}</Tag> },
                      { title: 'Qty', dataIndex: 'quantity', width: 80, render: v => Number(v).toLocaleString() },
                      {
                        title: 'Your Unit Price (ZMW) *',
                        width: 180,
                        render: (_, record) => (
                          <InputNumber
                            min={0}
                            step={0.01}
                            value={lineItemPrices[record.id]}
                            onChange={val => updateLineItemPrice(record.id, val)}
                            style={{ width: '100%' }}
                            placeholder="0.00"
                          />
                        ),
                      },
                      {
                        title: 'Line Total (ZMW)',
                        width: 150,
                        render: (_, record) => {
                          const unitPrice = Number(lineItemPrices[record.id]) || 0;
                          const total = unitPrice * Number(record.quantity);
                          return <Text strong>{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>;
                        },
                      },
                    ]}
                  />
                  <div style={{ textAlign: 'right', marginTop: 8, padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                    <Text strong style={{ fontSize: 16 }}>
                      Total Bid Value: ZMW {calculateResponseTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                  </div>
                </div>
              )}

              <Divider />
              <Title level={5}>Submit Technical Response</Title>
              <div>
                <Input.TextArea 
                  placeholder="Describe your product specifications, delivery timeline, and compliance details..." 
                  value={responseSpecs} 
                  onChange={e => setResponseSpecs(e.target.value)} 
                  rows={4} 
                  style={{ marginBottom: 12 }}
                />
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary">Attach supporting documents (optional):</Text>
                  <input type="file" onChange={e => setResponseFile(e.target.files[0])} style={{ display: 'block', marginTop: 4 }} />
                </div>
                <label style={{ display: 'block', marginBottom: 12 }}>
                  <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} /> 
                  {' '}I accept the Terms and Conditions
                </label>
                <Button type="primary" icon={<FileTextOutlined />} onClick={handleSubmitResponse} loading={submittingResponse}>
                  Submit Response with Pricing
                </Button>
              </div>
            </>
          ) : (
            // ─── No invitation yet — show Express Interest for global bids ─────────
            bid.visibility === 'global' ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <InfoCircleOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
                <Title level={4}>This is an open global bid</Title>
                <Text type="secondary" style={{ display: 'block', marginBottom: 20, maxWidth: 480, margin: '0 auto 20px' }}>
                  You have not yet been invited to this bid. Click below to express interest — this will create an invitation
                  so you can submit your pricing and technical response.
                </Text>
                <Button 
                  type="primary" 
                  size="large" 
                  icon={<PlusOutlined />} 
                  onClick={handleExpressInterest} 
                  loading={expressInterestLoading}
                >
                  Express Interest
                </Button>
              </div>
            ) : (
              <Text type="secondary">You are not invited to this bid.</Text>
            )
          )}
        </Card>
      )}

      {/* Invite Suppliers Modal */}
      <Modal
        title={
          <Space>
            <PlusOutlined style={{ color: '#1677ff' }} />
            <span>Invite Suppliers to Bid: {bid.title}</span>
          </Space>
        }
        open={inviteModalOpen}
        onCancel={() => setInviteModalOpen(false)}
        onOk={handleSendInvitations}
        confirmLoading={invitingLoading}
        okText="Send Invitations"
      >
        <Alert
          type="info"
          showIcon
          message="Selected suppliers will receive an in-app notification and email invitation to view and bid on this opportunity."
          style={{ marginBottom: 16 }}
        />
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Select verified suppliers to invite"
          value={selectedSuppliersToInvite}
          onChange={setSelectedSuppliersToInvite}
          optionFilterProp="children"
        >
          {allSuppliers.map(s => (
            <Select.Option key={s.id} value={s.id}>
              {s.company_name} ({s.verification_status || 'Pending'})
            </Select.Option>
          ))}
        </Select>
      </Modal>

      {/* Edit Requirements Modal */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: '#1677ff' }} />
            <span>Edit Customer Requirements</span>
          </Space>
        }
        open={editReqModalOpen}
        onCancel={() => setEditReqModalOpen(false)}
        footer={[
          <Button key="back" onClick={() => setEditReqModalOpen(false)}>
            Cancel
          </Button>,
          <Button key="submit" type="primary" loading={editReqLoading} onClick={() => editForm.submit()}>
            Save Changes
          </Button>
        ]}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditRequirementSubmit}>
          <Form.Item name="budget_amount" label="Budget Amount (ZMW)">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="e.g. 150000" />
          </Form.Item>
          
          <Form.Item name="expected_delivery_time" label="Expected Delivery Timeline">
            <Input placeholder="e.g. 14 business days" />
          </Form.Item>

          <Form.Item name="payment_method" label="Preferred Payment Method">
            <Select placeholder="Select preferred payment method">
              <Select.Option value="mtn">MTN Mobile Money (MoMo)</Select.Option>
              <Select.Option value="airtel">Airtel Money</Select.Option>
              <Select.Option value="zamtel">Zamtel Kwacha</Select.Option>
              <Select.Option value="bank_transfer">Bank Transfer (Zanaco / Stanbic / FNB)</Select.Option>
              <Select.Option value="escrow">Direct Escrow Account</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="certification_standards" label="Technical Specifications & Quality Standards">
            <Input.TextArea rows={4} placeholder="Detailed specs, quality criteria, warranty requirements, etc." />
          </Form.Item>

          <Form.Item name="specifications_file_path" label="Specifications Document URL">
            <Input placeholder="e.g. Link to PDF document" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
