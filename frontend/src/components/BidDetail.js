import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Tag, List, Typography, Spin, Alert, Button, message, Input, Divider } from 'antd';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const { Text } = Typography;

export default function BidDetail() {
  const { bidId } = useParams();
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

  useEffect(() => { fetchBid(); }, [bidId]);

  const handleAccept = async (bidSupplierId, accepted) => {
    setAcceptLoading(true);
    try {
      await axios.post(`/api/supplier/bids/${bidSupplierId}/respond`, { accepted });
      message.success(accepted ? 'Accepted' : 'Rejected');
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
      // In production, this would redirect to a payment gateway.
      // For MVP, we confirm the payment directly.
      await axios.post('/api/payments/confirm', { transaction_ref: ref, bid_id: bid.id });
      message.success('Bidding fee paid');
      fetchBid();
    } catch { message.error('Payment failed'); }
    finally { setPayLoading(false); }
  };

  const handleSubmitResponse = async () => {
    if (!responseSpecs.trim()) return message.error('Enter product specifications');
    setSubmittingResponse(true);
    try {
      const bidSupplierId = bid.suppliers?.find(s => s.accepted !== false)?.bid_supplier_id;
      if (!bidSupplierId) {
        message.error('No valid bid supplier entry found');
        return;
      }

      // Use FormData for file upload
      const formData = new FormData();
      formData.append('product_specifications', responseSpecs);
      formData.append('terms_conditions_accepted', termsAccepted);
      if (responseFile) {
        formData.append('file', responseFile);
      }

      await axios.post(`/api/supplier/bids/${bidSupplierId}/response`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      message.success('Response submitted');
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

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h2>{bid.title}</h2>
      <Card>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Status"><Tag color="blue">{bid.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="Description">{bid.description || 'N/A'}</Descriptions.Item>
          <Descriptions.Item label="Supplier Deadline">{new Date(bid.deadline).toLocaleString()}</Descriptions.Item>
          {bid.delivery_start && <Descriptions.Item label="Delivery Start">{new Date(bid.delivery_start).toLocaleString()}</Descriptions.Item>}
          {bid.delivery_end && <Descriptions.Item label="Delivery End">{new Date(bid.delivery_end).toLocaleString()}</Descriptions.Item>}
          <Descriptions.Item label="Evaluation Method">{bid.evaluation_method}</Descriptions.Item>
          <Descriptions.Item label="Views">{bid.views_count}</Descriptions.Item>
          <Descriptions.Item label="Bidding Fee (ZMW)">{bid.bidding_fee_amount}</Descriptions.Item>
          <Descriptions.Item label="Large Contract">{bid.requires_large_contract ? 'Yes' : 'No'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Supplier actions */}
      {isSupplier() && bid.status === 'open' && (
        <Card title="Your Actions" style={{ marginTop: 20 }}>
          {bidSupplierId ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <Text strong>Invitation Status: </Text>
                {supplierEntry.accepted == null ? 'No response' : supplierEntry.accepted ? 'Accepted' : 'Rejected'}
              </div>
              <Button type="primary" onClick={() => handleAccept(bidSupplierId, true)} loading={acceptLoading}>Accept</Button>
              <Button danger onClick={() => handleAccept(bidSupplierId, false)} loading={acceptLoading} style={{ marginLeft: 8 }}>Reject</Button>
              <div style={{ marginTop: 16 }}>
                <Button onClick={handlePayFee} loading={payLoading} type="dashed">Pay Bidding Fee ({bid.bidding_fee_amount} ZMW)</Button>
              </div>
              <Divider />
              <Text strong>Submit Response</Text>
              <div style={{ marginTop: 8 }}>
                <Input.TextArea placeholder="Product specifications..." value={responseSpecs} onChange={e => setResponseSpecs(e.target.value)} rows={3} />
                <div style={{ margin: '8px 0' }}><input type="file" onChange={e => setResponseFile(e.target.files[0])} /></div>
                <label><input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} /> Accept Terms and Conditions</label>
                <Button type="primary" onClick={handleSubmitResponse} loading={submittingResponse} style={{ marginTop: 8, display: 'block' }}>Submit Response</Button>
              </div>
            </>
          ) : (
            <Text type="secondary">You are not directly invited to this bid.</Text>
          )}
        </Card>
      )}

      <Card title="Invited Suppliers" style={{ marginTop: 20 }}>
        {bid.suppliers && bid.suppliers.length > 0 ? (
          <List dataSource={bid.suppliers} renderItem={item => (
            <List.Item>
              <List.Item.Meta
                title={item.company_name}
                description={`Status: ${item.accepted === true ? 'Accepted' : item.accepted === false ? 'Rejected' : 'No response'}`}
              />
            </List.Item>
          )} />
        ) : <Text type="secondary">No suppliers invited yet.</Text>}
      </Card>

      <Card title="Customer Requirements" style={{ marginTop: 20 }}>
        {bid.requirements && bid.requirements.length > 0 ? (
          bid.requirements.map((req, idx) => (
            <Descriptions key={idx} column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Budget (ZMW)">{req.budget_amount != null ? req.budget_amount : 'Not specified'}</Descriptions.Item>
              <Descriptions.Item label="Expected Delivery">{req.expected_delivery_time || 'N/A'}</Descriptions.Item>
              <Descriptions.Item label="Payment Method">{req.payment_method || 'N/A'}</Descriptions.Item>
              <Descriptions.Item label="Certification Standards">{req.certification_standards || 'N/A'}</Descriptions.Item>
              {req.specifications_file_path && <Descriptions.Item label="Specifications File"><a href={req.specifications_file_path} target="_blank" rel="noreferrer">View File</a></Descriptions.Item>}
            </Descriptions>
          ))
        ) : <Text type="secondary">No customer requirements submitted yet.</Text>}
      </Card>
    </div>
  );
}