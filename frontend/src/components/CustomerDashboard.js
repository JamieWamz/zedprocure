import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select,
  Space, Table, Tag, Typography, message, Card, Tabs, Progress, Popover,
  Badge, List, Empty, DatePicker, Tooltip
} from 'antd';
import {
  AuditOutlined, ClockCircleOutlined, FileTextOutlined, ReloadOutlined,
  SendOutlined, ShoppingCartOutlined, BellOutlined, CheckCircleOutlined,
  PlusOutlined, InfoCircleOutlined, DollarOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import DigitalSignatureModal from './DigitalSignatureModal';
import PaymentModal from './PaymentModal';
import { useAuth } from '../context/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import EnhancedEmpty from './EnhancedEmpty';
import ProgressSteps from './ProgressSteps';
import DashboardStatistic from './DashboardStatistic';
import NextActionPanel from './NextActionPanel';
import { getNotificationDestination, isActivationKey } from '../utils/notificationNavigation';
import RotatingMediaBanner from './RotatingMediaBanner';
import { cdnImages } from '../cdnAssets';
import ProcurementRequestDetails from './ProcurementRequestDetails';

const { Text } = Typography;
const { Option } = Select;

const customerSteps = [
  { title: 'Tell us what you need', description: 'Choose an open bid or send a new request.' },
  { title: 'Procurement review', description: 'The procurement team checks the scope and prepares the bid.' },
  { title: 'Supplier selection', description: 'Qualified responses are reviewed and an order is awarded.' },
  { title: 'Delivery and payment', description: 'Track delivery, approve completion, and release protected payment.' },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: 'mtn', label: 'MTN Mobile Money (MoMo)' },
  { value: 'airtel', label: 'Airtel Money' },
  { value: 'zamtel', label: 'Zamtel Kwacha' },
  { value: 'bank_transfer', label: 'Bank Transfer (Zanaco / Stanbic / FNB)' },
  { value: 'escrow', label: 'Direct Escrow Account' },
];

const REQUEST_CATEGORIES = [
  'Construction & Infrastructure', 'ICT & Software', 'Healthcare & Medical',
  'Agriculture & Food', 'Transport & Logistics', 'Education & Training',
  'Professional Services', 'Manufacturing', 'Energy & Utilities', 'Other',
];

function money(value) {
  return `ZMW ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusTag(inv) {
  if (inv.overdue) return <Tag color="error">Overdue</Tag>;
  const colors = {
    sent: 'processing',
    partially_paid: 'gold',
    paid: 'success',
    draft: 'default',
    cancelled: 'default',
  };
  return <Tag color={colors[inv.status] || 'default'}>{String(inv.status || '').replace('_', ' ')}</Tag>;
}

// Calculate order progress percentage
function getOrderProgress(status) {
  switch (status) {
    case 'pending_acceptance': return { percent: 15, status: 'active', label: 'Pending Supplier Acceptance', color: '#faad14' };
    case 'accepted': return { percent: 40, status: 'active', label: 'Accepted by Supplier', color: '#1677ff' };
    case 'delivery_in_progress': return { percent: 70, status: 'active', label: 'Delivery in Progress', color: '#13c2c2' };
    case 'delivered': return { percent: 88, status: 'active', label: 'Delivered — Pending Customer Sign-off', color: '#722ed1' };
    case 'completed': return { percent: 100, status: 'success', label: 'Completed & Funds Released', color: '#52c41a' };
    case 'disputed': return { percent: 50, status: 'exception', label: 'Order Disputed', color: '#ff4d4f' };
    default: return { percent: 10, status: 'active', label: 'Initiated', color: '#d9d9d9' };
  }
}

export default function CustomerDashboard() {
  const [loading, setLoading] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [procurementRequests, setProcurementRequests] = useState([]);
  const [summary, setSummary] = useState(null);
  const [signingInvoice, setSigningInvoice] = useState(null);
  const [signingOrder, setSigningOrder] = useState(null);
  const [payingOrder, setPayingOrder] = useState(null);
  const [createReqModal, setCreateReqModal] = useState(false);
  const [viewingRequest, setViewingRequest] = useState(null);
  const [activeTab, setActiveTab] = useState('bids_requirements');

  // Notifications state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const [form] = Form.useForm();
  const [reqForm] = Form.useForm();
  const [customerBids, setCustomerBids] = useState([]);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const openTab = useCallback((tab, focus) => {
    setActiveTab(tab);
    const params = new URLSearchParams({ tab });
    if (focus) params.set('focus', focus);
    navigate({ pathname: '/customer', search: `?${params.toString()}` });
    window.setTimeout(() => {
      const focusedRow = focus ? document.querySelector(`[data-row-key="${focus}"]`) : null;
      (focusedRow || document.getElementById('customer-workspace-tabs'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [navigate]);

  const loadPortal = useCallback(async () => {
    setInvoiceLoading(true);
    try {
      const [invoiceRes, summaryRes, orderRes, reqRes] = await Promise.all([
        axios.get('/api/invoices?type=AR'),
        axios.get('/api/invoices/summary'),
        axios.get('/api/orders').catch(() => ({ data: [] })),
        axios.get('/api/procurement-requests').catch(() => ({ data: [] })),
      ]);
      setInvoices(invoiceRes.data);
      setSummary(summaryRes.data);
      setOrders(orderRes.data);
      setProcurementRequests(reqRes.data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load customer workspace');
    } finally {
      setInvoiceLoading(false);
    }

    if (user?.role === 'customer') {
      try {
        const bidsRes = await axios.get('/api/bids/my-tenant-bids');
        setCustomerBids(bidsRes.data);
      } catch (e) {
        setCustomerBids([]);
      }
    }
  }, [user]);

  const fetchNotifications = useCallback(async () => {
    try {
      const [notifRes, countRes] = await Promise.all([
        axios.get('/api/notifications').catch(() => ({ data: [] })),
        axios.get('/api/notifications/unread-count').catch(() => ({ data: { count: 0 } })),
      ]);
      setNotifications(notifRes.data);
      setUnreadCount(countRes.data.count);
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadPortal();
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadPortal, fetchNotifications]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    const focus = params.get('focus');
    if (['bids_requirements', 'procurement_requests', 'orders_escrow', 'invoices'].includes(requestedTab)) {
      setActiveTab(requestedTab);
      window.setTimeout(() => {
        const focusedRow = focus ? document.querySelector(`[data-row-key="${focus}"]`) : null;
        (focusedRow || document.getElementById('customer-workspace-tabs'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
    if (params.get('action') === 'new-request') setCreateReqModal(true);
  }, [location.search, orders.length, invoices.length, procurementRequests.length]);

  const markAsRead = async (id) => {
    try {
      await axios.put(`/api/notifications/${id}/read`);
      fetchNotifications();
    } catch (_) {}
  };

  const openNotification = async (item) => {
    await markAsRead(item.id);
    setNotifOpen(false);
    navigate(getNotificationDestination(item, user));
  };

  const onFinishRequirements = async (values) => {
    setLoading(true);
    try {
      await axios.post(`/api/bids/${values.bid_id}/requirements`, values);
      message.success('Requirements submitted! Business Admin has been notified.');
      const submittedBidId = values.bid_id;
      form.resetFields();
      form.setFieldValue('bid_id', submittedBidId);
      loadPortal();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to submit requirement');
    } finally {
      setLoading(false);
    }
  };

  const onFinishCustomRequest = async (values) => {
    setRequestLoading(true);
    try {
      const structuredDescription = `### Specifications
${values.description || 'No detailed specifications provided.'}

### Quantity & Unit of Measure
Quantity: ${values.quantity || 1} ${values.unit_of_measure || 'each'}

### Warranty & Support Requirements
${values.warranty || 'No specific warranty requirements.'}
`.trim();

      await axios.post('/api/procurement-requests', {
        title: values.title,
        description: structuredDescription,
        estimated_budget: values.estimated_budget,
        payment_method: values.payment_method,
        required_delivery_date: values.required_delivery_date
          ? values.required_delivery_date.hour(12).minute(0).second(0).millisecond(0).toISOString()
          : null,
        requirements: {
          specification: values.description,
          quantity: values.quantity,
          unit_of_measure: values.unit_of_measure,
          warranty: values.warranty || '',
          business_category: values.business_category || '',
        },
      });
      message.success('Procurement Request sent to Business Admin!');
      reqForm.resetFields();
      setCreateReqModal(false);
      loadPortal();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to submit procurement request');
    } finally {
      setRequestLoading(false);
    }
  };

  const handleUpdateOrderStatus = async (orderId, targetStatus) => {
    try {
      await axios.patch(`/api/orders/${orderId}/status`, { status: targetStatus });
      message.success(`Order updated to ${targetStatus.replace(/_/g, ' ')}`);
      loadPortal();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to update order status');
    }
  };

  const confirmReceiptAndRelease = async (row) => {
    try {
      if (row.status !== 'completed') {
        await axios.patch(`/api/orders/${row.id}/status`, { status: 'completed' });
      }
      await axios.post('/api/escrow/release', {
        order_id: row.id,
        reason: 'Buyer confirmed goods receipt',
      });
      message.success('Receipt confirmed. The supplier payout is now processing.');
      loadPortal();
    } catch (e) {
      message.error(e.response?.data?.error || 'Could not release protected payment');
      loadPortal();
    }
  };

  const notificationContent = (
    <div style={{ width: 360, maxHeight: 400, overflowY: 'auto' }}>
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
                description={<Text style={{ fontSize: 11, color: '#8c8c8c' }}>{item.message?.substring(0, 80)}</Text>}
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  const columns = [
    { title: 'Invoice #', dataIndex: 'invoice_no', render: value => <Text code>{value}</Text> },
    { title: 'Due Date', dataIndex: 'due_date', render: (value, row) => <Text type={row.overdue ? 'danger' : undefined}>{value}</Text> },
    { title: 'Total', dataIndex: 'total_amount', render: value => money(value) },
    { title: 'Paid', dataIndex: 'paid_amount', render: value => money(value) },
    { title: 'Balance', render: (_, row) => money(Number(row.total_amount) - Number(row.paid_amount)) },
    { title: 'Status', render: (_, row) => statusTag(row) },
    { title: 'Action', render: (_, row) => <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningInvoice(row)}>Sign</Button> },
  ];

  const bidColumns = [
    { title: 'Bid Title', dataIndex: 'title', key: 'title', render: (v) => <Text strong>{v}</Text> },
    { title: 'Deadline', dataIndex: 'deadline', key: 'deadline', render: v => new Date(v).toLocaleString() },
    { title: 'Action', key: 'action', render: (_, row) => (
      <Space size="small">
        <Button size="small" onClick={() => navigate(`/customer/bids/${row.id}`)}>View Details</Button>
        <Button size="small" type="primary" onClick={() => {
          form.setFieldsValue({ bid_id: row.id });
          document.getElementById('requirements-section')?.scrollIntoView({ behavior: 'smooth' });
        }}>Set Requirements</Button>
      </Space>
    )},
  ];

  const orderColumns = [
    { title: 'Order', dataIndex: 'id', render: value => <Text code>{value.slice(0, 8)}</Text> },
    { title: 'Supplier', dataIndex: 'supplier_name', render: value => value || '-' },
    { title: 'Total', dataIndex: 'total_amount', render: value => money(value) },
    {
      title: 'Fulfillment Stage',
      key: 'progress',
      width: 220,
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
      title: 'Payment protection',
      render: (_, row) => {
        const state = row.escrow_state || row.escrow_status || 'not funded';
        const color = ['HELD_IN_ESCROW', 'RELEASED', 'funded', 'released'].includes(state)
          ? 'success'
          : ['DISPUTED', 'FAILED', 'disputed'].includes(state) ? 'error' : 'warning';
        return <Tag color={color}>{String(state).replace(/_/g, ' ').toLowerCase()}</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningOrder(row)}>Sign</Button>
          {!['funded', 'released'].includes(row.escrow_status) && !['completed', 'disputed'].includes(row.status) && (
            <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => setPayingOrder(row)}>
              Pay securely
            </Button>
          )}
          {['delivered', 'completed'].includes(row.status) &&
            ['funded', 'HELD_IN_ESCROW'].includes(row.escrow_status || row.escrow_state) && (
            <Button size="small" type="primary" onClick={() => confirmReceiptAndRelease(row)}>
              Confirm receipt & release
            </Button>
          )}
          {['delivered', 'delivery_in_progress'].includes(row.status) &&
            !['funded', 'HELD_IN_ESCROW'].includes(row.escrow_status || row.escrow_state) && (
            <Button size="small" onClick={() => handleUpdateOrderStatus(row.id, 'completed')}>Complete Order</Button>
          )}
          {!['completed', 'pending_acceptance', 'disputed'].includes(row.status) && (
            <Button size="small" danger onClick={() => handleUpdateOrderStatus(row.id, 'disputed')}>Dispute</Button>
          )}
        </Space>
      ),
    },
  ];

  const requestColumns = [
    { title: 'Title', dataIndex: 'title', render: (v, row) => <Button type="link" className="table-record-link" onClick={() => setViewingRequest(row)}>{v}</Button> },
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
    { title: 'Submitted', dataIndex: 'created_at', render: v => new Date(v).toLocaleDateString() },
    { title: 'Action', render: (_, row) => <Button size="small" onClick={() => setViewingRequest(row)}>View details</Button> },
  ];

  const openRequirements = () => {
    openTab('bids_requirements');
    window.setTimeout(() => document.getElementById('requirements-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const actionableCustomerOrder = orders.find(order => !['completed', 'disputed'].includes(order.status));
  const customerName = user?.full_name?.trim().split(/\s+/)[0] || user?.email?.split('@')[0] || 'there';
  const nextAction = actionableCustomerOrder
    ? {
        title: 'Your order has a next step',
        description: 'Check delivery progress, payment protection, and any action waiting for you.',
        actionLabel: 'View my orders',
        onAction: () => openTab('orders_escrow'),
      }
    : customerBids.length > 0
      ? {
          title: 'An open bid is ready for your requirements',
          description: 'Choose the relevant bid and briefly explain what your organization needs.',
          actionLabel: 'Choose a bid',
          onAction: openRequirements,
        }
      : {
          title: 'What does your organization need?',
          description: 'Send a short request. The procurement team will review it and guide it through the bidding process.',
          actionLabel: 'Start a request',
          onAction: () => setCreateReqModal(true),
        };

  return (
    <div className="workspace-page">
      <RotatingMediaBanner
        images={cdnImages.customerHeroes}
        className="portal-welcome-header"
        imagePosition="center 52%"
        ariaLabel="Customer workspace overview"
      >
        <div>
          <Text className="portal-welcome-eyebrow">Customer workspace</Text>
          <h2>Welcome, {customerName}</h2>
          <p>Tell us what you need, then follow procurement, delivery and payment from one place.</p>
        </div>
        <div className="page-media-actions">
          <Popover content={notificationContent} title="Notifications" trigger="click" open={notifOpen} onOpenChange={setNotifOpen}>
            <Badge count={unreadCount} size="small" style={{ marginRight: 8 }}>
              <Button icon={<BellOutlined />} aria-label="Open notifications" />
            </Badge>
          </Popover>
          <Tooltip title="Refresh workspace">
            <Button icon={<ReloadOutlined />} onClick={loadPortal} loading={invoiceLoading} aria-label="Refresh workspace" />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateReqModal(true)}>
            Request something
          </Button>
        </div>
      </RotatingMediaBanner>

      <NextActionPanel {...nextAction} />

      {/* A short, task-focused overview. */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Requests submitted" value={procurementRequests.length} prefix={<SendOutlined />} path="/customer?tab=procurement_requests" />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Orders in progress" value={orders.filter(order => !['completed', 'disputed'].includes(order.status)).length} prefix={<ShoppingCartOutlined />} path="/customer?tab=orders_escrow" />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Amount due" value={money(summary?.ar?.open)} prefix={<FileTextOutlined />} path="/customer?tab=invoices" />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Overdue" value={money(summary?.ar?.overdue)} prefix={<ClockCircleOutlined />} color={Number(summary?.ar?.overdue || 0) > 0 ? '#b4232d' : '#267343'} path="/customer?tab=invoices" />
        </Col>
      </Row>

      <details className="portal-guide">
        <summary>
          <span>How does procurement work?</span>
          <Text type="secondary">See the four stages from request to delivery</Text>
        </summary>
        <div className="portal-guide-content">
          <ProgressSteps steps={customerSteps} current={orders.length > 0 ? 3 : customerBids.length > 0 ? 1 : 0} />
        </div>
      </details>

      {/* Main Tabbed Content */}
      <Tabs
        id="customer-workspace-tabs"
        activeKey={activeTab}
        onChange={openTab}
        className="workspace-tabs"
        items={[
          {
            key: 'bids_requirements',
            label: <span><FileTextOutlined /> Choose a bid</span>,
            children: customerBids.length === 0 ? (
              <Card className="portal-empty-card">
                <EnhancedEmpty
                  title="No open bids match your organization yet"
                  description="You do not need to wait. Send a request and the procurement team can prepare the right bid for you."
                  ctaText="Start a request"
                  onAction={() => setCreateReqModal(true)}
                />
              </Card>
            ) : (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card title="1. Choose an open bid" className="table-card" style={{ marginBottom: 16 }}>
                    <Table
                      rowKey="id"
                      dataSource={customerBids}
                      rowClassName={(record) => new URLSearchParams(location.search).get('focus') === record.id ? 'notification-focus-row' : ''}
                      columns={bidColumns}
                      pagination={{ pageSize: 5 }}
                      scroll={{ x: 500 }}
                    />
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card id="requirements-section" title="2. Explain what you need" className="table-card portal-form-card">
                    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Your budget guide stays private during supplier evaluation." />
                    <Form form={form} layout="vertical" onFinish={onFinishRequirements}>
                      <Form.Item name="bid_id" label="Open bid" rules={[{ required: true, message: 'Please select a bid' }]}>
                        <Select
                          showSearch
                          placeholder="Select a bid"
                          optionFilterProp="children"
                          filterOption={(input, option) =>
                            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                          }
                        >
                          {(customerBids || []).map(bid => (
                            <Option key={bid.id} value={bid.id}>
                              {bid.title} (Deadline: {new Date(bid.deadline).toLocaleDateString()})
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                      <Form.Item name="budget_amount" label="Budget guide (ZMW)" rules={[{ required: true, message: 'Enter the maximum budget available for this requirement' }]}>
                        <InputNumber min={0.01} precision={2} style={{ width: '100%' }} placeholder="e.g. 50000" />
                      </Form.Item>
                      <Form.Item name="expected_delivery_time" label="When do you need it? (optional)">
                        <Input placeholder="e.g. 14 business days" />
                      </Form.Item>

                      <Form.Item name="payment_method" label="How would you prefer to pay?" rules={[{ required: true, message: 'Please select a payment method' }]}>
                        <Select placeholder="Select preferred payment provider">
                          {PAYMENT_METHOD_OPTIONS.map(opt => (
                            <Option key={opt.value} value={opt.value}>
                              {opt.label}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>

                      <Form.Item name="certification_standards" label="Requirements and quality expectations" rules={[{ required: true, message: 'Please describe what you need' }]}>
                        <Input.TextArea rows={4} placeholder="Describe the item or service, important specifications, warranty needs, and any required standards." />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} disabled={!customerBids.length} icon={<SendOutlined />}>
                        Send requirements
                      </Button>
                    </Form>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'procurement_requests',
            label: <span><PlusOutlined /> My requests</span>,
            children: (
              <Card
                title="Requests sent to procurement"
                extra={
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateReqModal(true)}>
                    Start a request
                  </Button>
                }
              >
                <Text type="secondary" className="portal-section-intro">Use this when the available bids do not cover what your organization needs.</Text>
                <Table
                  rowKey="id"
                  dataSource={procurementRequests}
                  rowClassName={(record) => new URLSearchParams(location.search).get('focus') === record.id ? 'notification-focus-row' : ''}
                  columns={requestColumns}
                  pagination={{ pageSize: 5 }}
                  expandable={{
                    expandedRowRender: record => (
                      <div className="portal-expanded-record">
                        <p><strong>Request details</strong></p>
                        <div className="portal-expanded-copy">{record.description || 'No description provided.'}</div>
                        {record.required_delivery_date && (
                          <p>
                            <strong>Needed by:</strong> {new Date(record.required_delivery_date).toLocaleDateString()}
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
                  locale={{ emptyText: <EnhancedEmpty title="You have not sent a request yet" description="Start with a short description of what your organization needs." ctaText="Start a request" onAction={() => setCreateReqModal(true)} /> }}
                />
              </Card>
            ),
          },
          {
            key: 'orders_escrow',
            label: <span><ShoppingCartOutlined /> My orders</span>,
            children: (
              <Card title="Orders, delivery and protected payment" className="table-card">
                <Table
                  rowKey="id"
                  loading={invoiceLoading}
                  dataSource={orders}
                  rowClassName={(record) => new URLSearchParams(location.search).get('focus') === record.id ? 'notification-focus-row' : ''}
                  columns={orderColumns}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: 900 }}
                  locale={{ emptyText: <EnhancedEmpty title="No Orders Yet" description="Your awarded bids and orders will appear here once ready." /> }}
                />
              </Card>
            ),
          },
          {
            key: 'invoices',
            label: <span><FileTextOutlined /> Invoices</span>,
            children: (
              <Card title="My Invoices" className="table-card">
                <Table
                  rowKey="id"
                  loading={invoiceLoading}
                  dataSource={invoices}
                  rowClassName={(record) => new URLSearchParams(location.search).get('focus') === record.id ? 'notification-focus-row' : ''}
                  columns={columns}
                  pagination={{ pageSize: 8 }}
                  scroll={{ x: 720 }}
                  locale={{ emptyText: <EnhancedEmpty title="No Invoices Yet" description="Invoices will appear here once orders are billed." /> }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={
          <Space>
            <PlusOutlined style={{ color: '#0f6b5d' }} />
            <span>Tell us what you need</span>
          </Space>
        }
        open={createReqModal}
        onCancel={() => setCreateReqModal(false)}
        footer={null}
      >
        <Text type="secondary" className="portal-modal-intro">
          Give the procurement team enough detail to understand the request. Estimates can be approximate.
        </Text>
        <Form form={reqForm} layout="vertical" onFinish={onFinishCustomRequest} initialValues={{ quantity: 1, unit_of_measure: 'each' }}>
          <Form.Item name="title" label="What do you need?" rules={[{ required: true, message: 'Tell us what you need' }]}>
            <Input placeholder="e.g. Supply of 50 Laptops for Lusaka Office" />
          </Form.Item>
          
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="quantity" label="Quantity" rules={[{ required: true, message: 'Quantity is required' }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g. 50" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="unit_of_measure" label="Unit" rules={[{ required: true }]}>
                <Select placeholder="Select unit">
                  <Option value="each">Each / Piece</Option>
                  <Option value="boxes">Boxes</Option>
                  <Option value="kg">Kilograms (kg)</Option>
                  <Option value="liters">Liters</Option>
                  <Option value="lump_sum">Lump Sum</Option>
                  <Option value="hours">Hours</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="Describe the requirement" rules={[{ required: true, message: 'Please describe the requirement' }]}>
            <Input.TextArea rows={3} placeholder="Include important specifications, dimensions, preferred features, or service scope." />
          </Form.Item>

          <Form.Item name="business_category" label="Category (optional)">
            <Select placeholder="Select the closest category" allowClear>
              {REQUEST_CATEGORIES.map(category => <Option key={category} value={category}>{category}</Option>)}
            </Select>
          </Form.Item>

          <Form.Item name="warranty" label="Warranty or support needed (optional)">
            <Input placeholder="e.g. 1 Year Local Warranty and onsite support" />
          </Form.Item>

          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="estimated_budget" label="Budget estimate (ZMW)">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="e.g. 150000" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="payment_method" label="Preferred payment" rules={[{ required: true }]}>
                <Select placeholder="Select method">
                  {PAYMENT_METHOD_OPTIONS.map(opt => (
                    <Option key={opt.value} value={opt.value}>{opt.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="required_delivery_date"
            label="Needed by (optional)"
            extra="This date becomes the delivery target when procurement creates the bid."
          >
            <DatePicker style={{ width: '100%' }} disabledDate={date => date && date.endOf('day').isBefore(new Date())} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={requestLoading} block icon={<SendOutlined />}>
              Send request
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Procurement request details"
        open={Boolean(viewingRequest)}
        onCancel={() => setViewingRequest(null)}
        footer={<Button type="primary" onClick={() => setViewingRequest(null)}>Done</Button>}
        width={760}
      >
        <ProcurementRequestDetails request={viewingRequest} />
      </Modal>

      {/* Modals for Signatures, Mobile Payments, Manual Escrow */}
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
        documentLabel={signingOrder ? `Order ${signingOrder.id.slice(0, 8)} with ${signingOrder.supplier_name || 'supplier'}` : ''}
      />
      <PaymentModal
        open={!!payingOrder}
        onClose={() => setPayingOrder(null)}
        orderId={payingOrder?.id}
        amount={payingOrder?.total_amount}
        procurementAmount={payingOrder?.buyer_price}
        buyerProtectionFee={payingOrder?.buyer_protection_fee}
        expressMatchFee={payingOrder?.express_match_fee}
        orderLabel={payingOrder ? `Order ${payingOrder.id?.slice(0, 8)} — ${payingOrder.supplier_name || 'Supplier'}` : ''}
        onSuccess={() => { setPayingOrder(null); loadPortal(); }}
      />
    </div>
  );
}
