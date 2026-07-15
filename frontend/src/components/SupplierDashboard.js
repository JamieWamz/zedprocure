import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Col, Empty, List, Row, Select, Space, Statistic, Table, Tag,
  Typography, message,
} from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, FileTextOutlined, ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';

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
  const [summary, setSummary] = useState(null);
  const [docFile, setDocFile] = useState(null);
  const [docType, setDocType] = useState('tax_clearance');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPortal = useCallback(async () => {
    setLoading(true);
    try {
      const [bidRes, invoiceRes, summaryRes] = await Promise.all([
        axios.get('/api/supplier/bids'),
        axios.get('/api/invoices?type=AP').catch(() => ({ data: [] })),
        axios.get('/api/invoices/summary').catch(() => ({ data: null })),
      ]);
      setInvitations(bidRes.data);
      setInvoices(invoiceRes.data);
      setSummary(summaryRes.data);
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

  const invoiceColumns = [
    { title: 'Invoice #', dataIndex: 'invoice_no', render: value => <Text code>{value}</Text> },
    { title: 'Due', dataIndex: 'due_date' },
    { title: 'Total', dataIndex: 'total_amount', render: value => money(value) },
    { title: 'Paid', dataIndex: 'paid_amount', render: value => money(value) },
    { title: 'Balance', render: (_, row) => money(Number(row.total_amount) - Number(row.paid_amount)) },
    { title: 'Status', render: (_, row) => invoiceStatus(row) },
  ];

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
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="Compliance Documents" className="table-card" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Select value={docType} onChange={setDocType} style={{ width: 220 }}>
                <Select.Option value="tax_clearance">Tax Clearance</Select.Option>
                <Select.Option value="ppda_registration">PPDA Registration</Select.Option>
                <Select.Option value="company_certificate">Company Certificate</Select.Option>
              </Select>
              <input type="file" onChange={e => setDocFile(e.target.files[0])} />
              <Button icon={<UploadOutlined />} onClick={handleUploadDoc} loading={uploading}>Submit</Button>
            </Space>
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
    </div>
  );
}
