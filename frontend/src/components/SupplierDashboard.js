import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, List, Row, Select, Space, Statistic, Table, Tag,
  Typography, message,
} from 'antd';
import {
  AuditOutlined, CheckCircleOutlined, ClockCircleOutlined, FileTextOutlined, ReloadOutlined,
  SafetyCertificateOutlined, ShoppingCartOutlined, UploadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';
import DigitalSignatureModal from './DigitalSignatureModal';

const { Text } = Typography;

function money(value) {
  return `ZMW ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function invoiceStatus(inv) {
  if (inv.overdue) return <Tag color="error">Overdue</Tag>;
  const colors = {
    sent: 'processing',
    partially_paid: 'gold',
    paid: 'success',
    cancelled: 'default',
  };
  return <Tag color={colors[inv.status] || 'default'}>{String(inv.status || '').replace('_', ' ')}</Tag>;
}

export default function SupplierDashboard() {
  const [invitations, setInvitations] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [docFile, setDocFile] = useState(null);
  const [docType, setDocType] = useState('pacra_certificate');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signingInvoice, setSigningInvoice] = useState(null);
  const [signingOrder, setSigningOrder] = useState(null);
  const [documentTypes, setDocumentTypes] = useState([]);

  // Required document types for Zambian suppliers
  const REQUIRED_DOCUMENTS = [
    { type: 'pacra_certificate', label: 'PACRA Certificate' },
    { type: 'zra_tpin', label: 'ZRA TPIN Certificate' },
    { type: 'zra_tax_clearance', label: 'ZRA Tax Clearance' },
    { type: 'business_license', label: 'Business License' },
    { type: 'directors_id', label: 'Directors ID Copies' },
    { type: 'bank_reference', label: 'Bank Reference Letter' }
  ];

  const fetchPortal = useCallback(async () => {
    setLoading(true);
    try {
      const [bidRes, invoiceRes, summaryRes, orderRes, profileRes, docTypesRes] = await Promise.all([
        axios.get('/api/supplier/bids'),
        axios.get('/api/invoices?type=AP').catch(() => ({ data: [] })),
        axios.get('/api/invoices/summary').catch(() => ({ data: null })),
        axios.get('/api/orders').catch(() => ({ data: [] })),
        axios.get('/api/supplier/profile').catch(() => ({ data: null })),
        axios.get('/api/supplier/document-types').catch(() => ({ data: [] })),
      ]);
      setInvitations(bidRes.data);
      setInvoices(invoiceRes.data);
      setSummary(summaryRes.data);
      setOrders(orderRes.data);
      setProfile(profileRes.data);
      setDocumentTypes(docTypesRes.data || []);
    } catch {
      message.error('Failed to load supplier workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPortal(); }, [fetchPortal]);

  const handleUploadDoc = async () => {
    if (!docFile) return message.error('Select a file');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('document_type', docType);
      formData.append('file', docFile);

      await axios.post('/api/supplier/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('Document submitted for verification');
      setDocFile(null);
      fetchPortal();
    } catch {
      message.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAccept = async (bidSupplierId, accepted) => {
    try {
      await axios.post(`/api/supplier/bids/${bidSupplierId}/respond`, { accepted });
      message.success(accepted ? 'Accepted' : 'Rejected');
      fetchPortal();
    } catch {
      message.error('Action failed');
    }
  };

  const handleUpdateOrderStatus = async (orderId, targetStatus) => {
    try {
      await axios.patch(`/api/orders/${orderId}/status`, { status: targetStatus });
      message.success(`Order status updated to ${targetStatus.replace(/_/g, ' ')}`);
      fetchPortal();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to update order status');
    }
  };

  const invoiceColumns = [
    { title: 'Invoice #', dataIndex: 'invoice_no', render: value => <Text code>{value}</Text> },
    { title: 'Due', dataIndex: 'due_date' },
    { title: 'Total', dataIndex: 'total_amount', render: value => money(value) },
    { title: 'Paid', dataIndex: 'paid_amount', render: value => money(value) },
    { title: 'Balance', render: (_, row) => money(Number(row.total_amount) - Number(row.paid_amount)) },
    { title: 'Status', render: (_, row) => invoiceStatus(row) },
    { title: 'Action', render: (_, row) => <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningInvoice(row)}>Sign</Button> },
  ];

  const orderColumns = [
    { title: 'Order', dataIndex: 'id', render: value => <Text code>{value.slice(0, 8)}</Text> },
    { title: 'Buyer', dataIndex: 'tenant_name', render: value => value || '-' },
    { title: 'Total', dataIndex: 'total_amount', render: value => money(value) },
    { title: 'Status', dataIndex: 'status', render: value => <Tag>{String(value).replaceAll('_', ' ')}</Tag> },
    {
      title: 'Escrow',
      render: (_, row) => <Tag color={row.escrow_status === 'released' ? 'success' : row.escrow_status === 'funded' ? 'processing' : 'warning'}>{row.escrow_status || 'awaiting funding'}</Tag>,
    },
    {
      title: 'Action',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningOrder(row)}>Sign Contract</Button>
          {row.status === 'pending_acceptance' && (
            <Button size="small" type="primary" onClick={() => handleUpdateOrderStatus(row.id, 'accepted')}>Accept Order</Button>
          )}
          {row.status === 'accepted' && (
            <Button size="small" type="primary" onClick={() => handleUpdateOrderStatus(row.id, 'delivery_in_progress')}>Start Delivery</Button>
          )}
          {row.status === 'delivery_in_progress' && (
            <Button size="small" type="primary" onClick={() => handleUpdateOrderStatus(row.id, 'delivered')}>Mark Delivered</Button>
          )}
        </Space>
      ),
    },
  ];

  const verificationColor = profile?.verification_status === 'verified'
    ? 'success'
    : profile?.verification_status === 'rejected'
      ? 'error'
      : 'warning';

  return (
    <div>
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.supplier})` }}>
        <div>
          <h2>Supplier Portal</h2>
          <p>Manage tender invitations, compliance documents and payment visibility from one workspace.</p>
        </div>
        <div className="page-media-actions">
          <Button icon={<ReloadOutlined />} onClick={fetchPortal} loading={loading}>Refresh</Button>
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Open Invitations" value={invitations.length} prefix={<FileTextOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Expected Receipts" value={money(summary?.ap?.open)} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Paid This Month" value={money(summary?.paidThisMonth)} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Awarded Orders" value={orders.length} prefix={<ShoppingCartOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="Verification Status" className="table-card" style={{ marginBottom: 16 }}>
            <Alert
              type={verificationColor}
              showIcon
              message={profile ? String(profile.verification_status || 'pending').replaceAll('_', ' ') : 'Profile loading'}
              description={profile?.verification_status === 'verified'
                ? 'Your supplier account is verified and eligible for bid invitations.'
                : 'Upload compliance documents so Business Admin can verify your supplier account.'}
            />
            {profile && (
              <List
                size="small"
                style={{ marginTop: 12 }}
                dataSource={[
                  ['Company', profile.company_name],
                  ['Registration', profile.registration_number || '-'],
                  ['Account', profile.email],
                ]}
                renderItem={item => <List.Item><Text strong>{item[0]}</Text><Text>{item[1]}</Text></List.Item>}
              />
            )}
          </Card>

          <Card title="Required Documents Checklist" className="table-card" style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={REQUIRED_DOCUMENTS}
              locale={{ emptyText: 'No required documents defined' }}
              renderItem={doc => {
                const uploaded = profile?.documents?.find(d => d.document_type === doc.type);
                return (
                  <List.Item
                    actions={[
                      uploaded ? 
                        <Tag color={uploaded.verification_status === 'verified' ? 'success' : 'processing'}>
                          {uploaded.verification_status === 'verified' ? 'Verified' : 'Pending Review'}
                        </Tag> :
                        <Tag color="warning">Not Uploaded</Tag>
                    ]}
                  >
                    <List.Item.Meta 
                      title={doc.label} 
                      description={uploaded ? `Uploaded: ${new Date(uploaded.upload_date).toLocaleDateString()}` : 'Required for verification'}
                    />
                  </List.Item>
                );
              }}
            />
          </Card>

          <Card title="Upload Additional Document" className="table-card" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Select value={docType} onChange={setDocType} style={{ width: 260 }}>
                {documentTypes.map(dt => (
                  <Select.Option key={dt.document_type} value={dt.document_type}>
                    {dt.display_name || dt.document_type.replace(/_/g, ' ')}
                  </Select.Option>
                ))}
              </Select>
              <input type="file" onChange={e => setDocFile(e.target.files[0])} />
              <Button icon={<UploadOutlined />} onClick={handleUploadDoc} loading={uploading}>Submit</Button>
            </Space>
          </Card>

          <Card title="All Documents" className="table-card" style={{ marginBottom: 16 }}>
            <List
              size="small"
              style={{ marginTop: 12 }}
              dataSource={profile?.documents || []}
              locale={{ emptyText: 'No compliance documents uploaded yet' }}
              renderItem={doc => (
                <List.Item>
                  <List.Item.Meta 
                    title={doc.document_type.replaceAll('_', ' ')} 
                    description={new Date(doc.upload_date).toLocaleString()} 
                  />
                  <Tag color={doc.verification_status === 'verified' ? 'success' : 
                               doc.verification_status === 'rejected' ? 'error' : 'processing'}>
                    {doc.verification_status}
                  </Tag>
                </List.Item>
              )}
            />
          </Card>

          <Card title="Open Invitations" className="table-card">
            <List
              dataSource={invitations}
              loading={loading}
              locale={{ emptyText: 'No open invitations' }}
              renderItem={item => (
                <List.Item actions={[
                  <Button type="primary" size="small" onClick={() => handleAccept(item.bid_supplier_id, true)}>Accept</Button>,
                  <Button danger size="small" onClick={() => handleAccept(item.bid_supplier_id, false)}>Reject</Button>,
                  <Link to={`/supplier/bids/${item.id}`}><Button type="link" size="small">View</Button></Link>,
                ]}>
                  <List.Item.Meta
                    title={item.title}
                    description={`Deadline: ${new Date(item.deadline).toLocaleString()}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card title="Awarded Orders & Escrow" className="table-card" style={{ marginBottom: 16 }}>
            <Table
              rowKey="id"
              loading={loading}
              dataSource={orders}
              columns={orderColumns}
              pagination={{ pageSize: 5 }}
              scroll={{ x: 820 }}
              locale={{ emptyText: <Empty description="No awarded orders yet" /> }}
            />
          </Card>
          <Card title="Payment Visibility" className="table-card">
            <Table
              rowKey="id"
              loading={loading}
              dataSource={invoices}
              columns={invoiceColumns}
              pagination={{ pageSize: 6 }}
              scroll={{ x: 720 }}
              locale={{ emptyText: <Empty description="No invoices yet" /> }}
            />
          </Card>
        </Col>
      </Row>
      <DigitalSignatureModal
        open={!!signingInvoice}
        onClose={() => setSigningInvoice(null)}
        documentType="invoice"
        documentId={signingInvoice?.id}
        documentLabel={signingInvoice ? `Invoice ${signingInvoice.invoice_no}` : ''}
      />
      <DigitalSignatureModal
        open={!!signingOrder}
        onClose={() => setSigningOrder(null)}
        documentType="order"
        documentId={signingOrder?.id}
        documentLabel={signingOrder ? `Order ${signingOrder.id.slice(0, 8)} contract with ${signingOrder.tenant_name || 'buyer'}` : ''}
      />
    </div>
  );
}
