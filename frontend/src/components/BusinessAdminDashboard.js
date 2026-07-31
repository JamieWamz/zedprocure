import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Spin, Alert, Tabs, Progress, Tooltip, Button, Modal, Form, Input, message, List, Typography, Badge, Popover, Empty, Space } from 'antd';
import {
  DollarOutlined, RiseOutlined, FallOutlined, SafetyCertificateOutlined,
  FileTextOutlined, TeamOutlined, BankOutlined, ShoppingCartOutlined,
  ArrowUpOutlined, ArrowDownOutlined, WalletOutlined, SendOutlined,
  ReloadOutlined, CreditCardOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, BellOutlined, CheckOutlined, CloseOutlined,
  FlagOutlined, TrophyOutlined, UserSwitchOutlined, UserAddOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReChartTooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import ProgressSteps from './ProgressSteps';
import NextActionPanel from './NextActionPanel';
import { getNotificationDestination, isActivationKey } from '../utils/notificationNavigation';

const { Text } = Typography;

const adminSteps = [
  {
    title: 'Create Bids',
    description: 'Create and publish bids to the marketplace.',
  },
  {
    title: 'Verify Suppliers',
    description: 'Verify suppliers to ensure they meet the requirements.',
  },
  {
    title: 'Award Bids',
    description: 'Award bids to the best suppliers.',
  },
  {
    title: 'Manage Orders',
    description: 'Manage orders and track their status.',
  },
];

function money(value) {
  return `ZMW ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function BusinessAdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [walletModal, setWalletModal] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [transferForm] = Form.useForm();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [focusedRequestId, setFocusedRequestId] = useState(null);

  // ─── Verification Queue State ─────────────────────────────────────────────
  const [verificationQueue, setVerificationQueue] = useState([]);
  const [verifLoading, setVerifLoading] = useState(false);
  const [verifModalVisible, setVerifModalVisible] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [verifAction, setVerifAction] = useState(null); // 'verified' or 'rejected'
  const [verifNotes, setVerifNotes] = useState('');
  const [verifSubmitting, setVerifSubmitting] = useState(false);

  // Invite Supplier State
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteForm] = Form.useForm();
  const [inviteLoading, setInviteLoading] = useState(false);

  // Customer Procurement Requests State
  const [adminProcurementRequests, setAdminProcurementRequests] = useState([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryRes, walletRes, reqRes] = await Promise.all([
        axios.get('/api/dashboard/summary'),
        axios.get('/api/wallet').catch(() => ({ data: { balance: '0.00', transactions: [] } })),
        axios.get('/api/admin/procurement-requests').catch(() => ({ data: [] })),
      ]);
      setData(summaryRes.data);
      setWallet(walletRes.data);
      setAdminProcurementRequests(reqRes.data || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll notifications every 30 seconds
  const fetchNotifications = useCallback(async () => {
    try {
      const [notifRes, countRes] = await Promise.all([
        axios.get('/api/notifications'),
        axios.get('/api/notifications/unread-count'),
      ]);
      setNotifications(notifRes.data);
      setUnreadCount(countRes.data.count);
    } catch (_err) {
      // Notifications endpoint may not be available yet
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const section = params.get('section');
    const focus = params.get('focus');
    setFocusedRequestId(focus);
    if (section) {
      window.setTimeout(() => {
        const focusedRow = focus ? document.querySelector(`[data-row-key="${focus}"]`) : null;
        (focusedRow || document.getElementById(section))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }, [location.search, adminProcurementRequests.length]);

  const markAsRead = async (id) => {
    try {
      await axios.put(`/api/notifications/${id}/read`);
      fetchNotifications();
    } catch (_) {}
  };

  const markAllRead = async () => {
    await axios.put('/api/notifications/read-all');
    fetchNotifications();
  };

  const openNotification = async (item) => {
    await markAsRead(item.id);
    setNotifOpen(false);
    navigate(getNotificationDestination(item, { role: 'business_admin' }));
  };

  const notificationContent = (
    <div style={{ width: 'min(360px, 92vw)', maxHeight: 400, overflowY: 'auto' }}>
      {notifications.length === 0 ? (
        <Empty description="No notifications" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <div style={{ textAlign: 'right', padding: '4px 8px' }}>
            <Button type="link" size="small" onClick={markAllRead}>Mark all as read</Button>
          </div>
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
        </>
      )}
    </div>
  );

  // ─── Fetch verification queue ─────────────────────────────────────────────
  const fetchVerificationQueue = useCallback(async () => {
    setVerifLoading(true);
    try {
      const { data } = await axios.get('/api/admin/verification/suppliers');
      setVerificationQueue(data.slice(0, 5)); // Top 5 pending
    } catch {
      // Non-critical — dashboard still works
    } finally {
      setVerifLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); fetchVerificationQueue(); }, [fetchData, fetchVerificationQueue]);

  // ─── Handle inline verification ───────────────────────────────────────────
  const handleVerificationAction = async () => {
    if (!selectedSupplier || !verifAction) return;
    setVerifSubmitting(true);
    try {
      await axios.put(`/api/admin/suppliers/${selectedSupplier.id}/verify`, {
        status: verifAction,
        notes: verifNotes,
      });
      message.success(`Supplier ${verifAction === 'verified' ? 'approved' : 'rejected'} successfully`);
      setVerifModalVisible(false);
      setSelectedSupplier(null);
      setVerifNotes('');
      fetchVerificationQueue();
      fetchData(); // Refresh stats
    } catch (e) {
      const errorMsg = e.response?.data?.error || 'Verification action failed';
      // Enhanced procurement-standard error feedback
      if (errorMsg.toLowerCase().includes('tax_clearance') || errorMsg.toLowerCase().includes('pacra')) {
        message.error(`Verification failed: Missing mandatory document. ${errorMsg}`);
      } else {
        message.error(errorMsg);
      }
    } finally {
      setVerifSubmitting(false);
    }
  };

  const handleUpdateProcurementRequestStatus = async (requestId, status) => {
    try {
      await axios.put(`/api/admin/procurement-requests/${requestId}/status`, { status });
      message.success(`Procurement request status updated to ${status}`);
      fetchData();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to update request');
    }
  };

  const handleTransfer = async (values) => {
    try {
      await axios.post('/api/wallet/transfer', values);
      message.success(`Transfer of ZMW ${values.amount} completed`);
      setWalletModal(false);
      transferForm.resetFields();
      fetchData();
    } catch (e) {
      message.error(e.response?.data?.error || 'Transfer failed');
    }
  };

  const handleInviteSupplier = async (values) => {
    setInviteLoading(true);
    try {
      await axios.post('/api/admin/invitations', { email: values.email, role: 'supplier' });
      message.success('Invitation sent successfully');
      setInviteModalOpen(false);
      inviteForm.resetFields();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to send invitation');
    } finally {
      setInviteLoading(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" message={error} showIcon style={{ margin: 24 }} />;
  if (!data) return null;

  const { revenue = {}, outstanding = {}, stats = {}, monthlyRevenue = [], escrowSummary = {}, recentTransactions = [], invoices = {}, procurement = {} } = data || {};
  const invoiceCounts = invoices.counts || {};
  const bidPipeline = procurement.bidPipeline || [];
  const orderPipeline = procurement.orderPipeline || [];
  const urgentBids = procurement.urgentBids || [];
  const topSuppliers = procurement.topSuppliers || [];

  let adminCurrentStep = 0;
  if (stats.totalBids > 0) adminCurrentStep = 1;
  if (stats.verifiedSuppliers > 0) adminCurrentStep = 2;
  if (stats.totalOrders > 0) adminCurrentStep = 3;

  const transactionColumns = [
    { title: 'Ref', dataIndex: 'ref', key: 'ref', render: (v) => <Text code style={{ fontSize: 11 }}>{v?.slice(0, 16)}</Text> },
    { title: 'From', dataIndex: 'fromName', key: 'fromName' },
    {
      title: 'Amount', dataIndex: 'amount', key: 'amount',
      render: (v) => <span style={{ fontWeight: 600, color: parseFloat(v) > 0 ? '#389e0d' : '#cf1322' }}>ZMW {parseFloat(v).toLocaleString()}</span>,
    },
    { title: 'Type', dataIndex: 'type', key: 'type', render: (v) => <Tag>{v}</Tag> },
    {
      title: 'Status', dataIndex: 'status', key: 'status',
      render: (v) => (
        <Tag color={v === 'completed' ? 'success' : v === 'initiated' ? 'processing' : 'warning'}>{v}</Tag>
      ),
    },
    { title: 'Date', dataIndex: 'date', key: 'date', render: (v) => new Date(v).toLocaleDateString() },
  ];

  const profitColor = parseFloat(revenue.netProfit) >= 0 ? '#389e0d' : '#cf1322';
  const ProfitIcon = parseFloat(revenue.netProfit) >= 0 ? RiseOutlined : FallOutlined;
  const routeCardProps = (path) => ({
    hoverable: true,
    role: 'button',
    tabIndex: 0,
    onClick: () => navigate(path),
    onKeyDown: (event) => { if (isActivationKey(event)) { event.preventDefault(); navigate(path); } },
  });
  const nextAction = Number(stats.totalBids || 0) === 0
    ? {
        title: 'Create and publish your first bid',
        description: 'Define the scope, bill of quantities, deadline, and supplier visibility to start the procurement cycle.',
        actionLabel: 'Create a bid',
        onAction: () => navigate('/admin/bids/new'),
      }
    : verificationQueue.length > 0
      ? {
          title: `Review ${verificationQueue.length} supplier${verificationQueue.length === 1 ? '' : 's'} awaiting verification`,
          description: 'Validate compliance documents so qualified suppliers can participate in open opportunities.',
          actionLabel: 'Open verification queue',
          onAction: () => navigate('/admin/verification'),
        }
      : {
          title: 'Review the procurement pipeline',
          description: 'Check approaching deadlines, evaluate responses, and move awarded bids into active orders.',
          actionLabel: 'Review all bids',
          onAction: () => navigate('/admin/bids'),
          secondaryLabel: 'View orders',
          onSecondary: () => navigate('/admin/orders'),
        };

  return (
    <div className="workspace-page">
      {/* Page Header with Wallet */}
      <div className="page-media-banner">
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Business Dashboard</h2>
          <p>Financial overview, invoice controls, cash movement and platform procurement metrics.</p>
        </div>
        <div className="page-media-actions">
          <Popover content={notificationContent} title="Notifications" trigger="click"
            open={notifOpen} onOpenChange={setNotifOpen}>
            <Badge count={unreadCount} size="small" style={{ marginRight: 8 }}>
              <Button icon={<BellOutlined />} aria-label="Open notifications" />
            </Badge>
          </Popover>
          <Button icon={<UserAddOutlined />} onClick={() => setInviteModalOpen(true)}>Invite Supplier</Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData} style={{ marginRight: 12 }}>Refresh</Button>
          <Button icon={<FileTextOutlined />} onClick={() => navigate('/admin/invoices')}>Invoices</Button>
          <Button icon={<DollarOutlined />} onClick={() => navigate('/admin/ledger')}>Ledger</Button>
          <Button type="primary" icon={<WalletOutlined />} onClick={() => setWalletModal(true)}>
            Wallet: ZMW {wallet?.balance || '0.00'}
          </Button>
        </div>
      </div>

      <NextActionPanel {...nextAction} />

      <Card title="Getting Started" style={{ marginBottom: 16 }}>
        <ProgressSteps steps={adminSteps} current={adminCurrentStep} />
      </Card>

      {/* Executive financial summary */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card executive-metric executive-metric--revenue">
            <Statistic title="Total Revenue"
              value={parseFloat(revenue.total)} prefix={<DollarOutlined />} suffix="ZMW"
              valueStyle={{ color: '#276b9a' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card executive-metric executive-metric--expense">
            <Statistic title="Expenses"
              value={parseFloat(revenue.expenses)} prefix={<FallOutlined />} suffix="ZMW"
              valueStyle={{ color: '#9a650e' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className={`stat-card executive-metric ${parseFloat(revenue.netProfit) >= 0 ? 'executive-metric--profit' : 'executive-metric--loss'}`}>
            <Statistic title="Net Profit"
              value={parseFloat(revenue.netProfit)} prefix={<ProfitIcon />} suffix="ZMW"
              valueStyle={{ color: profitColor }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card executive-metric executive-metric--margin">
            <Statistic title="Profit Margin"
              value={parseFloat(revenue.profitMargin)} precision={1} suffix="%"
              valueStyle={{ color: '#0f6b5d' }} />
            <Progress percent={Math.min(parseFloat(revenue.profitMargin), 100)} showInfo={false}
              strokeColor="#0f6b5d" trailColor="#e5e9ed" />
          </Card>
        </Col>
      </Row>

      {/* Invoice Control Tower */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" hoverable onClick={() => navigate('/admin/invoices')} style={{ cursor: 'pointer' }}>
            <Statistic title="AR Open" value={money(invoices.arOpen)} prefix={<FileTextOutlined />} valueStyle={{ color: '#1677ff' }} />
            <Text type="secondary">{invoiceCounts.open || 0} open invoice{invoiceCounts.open === 1 ? '' : 's'}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" hoverable onClick={() => navigate('/admin/invoices')} style={{ cursor: 'pointer' }}>
            <Statistic title="AR Overdue" value={money(invoices.arOverdue)} prefix={<ExclamationCircleOutlined />} valueStyle={{ color: Number(invoices.arOverdue || 0) > 0 ? '#cf1322' : '#389e0d' }} />
            <Text type="secondary">{invoiceCounts.overdue || 0} need follow-up</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" hoverable onClick={() => navigate('/admin/invoices')} style={{ cursor: 'pointer' }}>
            <Statistic title="AP Open" value={money(invoices.apOpen)} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#fa8c16' }} />
            <Text type="secondary">{money(invoices.apDueSoon)} due in 7 days</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" hoverable onClick={() => navigate('/admin/ledger')} style={{ cursor: 'pointer' }}>
            <Statistic title="Cash + Escrow" value={money(Number(revenue.cashBank || 0) + Number(revenue.escrowCash || 0))} prefix={<BankOutlined />} valueStyle={{ color: '#389e0d' }} />
            <Text type="secondary">Bank {money(revenue.cashBank)} · Escrow {money(revenue.escrowCash)}</Text>
          </Card>
        </Col>
      </Row>

      {/* Monthly Revenue Chart */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={16}>
          <Card title={<span><RiseOutlined /> Monthly Revenue (12 months)</span>} className="table-card">
            {monthlyRevenue?.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={monthlyRevenue}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f6b5d" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#0f6b5d" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e9ed" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <ReChartTooltip formatter={(v) => [`ZMW ${parseFloat(v).toLocaleString()}`, 'Revenue']} />
                  <Area type="monotone" dataKey="revenue" stroke="#0f6b5d" fill="url(#revenueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Alert type="info" message="No revenue data yet. Revenue will appear as journal entries are created." showIcon />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span><ExclamationCircleOutlined /> Outstanding Payments</span>} className="stat-card executive-metric executive-metric--expense"
            style={{ height: '100%' }}>
            <Statistic title="Pending Escrow"
              value={parseFloat(outstanding.total)} prefix={<ClockCircleOutlined />} suffix="ZMW"
              valueStyle={{ color: Number(outstanding.total || 0) > 0 ? '#9a650e' : undefined }} />
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              {outstanding.count} payment{outstanding.count !== 1 ? 's' : ''} awaiting settlement
            </Text>
            {escrowSummary && Object.entries(escrowSummary).map(([status, info]) => (
              <div key={status} style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                <span style={{ textTransform: 'capitalize' }}>{status.replace('_', ' ')}</span>
                <Text type="secondary">{info.count} · ZMW {parseFloat(info.total).toLocaleString()}</Text>
              </div>
            ))}
          </Card>
        </Col>
      </Row>

      {/* Business Summary Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/bids')}>
            <Statistic title="Total Bids" value={stats.totalBids} prefix={<FileTextOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/bids?status=open')}>
            <Statistic title="Active Bids" value={stats.activeBids} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/verification')}>
            <Statistic title="Verified Suppliers" value={stats.verifiedSuppliers} prefix={<SafetyCertificateOutlined />} valueStyle={{ color: '#52c41a' }} />
            <Text type={Number(stats.pendingSuppliers || 0) ? 'warning' : 'secondary'}>
              {stats.pendingSuppliers || 0} pending review
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/orders')}>
            <Statistic title="Total Orders" value={stats.totalOrders} prefix={<ShoppingCartOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/orders?status=completed')}>
            <Statistic title="Completed" value={stats.completedOrders} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
            <Text type={Number(stats.disputedOrders || 0) ? 'danger' : 'secondary'}>
              {stats.disputedOrders || 0} disputed
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/users')}>
            <Statistic title="Users" value={stats.platformUsers} prefix={<TeamOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/tenants')}>
            <Statistic title="Organizations" value={stats.organizations} prefix={<BankOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card stat-card--interactive" {...routeCardProps('/admin/ledger')}>
            <Statistic title="Open Ledger" value="→" prefix={<DollarOutlined />} valueStyle={{ color: '#1677ff', fontSize: 24 }} />
          </Card>
        </Col>
      </Row>

      {/* Procurement Command Center */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={8}>
          <Card title={<span><FlagOutlined /> Bid Pipeline</span>} className="table-card" style={{ height: '100%' }}>
            {bidPipeline.length ? (
          <List
                size="small"
                dataSource={bidPipeline}
                renderItem={(item) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/admin/bids?status=${encodeURIComponent(item.status)}`)}
                  >
                    <List.Item.Meta
                      title={<Text style={{ textTransform: 'capitalize' }}>{item.status}</Text>}
                      description={`${item.count} bid${item.count === 1 ? '' : 's'}`}
                    />
                    <Progress
                      percent={Math.min((item.count / Math.max(stats.totalBids || 1, 1)) * 100, 100)}
                      showInfo={false}
                      style={{ width: 120 }}
                    />
                  </List.Item>
                )}
              />
            ) : <Alert type="info" showIcon message="No bid pipeline activity yet" />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span><ShoppingCartOutlined /> Order Control</span>} className="table-card" style={{ height: '100%' }}>
            {orderPipeline.length ? (
          <List
                size="small"
                dataSource={orderPipeline}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Text style={{ textTransform: 'capitalize' }}>{item.status.replaceAll('_', ' ')}</Text>}
                      description={`${item.count} order${item.count === 1 ? '' : 's'} · ${money(item.total)}`}
                    />
                    <Button
                      type="link"
                      size="small"
                      style={{ color: item.status === 'disputed' ? '#cf1322' : item.status === 'completed' ? '#389e0d' : '#1677ff', padding: 0 }}
                      onClick={() => navigate(`/admin/orders?status=${encodeURIComponent(item.status)}`)}
                    >
                      {item.status === 'disputed' ? 'Action ↗' : 'Track ↗'}
                    </Button>
                  </List.Item>
                )}
              />
            ) : <Alert type="info" showIcon message="No orders created yet" />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span><TrophyOutlined /> Supplier Performance</span>} className="table-card" style={{ height: '100%' }}>
            {topSuppliers.length ? (
              <List
                size="small"
                dataSource={topSuppliers}
                renderItem={(supplier) => (
                  <List.Item>
                    <List.Item.Meta
                      title={supplier.companyName}
                      description={`${supplier.orders} orders · ${supplier.completed} completed`}
                    />
                    <Text strong>{money(supplier.totalAwarded)}</Text>
                  </List.Item>
                )}
              />
            ) : <Alert type="info" showIcon message="Supplier performance appears after awards" />}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span><UserSwitchOutlined /> Supplier Verification Queue</span>}
            className="table-card"
            extra={<Button size="small" onClick={() => navigate('/admin/verification')}>View All</Button>}
            style={{ height: '100%' }}>
            {verificationQueue.length > 0 ? (
              <Table
                rowKey="id"
                dataSource={verificationQueue}
                pagination={false}
                size="small"
                loading={verifLoading}
                scroll={{ x: 500 }}
                columns={[
                  { title: 'Company', dataIndex: 'company_name', render: (v, r) => <div><Text strong>{v}</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{r.registration_number || '-'}</Text></div> },
                  { title: 'Docs', render: (_, r) => <Tag>{r.documents?.length || 0} uploaded</Tag> },
                  {
                    title: 'Action',
                    render: (_, record) => (
                      <Space size="small">
                        <Button
                          type="primary"
                          size="small"
                          icon={<CheckCircleOutlined />}
                          onClick={() => {
                            setSelectedSupplier(record);
                            setVerifAction('verified');
                            setVerifNotes('');
                            setVerifModalVisible(true);
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          danger
                          size="small"
                          icon={<CloseOutlined />}
                          onClick={() => {
                            setSelectedSupplier(record);
                            setVerifAction('rejected');
                            setVerifNotes('');
                            setVerifModalVisible(true);
                          }}
                        >
                          Reject
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              <Alert type="success" showIcon message="No suppliers pending verification" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span><ClockCircleOutlined /> Bids Needing Attention</span>} className="table-card">
            {urgentBids.length ? (
              <Table
                rowKey="id"
                dataSource={urgentBids}
                pagination={false}
                size="small"
                scroll={{ x: 760 }}
                columns={[
                  { title: 'Bid', dataIndex: 'title' },
                  { title: 'Organization', dataIndex: 'tenantName' },
                  { title: 'Deadline', dataIndex: 'deadline', render: value => new Date(value).toLocaleString() },
                  {
                    title: 'Supplier Response',
                    render: (_, row) => {
                      const percent = row.invited ? Math.round((row.responses / row.invited) * 100) : 0;
                      return <Progress percent={percent} size="small" format={() => `${row.responses}/${row.invited}`} />;
                    },
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => (
                      <Button size="small" type="link" onClick={() => navigate(`/admin/bids/${row.id}`)}>Review</Button>
                    ),
                  },
                ]}
              />
            ) : <Alert type="success" showIcon message="No active bid deadlines need immediate attention" />}
          </Card>
        </Col>
        <Col xs={24} lg={24}>
          <Card
            id="procurement-requests"
            title={<span><SendOutlined /> Customer Procurement Requests & Requirements ({adminProcurementRequests.length})</span>}
            className="table-card"
            style={{ marginBottom: 16 }}
          >
            {adminProcurementRequests.length > 0 ? (
              <Table
                rowKey="id"
                dataSource={adminProcurementRequests}
                pagination={{ pageSize: 5 }}
                size="small"
                scroll={{ x: 700 }}
                expandable={{
                  expandedRowRender: record => (
                    <div style={{ margin: 0, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <p style={{ margin: '0 0 6px 0' }}><strong>Detailed Specifications & Requirements:</strong></p>
                      <div style={{ whiteSpace: 'pre-wrap', color: '#334155', marginBottom: 12 }}>{record.description || 'No description provided.'}</div>
                      {record.required_delivery_date && (
                        <p style={{ margin: '0 0 4px 0' }}>
                          <strong>Required Delivery Date:</strong> {new Date(record.required_delivery_date).toLocaleDateString()}
                        </p>
                      )}
                      {record.admin_notes && (
                        <p style={{ margin: '0 0 4px 0', color: '#b91c1c' }}>
                          <strong>Admin Notes:</strong> {record.admin_notes}
                        </p>
                      )}
                    </div>
                  ),
                  rowExpandable: record => !!record.description || !!record.required_delivery_date,
                }}
                rowClassName={(record) => record.id === focusedRequestId ? 'notification-focus-row' : ''}
                columns={[
                  { title: 'Title', dataIndex: 'title', render: v => <Text strong>{v}</Text> },
                  { title: 'Organization', dataIndex: 'tenant_name', render: v => v || '-' },
                  { title: 'Customer', dataIndex: 'customer_name', render: (v, r) => <div><div>{v}</div><Text type="secondary" style={{ fontSize: 11 }}>{r.customer_email}</Text></div> },
                  { title: 'Est. Budget', dataIndex: 'estimated_budget', render: v => v ? money(v) : 'N/A' },
                  { title: 'Payment Method', dataIndex: 'payment_method', render: v => <Tag>{v || 'N/A'}</Tag> },
                  {
                    title: 'Status', dataIndex: 'status',
                    render: v => (
                      <Tag color={v === 'approved' || v === 'converted_to_bid' ? 'success' : v === 'rejected' ? 'error' : 'processing'}>
                        {String(v).replaceAll('_', ' ')}
                      </Tag>
                    ),
                  },
                  {
                    title: 'Actions',
                    render: (_, record) => (
                      <Space size="small">
                        {record.status === 'pending' && (
                          <>
                            <Button size="small" type="primary" onClick={() => handleUpdateProcurementRequestStatus(record.id, 'approved')}>
                              Approve
                            </Button>
                            <Button size="small" onClick={() => navigate('/admin/bids/new', { state: { request: record } })}>
                              Convert to Bid
                            </Button>
                            <Button size="small" danger onClick={() => handleUpdateProcurementRequestStatus(record.id, 'rejected')}>
                              Reject
                            </Button>
                          </>
                        )}
                        {record.status !== 'pending' && (
                          <Button size="small" onClick={() => navigate('/admin/bids/new', { state: { request: record } })}>
                            Create Tender
                          </Button>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            ) : <Alert type="info" showIcon message="No custom customer procurement requests submitted yet" />}
          </Card>
        </Col>
      </Row>

      {/* Recent Transactions */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title={<span><CreditCardOutlined /> Recent Transactions</span>} className="table-card">
            <Table dataSource={recentTransactions} columns={transactionColumns} rowKey="id"
              pagination={false} size="small" scroll={{ x: 600 }}
              locale={{ emptyText: 'No transactions yet' }} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span><WalletOutlined /> Quick Actions</span>} className="table-card">
            <List size="small">
              <List.Item actions={[<Button size="small" type="link" onClick={() => navigate('/admin/verification')}>Go</Button>]}>
                <List.Item.Meta title="Supplier Verification" description={`${stats.verifiedSuppliers} verified`} />
              </List.Item>
              <List.Item actions={[<Button size="small" type="link" onClick={() => navigate('/admin/bids/new')}>Go</Button>]}>
                <List.Item.Meta title="Create New Bid" description="Open a new tender" />
              </List.Item>
              <List.Item actions={[<Button size="small" type="link" onClick={() => navigate('/admin/orders')}>Go</Button>]}>
                <List.Item.Meta title="Manage Orders" description={`${stats.totalOrders} total, ${stats.completedOrders} completed`} />
              </List.Item>
              <List.Item actions={[<Button size="small" type="link" onClick={() => navigate('/admin/invoices')}>Go</Button>]}>
                <List.Item.Meta title="Track Invoices" description={`${invoiceCounts.open || 0} open, ${invoiceCounts.overdue || 0} overdue`} />
              </List.Item>
              <List.Item actions={[<Button size="small" type="link" onClick={() => navigate('/admin/ledger')}>Go</Button>]}>
                <List.Item.Meta title="Accounting Workspace" description="Ledger, trial balance, P&L and cash flow" />
              </List.Item>
              <List.Item actions={[<Button size="small" type="link" onClick={() => navigate('/admin/users')}>Go</Button>]}>
                <List.Item.Meta title="User Management" description={`${stats.platformUsers} active users`} />
              </List.Item>
              <List.Item actions={[<Button size="small" type="link" onClick={() => navigate('/admin/tenants')}>Go</Button>]}>
                <List.Item.Meta title="Organizations" description={`${stats.organizations} tenants`} />
              </List.Item>
            </List>
          </Card>
        </Col>
      </Row>

      {/* Wallet / Transfer Modal */}
      <Modal title={<span><WalletOutlined /> In-App Wallet</span>} open={walletModal}
        onCancel={() => setWalletModal(false)} footer={null} width={520}>
        <Card style={{ marginBottom: 16, background: '#f0f5ff', borderRadius: 12 }}>
          <Statistic title="Available Balance" value={parseFloat(wallet?.balance || 0)}
            precision={2} prefix={<DollarOutlined />} suffix="ZMW" valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 36 }} />
        </Card>

        <Tabs items={[
          {
            key: 'transfer', label: 'Send Money',
            children: (
              <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
                <Form.Item name="to_email" label="Recipient Email"
                  rules={[{ required: true, type: 'email', message: 'Valid email required' }]}>
                  <Input placeholder="user@organization.zm" prefix={<SendOutlined />} />
                </Form.Item>
                <Form.Item name="amount" label="Amount (ZMW)"
                  rules={[{ required: true, message: 'Amount required' }]}>
                  <Input type="number" min={1} step="0.01" prefix={<DollarOutlined />} />
                </Form.Item>
                <Form.Item name="description" label="Note (optional)">
                  <Input.TextArea rows={2} placeholder="What's this for?" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block icon={<SendOutlined />} size="large">
                  Send Money
                </Button>
              </Form>
            ),
          },
          {
            key: 'history', label: 'Transaction History',
            children: wallet?.transactions?.length > 0 ? (
              <List size="small" dataSource={wallet.transactions}
                renderItem={(tx) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<Tag color={tx.type === 'transfer_in' ? 'success' : tx.type === 'transfer_out' ? 'error' : 'processing'}>{tx.type}</Tag>}
                      title={<span>ZMW {parseFloat(tx.amount).toFixed(2)} <Text style={{ fontSize: 12, color: '#999' }}>{tx.description || ''}</Text></span>}
                      description={new Date(tx.created_at).toLocaleString()}
                    />
                  </List.Item>
                )} />
            ) : <Alert type="info" message="No wallet transactions yet" showIcon />,
          }
        ]} />
      </Modal>

      {/* Verification Action Modal */}
      <Modal
        title={`${verifAction === 'verified' ? 'Approve' : 'Reject'} Supplier: ${selectedSupplier?.company_name || ''}`}
        open={verifModalVisible}
        onCancel={() => { setVerifModalVisible(false); setSelectedSupplier(null); setVerifNotes(''); }}
        footer={[
          <Button key="cancel" onClick={() => { setVerifModalVisible(false); setSelectedSupplier(null); setVerifNotes(''); }}>
            Cancel
          </Button>,
          <Button
            key="submit"
            type={verifAction === 'verified' ? 'primary' : 'danger'}
            loading={verifSubmitting}
            onClick={handleVerificationAction}
          >
            {verifAction === 'verified' ? 'Approve Supplier' : 'Reject Supplier'}
          </Button>,
        ]}
      >
        {verifAction === 'rejected' && (
          <Alert
            type="warning"
            showIcon
            message="Rejection requires a reason"
            description="Please provide a clear reason for rejection so the supplier can address the issues."
            style={{ marginBottom: 16 }}
          />
        )}
        <Form layout="vertical">
          <Form.Item
            label="Verification Notes"
            required={verifAction === 'rejected'}
            help={verifAction === 'rejected' ? 'Required: explain why the supplier is being rejected' : 'Optional notes about this decision'}
          >
            <Input.TextArea
              rows={3}
              value={verifNotes}
              onChange={e => setVerifNotes(e.target.value)}
              placeholder={verifAction === 'rejected'
                ? 'e.g. Missing mandatory Tax Compliance document (ZRA Tax Clearance). Please upload before re-applying.'
                : 'e.g. All documents verified and compliant with procurement standards'}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: Invite Supplier */}
      <Modal
        title={
          <Space>
            <UserAddOutlined style={{ color: '#1677ff' }} />
            <span>Invite Supplier</span>
          </Space>
        }
        open={inviteModalOpen}
        onCancel={() => { setInviteModalOpen(false); inviteForm.resetFields(); }}
        onOk={() => inviteForm.submit()}
        confirmLoading={inviteLoading}
      >
        <Form form={inviteForm} layout="vertical" onFinish={handleInviteSupplier}>
          <Form.Item name="email" label="Supplier Email" rules={[{ required: true, type: 'email' }]}>
            <Input size="large" placeholder="supplier@example.com" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
