import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Spin, Alert, Tabs, Progress, Tooltip, Button, Modal, Form, Input, message, List, Typography, Badge, Popover, Empty, Space } from 'antd';
import {
  DollarOutlined, RiseOutlined, FallOutlined, SafetyCertificateOutlined,
  FileTextOutlined, TeamOutlined, BankOutlined, ShoppingCartOutlined,
  ArrowUpOutlined, ArrowDownOutlined, WalletOutlined, SendOutlined,
  ReloadOutlined, CreditCardOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, BellOutlined, CheckOutlined, CloseOutlined,
  FlagOutlined, TrophyOutlined, UserSwitchOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReChartTooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { cdnImages } from '../cdnAssets';

const { Text } = Typography;

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

  // ─── Verification Queue State ─────────────────────────────────────────────
  const [verificationQueue, setVerificationQueue] = useState([]);
  const [verifLoading, setVerifLoading] = useState(false);
  const [verifModalVisible, setVerifModalVisible] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [verifAction, setVerifAction] = useState(null); // 'verified' or 'rejected'
  const [verifNotes, setVerifNotes] = useState('');
  const [verifSubmitting, setVerifSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryRes, walletRes] = await Promise.all([
        axios.get('/api/dashboard/summary'),
        axios.get('/api/wallet').catch(() => ({ data: { balance: '0.00', transactions: [] } })),
      ]);
      setData(summaryRes.data);
      setWallet(walletRes.data);
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

  const markAsRead = async (id) => {
    await axios.put(`/api/notifications/${id}/read`);
    fetchNotifications();
  };

  const markAllRead = async () => {
    await axios.put('/api/notifications/read-all');
    fetchNotifications();
  };

  const notificationContent = (
    <div style={{ width: 360, maxHeight: 400, overflowY: 'auto' }}>
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

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" message={error} showIcon style={{ margin: 24 }} />;
  if (!data) return null;

  const { revenue, outstanding, stats, monthlyRevenue, escrowSummary, recentTransactions, invoices = {}, procurement = {} } = data;
  const invoiceCounts = invoices.counts || {};
  const bidPipeline = procurement.bidPipeline || [];
  const orderPipeline = procurement.orderPipeline || [];
  const urgentBids = procurement.urgentBids || [];
  const topSuppliers = procurement.topSuppliers || [];

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

  return (
    <div>
      {/* Page Header with Wallet */}
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.admin})` }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Business Dashboard</h2>
          <p>Financial overview, invoice controls, cash movement and platform procurement metrics.</p>
        </div>
        <div className="page-media-actions">
          <Popover content={notificationContent} title="Notifications" trigger="click"
            open={notifOpen} onOpenChange={setNotifOpen}>
            <Badge count={unreadCount} size="small" style={{ marginRight: 8 }}>
              <Button icon={<BellOutlined />} />
            </Badge>
          </Popover>
          <Button icon={<ReloadOutlined />} onClick={fetchData} style={{ marginRight: 12 }}>Refresh</Button>
          <Button icon={<FileTextOutlined />} onClick={() => navigate('/admin/invoices')}>Invoices</Button>
          <Button icon={<DollarOutlined />} onClick={() => navigate('/admin/ledger')}>Ledger</Button>
          <Button type="primary" icon={<WalletOutlined />} onClick={() => setWalletModal(true)}>
            Wallet: ZMW {wallet?.balance || '0.00'}
          </Button>
        </div>
      </div>

      {/* Revenue & Profit Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff' }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>Total Revenue</span>}
              value={parseFloat(revenue.total)} prefix={<DollarOutlined />} suffix="ZMW"
              valueStyle={{ color: '#fff', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', color: '#fff' }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>Expenses</span>}
              value={parseFloat(revenue.expenses)} prefix={<FallOutlined />} suffix="ZMW"
              valueStyle={{ color: '#fff', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" style={{ background: `linear-gradient(135deg, ${parseFloat(revenue.netProfit) >= 0 ? '#11998e' : '#eb3349'} 0%, ${parseFloat(revenue.netProfit) >= 0 ? '#38ef7d' : '#f45c43'} 100%)`, color: '#fff' }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>Net Profit</span>}
              value={parseFloat(revenue.netProfit)} prefix={<ProfitIcon />} suffix="ZMW"
              valueStyle={{ color: '#fff', fontWeight: 700, fontSize: 28 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="stat-card" style={{ background: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)', color: '#fff' }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>Profit Margin</span>}
              value={parseFloat(revenue.profitMargin)} precision={1} suffix="%"
              valueStyle={{ color: '#fff', fontWeight: 700 }} />
            <Progress percent={Math.min(parseFloat(revenue.profitMargin), 100)} showInfo={false}
              strokeColor="#fff" trailColor="rgba(255,255,255,0.3)" style={{ marginTop: 8 }} />
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
                      <stop offset="5%" stopColor="#667eea" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#667eea" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <ReChartTooltip formatter={(v) => [`ZMW ${parseFloat(v).toLocaleString()}`, 'Revenue']} />
                  <Area type="monotone" dataKey="revenue" stroke="#667eea" fill="url(#revenueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Alert type="info" message="No revenue data yet. Revenue will appear as journal entries are created." showIcon />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span><ExclamationCircleOutlined /> Outstanding Payments</span>} className="stat-card"
            style={{ background: 'linear-gradient(135deg, #faad14 0%, #f5222d 100%)', color: '#fff', height: '100%' }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>Pending Escrow</span>}
              value={parseFloat(outstanding.total)} prefix={<ClockCircleOutlined />} suffix="ZMW"
              valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }} />
            <div style={{ marginTop: 16, color: 'rgba(255,255,255,0.9)' }}>
              {outstanding.count} payment{outstanding.count !== 1 ? 's' : ''} awaiting settlement
            </div>
            {escrowSummary && Object.entries(escrowSummary).map(([status, info]) => (
              <div key={status} style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
                <span style={{ textTransform: 'capitalize' }}>{status.replace('_', ' ')}</span>
                <span>{info.count} · ZMW {parseFloat(info.total).toLocaleString()}</span>
              </div>
            ))}
          </Card>
        </Col>
      </Row>

      {/* Business Summary Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable>
            <Statistic title="Total Bids" value={stats.totalBids} prefix={<FileTextOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable>
            <Statistic title="Active Bids" value={stats.activeBids} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable>
            <Statistic title="Verified Suppliers" value={stats.verifiedSuppliers} prefix={<SafetyCertificateOutlined />} valueStyle={{ color: '#52c41a' }} />
            <Text type={Number(stats.pendingSuppliers || 0) ? 'warning' : 'secondary'}>
              {stats.pendingSuppliers || 0} pending review
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable>
            <Statistic title="Total Orders" value={stats.totalOrders} prefix={<ShoppingCartOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable>
            <Statistic title="Completed" value={stats.completedOrders} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
            <Text type={Number(stats.disputedOrders || 0) ? 'danger' : 'secondary'}>
              {stats.disputedOrders || 0} disputed
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable>
            <Statistic title="Users" value={stats.platformUsers} prefix={<TeamOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable>
            <Statistic title="Organizations" value={stats.organizations} prefix={<BankOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={3}>
          <Card className="stat-card" hoverable
            onClick={() => navigate('/admin/ledger')} style={{ cursor: 'pointer' }}>
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
                  <List.Item>
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
                    <Tag color={item.status === 'disputed' ? 'error' : item.status === 'completed' ? 'success' : 'processing'}>
                      {item.status === 'disputed' ? 'Action' : 'Track'}
                    </Tag>
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
    </div>
  );
}
