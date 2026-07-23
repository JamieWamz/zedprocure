import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Table, Tag, Spin, Alert, Button, Tabs, Badge, List,
  Typography, Empty, Popover, Statistic, message as msg, Modal, Form,
  Upload, Space, Divider, Progress, Tooltip,
} from 'antd';
import {
  BellOutlined, FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined,
  SafetyCertificateOutlined, TrophyOutlined, UploadOutlined, InboxOutlined,
  AuditOutlined, ShoppingCartOutlined, ReloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';
import { cdnImages } from '../cdnAssets';
import DigitalSignatureModal from './DigitalSignatureModal';
import ProgressSteps from './ProgressSteps';

const { Text, Title } = Typography;

// Mandatory documents for Zambian suppliers
const MANDATORY_DOCS = [
  { type: 'pacra_certificate',   label: 'PACRA Certificate',      desc: 'Certificate of Incorporation from PACRA' },
  { type: 'zra_tpin',            label: 'ZRA TPIN Certificate',   desc: 'Taxpayer Identification Number from ZRA' },
  { type: 'zra_tax_clearance',   label: 'ZRA Tax Clearance',      desc: 'Tax clearance certificate from ZRA' },
  { type: 'business_license',    label: 'Business License',       desc: 'Local municipal trading license' },
];

// Optional documents (recommended but not required for full compliance)
const OPTIONAL_DOCS = [
  { type: 'directors_id',        label: "Directors' ID Copies",   desc: 'ID copies for all company directors' },
  { type: 'bank_reference',      label: 'Bank Reference Letter',  desc: 'Reference letter from your company bank' },
];

const REQUIRED_DOCS = [...MANDATORY_DOCS, ...OPTIONAL_DOCS];

const verificationSteps = [
  {
    title: 'Upload Documents',
    description: 'Upload all mandatory documents.',
  },
  {
    title: 'Admin Verification',
    description: 'Awaiting review from the admin.',
  },
  {
    title: 'Verified',
    description: 'Your account is verified.',
  },
];

function money(v) {
  return `ZMW ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SupplierDashboard() {
  const [bids, setBids] = useState([]);
  const [orders, setOrders] = useState([]);
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  // Verification modal
  const [verifModalOpen, setVerifModalOpen] = useState(false);
  const [uploading, setUploading] = useState({});

  // Order signing
  const [signingOrder, setSigningOrder] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  const fetchData = useCallback(async () => {
    try {
      const [bidsRes, statusRes, notifRes, countRes] = await Promise.all([
        axios.get('/api/supplier/bids'),
        axios.get('/api/supplier/verification/status').catch(() => null),
        axios.get('/api/notifications').catch(() => ({ data: [] })),
        axios.get('/api/notifications/unread-count').catch(() => ({ data: { count: 0 } })),
      ]);
      setBids(bidsRes.data);
      setVerificationStatus(statusRes?.data || null);
      setNotifications(notifRes.data);
      setUnreadCount(countRes.data.count);
    } catch (e) {
      console.error('Failed to load supplier dashboard:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const { data } = await axios.get('/api/orders');
      setOrders(data);
    } catch (e) {
      console.error('Failed to load orders:', e);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchOrders();

    const interval = setInterval(async () => {
      try {
        const [notifRes, countRes] = await Promise.all([
          axios.get('/api/notifications').catch(() => ({ data: [] })),
          axios.get('/api/notifications/unread-count').catch(() => ({ data: { count: 0 } })),
        ]);
        setNotifications(notifRes.data);
        setUnreadCount(countRes.data.count);
      } catch (_) {}
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData, fetchOrders]);

  // Open verification modal if navigating to /supplier/verification
  useEffect(() => {
    if (location.pathname === '/supplier/verification') {
      setVerifModalOpen(true);
    }
  }, [location.pathname]);

  const markAsRead = async (id) => {
    try {
      await axios.put(`/api/notifications/${id}/read`);
      const [notifRes, countRes] = await Promise.all([
        axios.get('/api/notifications'),
        axios.get('/api/notifications/unread-count'),
      ]);
      setNotifications(notifRes.data);
      setUnreadCount(countRes.data.count);
    } catch (_) {}
  };

  const handleUploadDocument = async (docType, file) => {
    setUploading(prev => ({ ...prev, [docType]: true }));
    try {
      const formData = new FormData();
      formData.append('files', file);
      formData.append('document_types', docType);
      await axios.post('/api/supplier/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      msg.success(`${docType.replace(/_/g, ' ')} uploaded successfully`);
      // Refresh verification status
      const statusRes = await axios.get('/api/supplier/verification/status').catch(() => null);
      setVerificationStatus(statusRes?.data || null);
    } catch (e) {
      msg.error(e.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(prev => ({ ...prev, [docType]: false }));
    }
    return false; // prevent default upload behavior
  };

  const handleUpdateOrderStatus = async (orderId, targetStatus) => {
    try {
      await axios.patch(`/api/orders/${orderId}/status`, { status: targetStatus });
      msg.success(`Order updated to ${targetStatus.replace(/_/g, ' ')}`);
      fetchOrders();
    } catch (e) {
      msg.error(e.response?.data?.error || 'Failed to update order status');
    }
  };

  const notificationContent = (
    <div style={{ width: 'min(360px, 92vw)', maxHeight: 400, overflowY: 'auto' }}>
      {notifications.length === 0 ? (
        <Empty description="No notifications" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={notifications.slice(0, 20)}
          renderItem={(item) => (
            <List.Item
              style={{ background: item.is_read ? 'transparent' : '#f0f5ff', cursor: 'pointer' }}
              onClick={() => { markAsRead(item.id); if (item.link) navigate(item.link); setNotifOpen(false); }}
            >
              <List.Item.Meta
                title={<Text strong={!item.is_read} style={{ fontSize: 13 }}>{item.title}</Text>}
                description={<Text style={{ fontSize: 11, color: '#999' }}>{item.message?.substring(0, 80)}</Text>}
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;

  const isVerified = verificationStatus?.verification_status === 'verified';

  const verifiedDocTypes = new Set(
    (verificationStatus?.documents || [])
      .filter(d => d.verification_status === 'verified')
      .map(d => d.type || d.document_type)
  );
  const uploadedDocTypes = new Set(
    (verificationStatus?.documents || [])
      .map(d => d.type || d.document_type)
  );
  const verifiedCount = REQUIRED_DOCS.filter(d => verifiedDocTypes.has(d.type)).length;
  const mandatoryDocsUploaded = MANDATORY_DOCS.every(d => uploadedDocTypes.has(d.type));

  let currentStep = 0;
  if (isVerified) {
    currentStep = 2;
  } else if (mandatoryDocsUploaded) {
    currentStep = 1;
  }

  const bidColumns = [
    { title: 'Bid Title', dataIndex: 'title', key: 'title' },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: 'Deadline', dataIndex: 'deadline', key: 'deadline',
      render: (v) => new Date(v).toLocaleString(),
    },
    {
      title: 'Visibility', dataIndex: 'visibility', key: 'visibility',
      render: (v) => <Tag color={v === 'global' ? 'blue' : 'default'}>{v || 'restricted'}</Tag>,
    },
    {
      title: 'Status', key: 'status',
      render: (_, row) => row.accepted === true
        ? <Tag color="success">Accepted</Tag>
        : row.accepted === false
          ? <Tag color="error">Declined</Tag>
          : <Tag color="processing">Open</Tag>,
    },
    {
      title: 'Action', key: 'action',
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => navigate(`/supplier/bids/${row.id}`)}>
          {row.bid_supplier_id ? 'View / Respond' : 'View Details'}
        </Button>
      ),
    },
  ];

function getOrderProgress(status) {
  switch (status) {
    case 'pending_acceptance': return { percent: 15, status: 'active', label: 'Pending Acceptance', color: '#faad14' };
    case 'accepted': return { percent: 40, status: 'active', label: 'Accepted — Ready for Delivery', color: '#1677ff' };
    case 'delivery_in_progress': return { percent: 70, status: 'active', label: 'Delivery in Progress', color: '#13c2c2' };
    case 'delivered': return { percent: 88, status: 'active', label: 'Delivered — Awaiting Inspection', color: '#722ed1' };
    case 'completed': return { percent: 100, status: 'success', label: 'Completed & Funds Released', color: '#52c41a' };
    case 'disputed': return { percent: 50, status: 'exception', label: 'Order Disputed', color: '#ff4d4f' };
    default: return { percent: 10, status: 'active', label: 'Initiated', color: '#d9d9d9' };
  }
}

  const orderColumns = [
    { title: 'Order', dataIndex: 'id', render: v => <Text code>{v.slice(0, 8)}</Text> },
    { title: 'Tenant', dataIndex: 'tenant_name', render: v => v || '-' },
    { title: 'Total', dataIndex: 'total_amount', render: v => money(v) },
    {
      title: 'Fulfillment Stage',
      key: 'progress',
      width: 200,
      render: (_, row) => {
        const prog = getOrderProgress(row.status);
        return (
          <Tooltip title={prog.label}>
            <div>
              <Progress percent={prog.percent} status={prog.status} strokeColor={prog.color} size="small" />
              <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{prog.label}</Text>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: 'Escrow',
      render: (_, row) => <Tag color={['funded', 'released'].includes(row.escrow_status) ? 'success' : 'warning'}>{row.escrow_status || 'not funded'}</Tag>,
    },
    {
      title: 'Signatures',
      dataIndex: 'signature_count',
      render: v => <Tag color={Number(v) > 0 ? 'success' : 'default'}>{v || 0} signed</Tag>,
    },
    {
      title: 'Actions',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningOrder(row)}>Sign</Button>
          {row.status === 'pending_acceptance' && (
            <Button size="small" type="primary" onClick={() => handleUpdateOrderStatus(row.id, 'accepted')}>Accept</Button>
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

  return (
    <div>
      {/* Page Header */}
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.supplier})` }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Supplier Dashboard</h2>
          <p>Browse open bids, manage responses, track orders, and your verification status.</p>
        </div>
        <div className="page-media-actions">
          <Popover content={notificationContent} title="Notifications" trigger="click"
            open={notifOpen} onOpenChange={setNotifOpen}>
            <Badge count={unreadCount} size="small" style={{ marginRight: 8 }}>
              <Button icon={<BellOutlined />} />
            </Badge>
          </Popover>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchData(); fetchOrders(); }}>Refresh</Button>
          <Button icon={<SafetyCertificateOutlined />} onClick={() => setVerifModalOpen(true)}>
            Verification Status
          </Button>
        </div>
      </div>

      {/* Verification banner */}
      {!isVerified && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Account not yet verified"
          description="You must be verified before submitting bids. Upload your documents and wait for admin approval."
          action={<Button size="small" onClick={() => setVerifModalOpen(true)}>Upload Documents</Button>}
        />
      )}

      {/* Stats cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={6}>
          <Card className="stat-card">
            <Statistic
              title="Open Bids Available"
              value={bids.filter(b => !b.accepted && b.visibility === 'global').length}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card className="stat-card">
            <Statistic
              title="My Invitations"
              value={bids.filter(b => b.bid_supplier_id).length}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card className="stat-card">
            <Statistic
              title="Active Orders"
              value={orders.filter(o => !['completed', 'disputed'].includes(o.status)).length}
              prefix={<ShoppingCartOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card className="stat-card">
            <Statistic
              title="Verification Status"
              value={verificationStatus?.verification_status || 'Pending'}
              prefix={<SafetyCertificateOutlined />}
              valueStyle={{ color: isVerified ? '#52c41a' : '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Main Tabs */}
      <Tabs
        defaultActiveKey="bids"
        items={[
          {
            key: 'bids',
            label: <span><TrophyOutlined /> Available Bids</span>,
            children: (
              <Card className="table-card">
                <Table
                  dataSource={bids}
                  columns={bidColumns}
                  rowKey="id"
                  pagination={{ pageSize: 10 }}
                  size="middle"
                  scroll={{ x: 700 }}
                  locale={{ emptyText: 'No open bids available at this time. Check back later for new opportunities.' }}
                />
              </Card>
            ),
          },
          {
            key: 'orders',
            label: <span><ShoppingCartOutlined /> Orders & Contracts</span>,
            children: (
              <Card className="table-card">
                <Table
                  dataSource={orders}
                  columns={orderColumns}
                  rowKey="id"
                  loading={ordersLoading}
                  pagination={{ pageSize: 10 }}
                  size="middle"
                  scroll={{ x: 900 }}
                  locale={{ emptyText: 'No orders yet. Accepted bids will appear here once awarded.' }}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* Digital Signature Modal */}
      <DigitalSignatureModal
        open={!!signingOrder}
        onClose={() => setSigningOrder(null)}
        documentType="order"
        documentId={signingOrder?.id}
        documentLabel={signingOrder ? `Order ${signingOrder.id.slice(0, 8)} – ${signingOrder.tenant_name || 'Tenant'}` : ''}
        onSigned={fetchOrders}
      />

      {/* Verification & Document Upload Modal */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: isVerified ? '#52c41a' : '#faad14' }} />
            <span>Compliance & Verification Status</span>
          </Space>
        }
        open={verifModalOpen}
        onCancel={() => {
          setVerifModalOpen(false);
          if (location.pathname === '/supplier/verification') navigate('/supplier');
        }}
        footer={[
          <Button key="close" onClick={() => {
            setVerifModalOpen(false);
            if (location.pathname === '/supplier/verification') navigate('/supplier');
          }}>Close</Button>,
        ]}
        width={720}
      >
        <div style={{ marginBottom: 24 }}>
          <ProgressSteps steps={verificationSteps} current={currentStep} />
        </div>
        {/* Overall status */}
        <Alert
          type={isVerified ? 'success' : verificationStatus?.verification_status === 'rejected' ? 'error' : 'warning'}
          showIcon
          message={
            isVerified
              ? 'Account Verified — You can participate in all open bids.'
              : verificationStatus?.verification_status === 'rejected'
              ? 'Verification Rejected — Please review the rejection reason and re-upload corrected documents.'
              : 'Pending Verification — Upload all required documents for admin review.'
          }
          description={verificationStatus?.verification_notes || undefined}
          style={{ marginBottom: 16 }}
        />

        {/* Document compliance progress */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>Compliance Progress: {verifiedCount}/{REQUIRED_DOCS.length} documents verified</Text>
          <Progress
            percent={Math.round((verifiedCount / REQUIRED_DOCS.length) * 100)}
            status={isVerified ? 'success' : 'active'}
            style={{ marginTop: 8 }}
          />
        </div>

        <Divider />

        {/* Mandatory Documents */}
        <Text strong style={{ color: '#1677ff' }}>Mandatory Documents</Text>
        <Row gutter={[12, 12]} style={{ marginTop: 8, marginBottom: 16 }}>
          {MANDATORY_DOCS.map(doc => {
            const uploaded = (verificationStatus?.documents || []).find(
              d => (d.type || d.document_type) === doc.type
            );
            const docVerified = uploaded?.verification_status === 'verified';
            const docRejected = uploaded?.verification_status === 'rejected';

            return (
              <Col xs={24} sm={12} key={doc.type}>
                <Card
                  size="small"
                  bordered
                  style={{
                    borderColor: docVerified ? '#b7eb8f' : docRejected ? '#ffa39e' : '#d9d9d9',
                    background: docVerified ? '#f6ffed' : docRejected ? '#fff2f0' : '#fafafa',
                  }}
                >
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space>
                      {docVerified
                        ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        : docRejected
                        ? <span style={{ color: '#ff4d4f' }}>✕</span>
                        : <ClockCircleOutlined style={{ color: '#faad14' }} />}
                      <Text strong style={{ fontSize: 13 }}>{doc.label}</Text>
                      {uploaded && (
                        <Tag color={docVerified ? 'success' : docRejected ? 'error' : 'processing'}>
                          {uploaded.verification_status || 'pending'}
                        </Tag>
                      )}
                      {!uploaded && <Tag color="warning">Not Uploaded</Tag>}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>{doc.desc}</Text>
                    {uploaded?.verification_notes && (
                      <Alert type="warning" showIcon message={uploaded.verification_notes} style={{ fontSize: 11, padding: '4px 8px' }} />
                    )}
                    <Upload
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      showUploadList={false}
                      beforeUpload={(file) => handleUploadDocument(doc.type, file)}
                    >
                      <Button
                        size="small"
                        icon={<UploadOutlined />}
                        loading={uploading[doc.type]}
                      >
                        {uploaded ? 'Re-upload' : 'Upload'}
                      </Button>
                    </Upload>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>

        {/* Optional Documents */}
        <Text strong style={{ color: '#8c8c8c' }}>Optional Documents (Recommended)</Text>
        <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
          {OPTIONAL_DOCS.map(doc => {
            const uploaded = (verificationStatus?.documents || []).find(
              d => (d.type || d.document_type) === doc.type
            );
            const docVerified = uploaded?.verification_status === 'verified';
            const docRejected = uploaded?.verification_status === 'rejected';

            return (
              <Col xs={24} sm={12} key={doc.type}>
                <Card
                  size="small"
                  bordered
                  style={{
                    borderColor: docVerified ? '#b7eb8f' : docRejected ? '#ffa39e' : '#d9d9d9',
                    background: docVerified ? '#f6ffed' : docRejected ? '#fff2f0' : '#fafafa',
                  }}
                >
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space>
                      {docVerified
                        ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        : docRejected
                        ? <span style={{ color: '#ff4d4f' }}>✕</span>
                        : <ClockCircleOutlined style={{ color: '#faad14' }} />}
                      <Text strong style={{ fontSize: 13 }}>{doc.label}</Text>
                      {uploaded && (
                        <Tag color={docVerified ? 'success' : docRejected ? 'error' : 'processing'}>
                          {uploaded.verification_status || 'pending'}
                        </Tag>
                      )}
                      {!uploaded && <Tag color="warning">Not Uploaded</Tag>}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>{doc.desc}</Text>
                    {uploaded?.verification_notes && (
                      <Alert type="warning" showIcon message={uploaded.verification_notes} style={{ fontSize: 11, padding: '4px 8px' }} />
                    )}
                    <Upload
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      showUploadList={false}
                      beforeUpload={(file) => handleUploadDocument(doc.type, file)}
                    >
                      <Button
                        size="small"
                        icon={<UploadOutlined />}
                        loading={uploading[doc.type]}
                      >
                        {uploaded ? 'Re-upload' : 'Upload'}
                      </Button>
                    </Upload>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Modal>
    </div>
  );
}
