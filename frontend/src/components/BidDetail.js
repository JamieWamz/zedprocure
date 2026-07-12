import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Tag, List, Typography, Spin, Alert, Button, message, Input, Divider, Space, Steps } from 'antd';
import { useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CheckCircleOutlined, CloseCircleOutlined, DollarOutlined, FileTextOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text, Title } = Typography;

export default function BidDetail() {
  // Extract bidId from either route params (for /supplier/bids/:bidId) or from pathname (for /admin/bids/:bidId)
  const params = useParams();
  const location = useLocation();
  const bidId = params.bidId || location.pathname.split('/').pop();

  const { user } = useAuth();
  const [bid, setBid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Supplier actions
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [responseSpecs, setResponseSpecs] = useState('');
  const [responseFile, setResponseFile] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submittingResponse, setSubmittingResponse] = useState(false);

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

  const handleSubmitResponse = async () => {
    if (!responseSpecs.trim()) return message.error('Please enter product specifications');
    setSubmittingResponse(true);
    try {
      const bidSupplierId = bid.suppliers?.find(s => s.accepted !== false)?.bid_supplier_id;
      if (!bidSupplierId) {
        message.error('No valid bid supplier entry found');
        return;
      }
      const formData = new FormData();
      formData.append('product_specifications', responseSpecs);
      formData.append('terms_conditions_accepted', termsAccepted);
      if (responseFile) formData.append('file', responseFile);

      await axios.post(`/api/supplier/bids/${bidSupplierId}/response`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      message.success('Response submitted successfully');
      setResponseSpecs('');
      setTermsAccepted(false);
      setResponseFile(null);
      fetchBid();
    } catch { message.error('Failed to submit response'); }
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

      {/* Bid Progress Steps */}
      <Card size="small" style={{ marginBottom: 20 }}>
        <Steps
          size="small"
          current={['draft', 'open', 'evaluation', 'awarded', 'closed'].indexOf(bid.status)}
          items={[
            { title: 'Draft' },
            { title: 'Open for Bids' },
            { title: 'Under Evaluation' },
            { title: 'Awarded' },
            { title: 'Closed' },
          ]}
        />
      </Card>

      {/* Bid Details */}
      <Card title="Bid Information" style={{ marginBottom: 20 }}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="Description" span={2}>{bid.description || 'No description provided'}</Descriptions.Item>
          <Descriptions.Item label="Supplier Deadline">{new Date(bid.deadline).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Evaluation Method">{bid.evaluation_method === 'lowest_price' ? 'Lowest Price' : 'Best Value'}</Descriptions.Item>
          {bid.delivery_start && <Descriptions.Item label="Delivery Start">{new Date(bid.delivery_start).toLocaleString()}</Descriptions.Item>}
          {bid.delivery_end && <Descriptions.Item label="Delivery End">{new Date(bid.delivery_end).toLocaleString()}</Descriptions.Item>}
          <Descriptions.Item label="Bidding Fee"><Text strong>{Number(bid.bidding_fee_amount).toLocaleString()} ZMW</Text></Descriptions.Item>
          <Descriptions.Item label="Views">{bid.views_count}</Descriptions.Item>
          <Descriptions.Item label="Large Contract">{bid.requires_large_contract ? 'Yes' : 'No'}</Descriptions.Item>
          <Descriptions.Item label="Created">{new Date(bid.created_at).toLocaleString()}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Invited Suppliers */}
      <Card title={`Invited Suppliers (${bid.suppliers?.length || 0})`} style={{ marginBottom: 20 }}>
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
        ) : <Text type="secondary">No suppliers invited yet.</Text>}
      </Card>

      {/* Customer Requirements */}
      <Card title="Customer Requirements" style={{ marginBottom: 20 }}>
        {bid.requirements && bid.requirements.length > 0 ? (
          bid.requirements.map((req, idx) => (
            <Descriptions key={idx} column={2} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Budget (ZMW)">{req.budget_amount != null ? Number(req.budget_amount).toLocaleString() : 'Not specified'}</Descriptions.Item>
              <Descriptions.Item label="Expected Delivery">{req.expected_delivery_time || 'N/A'}</Descriptions.Item>
              <Descriptions.Item label="Payment Method">{req.payment_method || 'N/A'}</Descriptions.Item>
              <Descriptions.Item label="Certification Standards">{req.certification_standards || 'N/A'}</Descriptions.Item>
              {req.specifications_file_path && <Descriptions.Item label="Specifications File" span={2}><a href={req.specifications_file_path} target="_blank" rel="noreferrer">View File</a></Descriptions.Item>}
            </Descriptions>
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
                  Submit Response
                </Button>
              </div>
            </>
          ) : (
            <Text type="secondary">You are not invited to this bid.</Text>
          )}
        </Card>
      )}
    </div>
  );
}