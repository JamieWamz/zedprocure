import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Table, Tag, Spin, Alert, Button, Tabs, Badge, List,
  Typography, Empty, Popover, Statistic, message as msg, Modal, Form,
  Upload, Space, Divider, Progress, Tooltip, Input, InputNumber, Select, Descriptions,
} from 'antd';
import {
  BellOutlined, FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined,
  SafetyCertificateOutlined, TrophyOutlined, UploadOutlined, InboxOutlined,
  AuditOutlined, ShoppingCartOutlined, ReloadOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';
import DigitalSignatureModal from './DigitalSignatureModal';
import ProgressSteps from './ProgressSteps';
import ActionableEmptyState from './ActionableEmptyState';
import NextActionPanel from './NextActionPanel';
import { useAuth } from '../context/AuthContext';
import { getNotificationDestination, isActivationKey } from '../utils/notificationNavigation';
import RotatingMediaBanner from './RotatingMediaBanner';
import { remoteImages } from '../remoteImageAssets';

const { Text } = Typography;

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
  const [wallet, setWallet] = useState({ balance: '0.00', transactions: [] });
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutForm] = Form.useForm();
  const [payoutPreview, setPayoutPreview] = useState(null);
  const [payoutAccounts, setPayoutAccounts] = useState([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountForm] = Form.useForm();
  const [subscription, setSubscription] = useState({ tier: 'free', monthly_bid_limit: 0, bids_used: 0, bid_credits: 0 });
  const [activeTab, setActiveTab] = useState('bids');

  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const openTab = useCallback((tab, focus) => {
    setActiveTab(tab);
    const params = new URLSearchParams({ tab });
    if (focus) params.set('focus', focus);
    navigate({ pathname: '/supplier', search: `?${params.toString()}` });
    window.setTimeout(() => {
      const focusedRow = focus ? document.querySelector(`[data-row-key="${focus}"]`) : null;
      (focusedRow || document.getElementById('supplier-workspace-tabs'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [navigate]);

  const fetchData = useCallback(async () => {
    try {
      const [bidsRes, statusRes, notifRes, countRes, walletRes, subscriptionRes, payoutAccountsRes] = await Promise.all([
        axios.get('/api/supplier/bids'),
        axios.get('/api/supplier/verification/status').catch(() => null),
        axios.get('/api/notifications').catch(() => ({ data: [] })),
        axios.get('/api/notifications/unread-count').catch(() => ({ data: { count: 0 } })),
        axios.get('/api/wallet').catch(() => ({ data: { balance: '0.00', transactions: [] } })),
        axios.get('/api/supplier/subscription').catch(() => ({ data: { tier: 'free', monthly_bid_limit: 0, bids_used: 0, bid_credits: 0 } })),
        axios.get('/api/payout-accounts').catch(() => ({ data: [] })),
      ]);
      setBids(bidsRes.data);
      setVerificationStatus(statusRes?.data || null);
      setNotifications(notifRes.data);
      setUnreadCount(countRes.data.count);
      setWallet(walletRes.data);
      setSubscription(subscriptionRes.data);
      setPayoutAccounts(payoutAccountsRes.data);
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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    const focus = params.get('focus');
    if (['bids', 'orders'].includes(requestedTab)) {
      setActiveTab(requestedTab);
      window.setTimeout(() => {
        const focusedRow = focus ? document.querySelector(`[data-row-key="${focus}"]`) : null;
        (focusedRow || document.getElementById('supplier-workspace-tabs'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
    if (params.get('action') === 'wallet') setPayoutOpen(true);
  }, [location.search, bids.length, orders.length]);

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

  const openNotification = async (item) => {
    await markAsRead(item.id);
    setNotifOpen(false);
    navigate(getNotificationDestination(item, user));
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

  const handlePayoutRequest = async (values) => {
    setPayoutLoading(true);
    try {
      const { data } = await axios.post('/api/wallet/withdrawals', values);
      msg.success(`Payout requested. Net amount: ${money(data.netPayout)}`);
      setPayoutOpen(false);
      setPayoutPreview(null);
      payoutForm.resetFields();
      fetchData();
    } catch (e) {
      msg.error(e.response?.data?.error || 'Payout request failed');
    } finally {
      setPayoutLoading(false);
    }
  };

  const handlePayoutPreview = async () => {
    try {
      const amount = await payoutForm.validateFields(['amount']).then(v => v.amount);
      const { data } = await axios.post('/api/wallet/withdrawals/preview', { amount });
      setPayoutPreview(data);
    } catch (e) {
      if (e.response) msg.error(e.response?.data?.error || 'Unable to calculate payout');
    }
  };

  const savePayoutAccount = async (values) => {
    setAccountLoading(true);
    try {
      await axios.post('/api/payout-accounts', { ...values, is_primary: true });
      msg.success('Payout account saved and sent for administrator verification.');
      setAccountOpen(false);
      accountForm.resetFields();
      fetchData();
    } catch (e) {
      msg.error(e.response?.data?.error || 'Could not save payout account');
    } finally {
      setAccountLoading(false);
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
              className="notification-item"
              data-unread={!item.is_read}
              role="button"
              tabIndex={0}
              onClick={() => openNotification(item)}
              onKeyDown={(event) => { if (isActivationKey(event)) { event.preventDefault(); openNotification(item); } }}
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
  const mandatoryVerifiedCount = MANDATORY_DOCS.filter(d => verifiedDocTypes.has(d.type)).length;
  const mandatoryDocsUploaded = MANDATORY_DOCS.every(d => uploadedDocTypes.has(d.type));

  let currentStep = 0;
  if (isVerified) {
    currentStep = 2;
  } else if (mandatoryDocsUploaded) {
    currentStep = 1;
  }

  const bidColumns = [
    {
      title: 'Opportunity', dataIndex: 'title', key: 'title', width: 340,
      render: (value, row) => (
        <div className="portal-table-primary">
          <Text strong>{value}</Text>
          <Text type="secondary" ellipsis>{row.description || 'Open this opportunity to review the requirements.'}</Text>
        </div>
      ),
    },
    {
      title: 'Deadline', dataIndex: 'deadline', key: 'deadline',
      render: (v) => (
        <div className="portal-table-primary">
          <Text>{new Date(v).toLocaleDateString()}</Text>
          <Text type="secondary">{new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        </div>
      ),
    },
    {
      title: 'Access', key: 'access',
      render: (_, row) => <Tag color={row.bid_supplier_id ? 'gold' : 'default'}>{row.bid_supplier_id ? 'Invitation' : 'Open marketplace'}</Tag>,
    },
    {
      title: 'Your status', key: 'status',
      render: (_, row) => row.accepted === true
        ? <Tag color="success">Accepted</Tag>
        : row.accepted === false
          ? <Tag color="error">Declined</Tag>
          : <Tag color="processing">Open</Tag>,
    },
    {
      title: 'Next step', key: 'action',
      render: (_, row) => (
        <Button size="small" type="primary" onClick={() => navigate(`/supplier/bids/${row.id}`)}>
          {row.bid_supplier_id ? 'Review and respond' : 'Review opportunity'}
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

  const actionableOrder = orders.find(order => ['pending_acceptance', 'accepted', 'delivery_in_progress'].includes(order.status));
  const supplierName = user?.full_name?.trim().split(/\s+/)[0] || user?.email?.split('@')[0] || 'there';
  const remainingIncludedBids = Math.max(0, Number(subscription.monthly_bid_limit) - Number(subscription.bids_used));
  const nextAction = !isVerified
    ? {
        title: 'Finish setting up your supplier profile',
        description: 'Upload the required company documents so buyers can confidently review your responses.',
        actionLabel: 'Finish verification',
        onAction: () => setVerifModalOpen(true),
      }
    : actionableOrder
      ? {
          title: 'An order is waiting for you',
          description: `Order ${actionableOrder.id.slice(0, 8)} is at “${getOrderProgress(actionableOrder.status).label}”. Open it to complete the next step.`,
          actionLabel: 'View the order',
          onAction: () => openTab('orders', actionableOrder.id),
        }
      : {
          title: 'Find work that fits your business',
          description: 'Browse current opportunities and review the requirements before the response deadline.',
          actionLabel: 'Browse opportunities',
          onAction: () => openTab('bids'),
        };

  const tabCardProps = (tab) => ({
    hoverable: true,
    role: 'button',
    tabIndex: 0,
    onClick: () => openTab(tab),
    onKeyDown: (event) => { if (isActivationKey(event)) { event.preventDefault(); openTab(tab); } },
  });

  return (
    <div className="workspace-page">
      <RotatingMediaBanner
        images={remoteImages.supplierHeroes}
        className="portal-welcome-header"
        imagePosition="center 55%"
        ariaLabel="Supplier workspace overview"
      >
        <div>
          <Text className="portal-welcome-eyebrow">Supplier workspace</Text>
          <h2>Welcome, {supplierName}</h2>
          <p>Find opportunities, respond with confidence, and keep every order moving.</p>
        </div>
        <div className="page-media-actions">
          <Popover content={notificationContent} title="Notifications" trigger="click"
            open={notifOpen} onOpenChange={setNotifOpen}>
            <Badge count={unreadCount} size="small" style={{ marginRight: 8 }}>
              <Button icon={<BellOutlined />} aria-label="Open notifications" />
            </Badge>
          </Popover>
          <Tooltip title="Refresh workspace">
            <Button icon={<ReloadOutlined />} onClick={() => { fetchData(); fetchOrders(); }} aria-label="Refresh workspace" />
          </Tooltip>
        </div>
      </RotatingMediaBanner>

      <NextActionPanel {...nextAction} />

      <section className="portal-account-strip" aria-label="Supplier account overview">
        <div className="portal-account-item">
          <Text type="secondary">Verification</Text>
          <Space size={6}>
            <Tag color={isVerified ? 'success' : 'warning'}>{isVerified ? 'Verified' : 'Setup required'}</Tag>
            <Button type="link" size="small" onClick={() => setVerifModalOpen(true)}>{isVerified ? 'View' : 'Finish'}</Button>
          </Space>
        </div>
        <div className="portal-account-item">
          <Text type="secondary">Plan</Text>
          <Text strong className="portal-account-value">{String(subscription.tier || 'free').replaceAll('_', ' ')}</Text>
        </div>
        <div className="portal-account-item">
          <Text type="secondary">Bidding allowance</Text>
          <Text strong className="portal-account-value">{remainingIncludedBids} included · {subscription.bid_credits || 0} credits</Text>
        </div>
        <div className="portal-account-item">
          <Text type="secondary">Order payout account</Text>
          <Space size={6}>
            {payoutAccounts[0]
              ? <Tag color={payoutAccounts[0].is_verified ? 'success' : 'warning'}>
                  {payoutAccounts[0].provider} •••• {payoutAccounts[0].destination_last4} · {payoutAccounts[0].is_verified ? 'verified' : 'review pending'}
                </Tag>
              : <Tag color="warning">Setup required</Tag>}
            <Button type="link" size="small" onClick={() => setAccountOpen(true)}>
              {payoutAccounts[0] ? 'Change' : 'Set up'}
            </Button>
          </Space>
        </div>
        <div className="portal-account-item portal-account-item--action">
          <div>
            <Text type="secondary">Available balance</Text>
            <Text strong className="portal-account-value">{money(wallet.balance)}</Text>
          </div>
          <Button icon={<WalletOutlined />} onClick={() => setPayoutOpen(true)} disabled={Number(wallet.balance || 0) <= 0}>Withdraw</Button>
        </div>
      </section>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card className="stat-card stat-card--interactive" {...tabCardProps('bids')}>
            <Statistic
              title="Open opportunities"
              value={(bids || []).filter(b => b.accepted == null && b.visibility === 'global').length}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="stat-card stat-card--interactive" {...tabCardProps('bids')}>
            <Statistic
              title="Invitations for you"
              value={(bids || []).filter(b => b.bid_supplier_id && b.accepted == null).length}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="stat-card stat-card--interactive" {...tabCardProps('orders')}>
            <Statistic
              title="Orders in progress"
              value={(orders || []).filter(o => !['completed', 'disputed'].includes(o.status)).length}
              prefix={<ShoppingCartOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Main Tabs */}
      <Tabs
        id="supplier-workspace-tabs"
        activeKey={activeTab}
        onChange={openTab}
        className="workspace-tabs"
        items={[
          {
            key: 'bids',
            label: <span><TrophyOutlined /> Find opportunities</span>,
            children: (
              <Card className="table-card" title="Opportunities available to you">
                <Text type="secondary" className="portal-section-intro">
                  Review the scope and deadline first. You can decide whether to respond after opening the opportunity.
                </Text>
                <Table
                  dataSource={bids}
                  rowClassName={(record) => new URLSearchParams(location.search).get('focus') === record.id ? 'notification-focus-row' : ''}
                  columns={bidColumns}
                  rowKey="id"
                  pagination={{ pageSize: 10 }}
                  size="middle"
                  scroll={{ x: 700 }}
                  locale={{ emptyText: <ActionableEmptyState title="No opportunities are open right now" description="New opportunities and invitations will appear here automatically." ctaText="Refresh opportunities" onAction={fetchData} /> }}
                />
              </Card>
            ),
          },
          {
            key: 'orders',
            label: <span><ShoppingCartOutlined /> My orders</span>,
            children: (
              <Card className="table-card" title="Orders and delivery">
                <Table
                  dataSource={orders}
                  rowClassName={(record) => new URLSearchParams(location.search).get('focus') === record.id ? 'notification-focus-row' : ''}
                  columns={orderColumns}
                  rowKey="id"
                  loading={ordersLoading}
                  pagination={{ pageSize: 10 }}
                  size="middle"
                  scroll={{ x: 900 }}
                  locale={{ emptyText: <ActionableEmptyState title="No orders yet" description="When a response is awarded, the order and its next step will appear here." ctaText="Find opportunities" ctaPath="/supplier?tab=bids" /> }}
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

      <Modal
        title="Order payout account"
        open={accountOpen}
        onCancel={() => setAccountOpen(false)}
        footer={null}
      >
        <Alert
          type="info"
          showIcon
          message="Where should protected order payments be sent?"
          description="For your protection, a platform administrator must verify every new account before it can receive an escrow release. Full account details are encrypted."
          style={{ marginBottom: 16 }}
        />
        <Form form={accountForm} layout="vertical" onFinish={savePayoutAccount} initialValues={{ provider: 'MTN' }}>
          <Form.Item name="provider" label="Payout provider" rules={[{ required: true }]}>
            <Select options={[
              { value: 'MTN', label: 'MTN Mobile Money' },
              { value: 'AIRTEL', label: 'Airtel Money' },
              { value: 'BANK', label: 'Bank account' },
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.provider !== current.provider}>
            {({ getFieldValue }) => {
              const provider = getFieldValue('provider');
              const bank = provider === 'BANK';
              return (
                <>
                  <Form.Item
                    name="destination"
                    label={bank ? 'Bank account number' : 'Mobile money number'}
                    rules={bank
                      ? [{ required: true }, { pattern: /^[A-Za-z0-9-]{6,34}$/, message: 'Enter 6–34 letters, digits, or hyphens' }]
                      : [{ required: true }, { pattern: /^260\d{9}$/, message: 'Use 260XXXXXXXXX format' }]}
                  >
                    <Input autoComplete="off" placeholder={bank ? 'Account number' : '260971234567'} />
                  </Form.Item>
                  {bank && (
                    <>
                      <Form.Item name="bank_code" label="Bank code" rules={[{ required: true }]}>
                        <Input autoComplete="off" placeholder="e.g. ZANACO" />
                      </Form.Item>
                      <Form.Item name="account_name" label="Account holder name" rules={[{ required: true, max: 150 }]}>
                        <Input autoComplete="off" />
                      </Form.Item>
                    </>
                  )}
                </>
              );
            }}
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={accountLoading}>Save payout account</Button>
        </Form>
      </Modal>

      <Modal
        title="Withdraw supplier balance"
        open={payoutOpen}
        onCancel={() => { setPayoutOpen(false); setPayoutPreview(null); }}
        footer={null}
      >
        <Alert
          type="info"
          showIcon
          message={`Available balance: ${money(wallet.balance)}`}
          description="The server calculates the processing fee and returns the exact net payout when the request is queued."
          style={{ marginBottom: 16 }}
        />
        <Form form={payoutForm} layout="vertical" onFinish={handlePayoutRequest}>
          <Form.Item name="amount" label="Gross withdrawal amount (ZMW)" rules={[{ required: true }]}>
            <InputNumber onChange={() => setPayoutPreview(null)} min={0.01} max={Number(wallet.balance || 0)} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Button block onClick={handlePayoutPreview} style={{ marginBottom: 16 }}>Calculate processing fee</Button>
          {payoutPreview && (
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Gross amount">{money(payoutPreview.grossAmount)}</Descriptions.Item>
              <Descriptions.Item label="Processing fee">{money(payoutPreview.processingFee)}</Descriptions.Item>
              <Descriptions.Item label="Net payout"><Text strong>{money(payoutPreview.netPayout)}</Text></Descriptions.Item>
            </Descriptions>
          )}
          <Form.Item name="payout_method" label="Payout method" rules={[{ required: true }]}>
            <Select options={[
              { value: 'mobile_money', label: 'Mobile Money' },
              { value: 'bank_transfer', label: 'Bank Transfer' },
            ]} />
          </Form.Item>
          <Form.Item name="payout_destination" label="Mobile number or bank account reference" rules={[{ required: true, max: 255 }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={payoutLoading} disabled={!payoutPreview}>Request net payout</Button>
        </Form>
      </Modal>

      {/* Verification & Document Upload Modal */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: isVerified ? '#52c41a' : '#faad14' }} />
            <span>Supplier verification</span>
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
              ? 'Your supplier profile is verified and ready to bid.'
              : verificationStatus?.verification_status === 'rejected'
              ? 'Some documents need attention. Review the note and upload corrected copies.'
              : 'Upload the four required documents, then the procurement team will review them.'
          }
          description={verificationStatus?.verification_notes || undefined}
          style={{ marginBottom: 16 }}
        />

        {/* Document compliance progress */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>{mandatoryVerifiedCount} of {MANDATORY_DOCS.length} required documents verified</Text>
          <Progress
            percent={Math.round((mandatoryVerifiedCount / MANDATORY_DOCS.length) * 100)}
            status={isVerified ? 'success' : 'active'}
            style={{ marginTop: 8 }}
          />
        </div>

        <Divider />

        <Text strong>Required documents</Text>
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
                  className={`verification-document-card verification-document-card--${docVerified ? 'verified' : docRejected ? 'rejected' : 'pending'}`}
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
                      {!uploaded && <Tag>Not uploaded</Tag>}
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

        <details className="portal-verification-optional">
          <summary>
            <span>Optional supporting documents</span>
            <Text type="secondary">Add these if they strengthen your supplier profile</Text>
          </summary>
          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
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
                  className={`verification-document-card verification-document-card--${docVerified ? 'verified' : docRejected ? 'rejected' : 'pending'}`}
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
                      {!uploaded && <Tag>Not uploaded</Tag>}
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
        </details>
      </Modal>
    </div>
  );
}
