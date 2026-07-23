import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select,
  Space, Table, Tag, Typography, message, Card, Tabs, Progress, Popover,
  Badge, List, Empty, DatePicker, Tooltip
} from 'antd';
import {
  AuditOutlined, BankOutlined, ClockCircleOutlined, FileTextOutlined, ReloadOutlined,
  SendOutlined, ShoppingCartOutlined, BellOutlined, CheckCircleOutlined,
  PlusOutlined, InfoCircleOutlined, DollarOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';
import DigitalSignatureModal from './DigitalSignatureModal';
import PaymentModal from './PaymentModal';
import { useAuth } from '../context/AuthContext';
import EnhancedEmpty from './EnhancedEmpty';
import ProgressSteps from './ProgressSteps';
import DashboardStatistic from './DashboardStatistic';

const { Text, Title } = Typography;
const { Option } = Select;

const customerSteps = [
  { title: '1. Select/Create Request', description: 'Pick a bid or submit a procurement request.' },
  { title: '2. Define Requirements', description: 'Specify budget, delivery date, & payment method.' },
  { title: '3. Admin & Supplier Review', description: 'Business Admin reviews & invites suppliers.' },
  { title: '4. Award & Fund Escrow', description: 'Award bid & fund escrow via Mobile Money/Bank.' },
  { title: '5. Delivery & Completion', description: 'Receive goods, inspect, & release payment.' },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: 'mtn', label: 'MTN Mobile Money (MoMo)' },
  { value: 'airtel', label: 'Airtel Money' },
  { value: 'zamtel', label: 'Zamtel Kwacha' },
  { value: 'bank_transfer', label: 'Bank Transfer (Zanaco / Stanbic / FNB)' },
  { value: 'escrow', label: 'Direct Escrow Account' },
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
  const [fundingOrder, setFundingOrder] = useState(null);
  const [createReqModal, setCreateReqModal] = useState(false);

  // Notifications state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const [form] = Form.useForm();
  const [fundForm] = Form.useForm();
  const [reqForm] = Form.useForm();
  const [customerBids, setCustomerBids] = useState([]);
  const { user } = useAuth();

  const loadPortal = useCallback(async () => {
    setInvoiceLoading(true);
    try {
      const [invoiceRes, summaryRes, orderRes, reqRes] = await Promise.all([
        axios.get('/api/invoices?type=AR'),
        axios.get('/api/invoices/summary'),
        axios.get('/api/orders').catch(() => ({ data: [] })),
        axios.get('/api/customer/procurement-requests').catch(() => ({ data: [] })),
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
        const bidsRes = await axios.get('/api/bids/tenant');
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

  const markAsRead = async (id) => {
    try {
      await axios.put(`/api/notifications/${id}/read`);
      fetchNotifications();
    } catch (_) {}
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

      await axios.post('/api/customer/procurement-requests', {
        title: values.title,
        description: structuredDescription,
        estimated_budget: values.estimated_budget,
        payment_method: values.payment_method,
        required_delivery_date: values.required_delivery_date ? values.required_delivery_date.toISOString() : null,
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

  const submitEscrowFunding = async () => {
    if (!fundingOrder) return;
    try {
      const values = await fundForm.validateFields();
      await axios.post('/api/escrow/fund', {
        order_id: fundingOrder.id,
        amount: values.amount,
        payment_method: values.payment_method,
        transaction_ref: values.transaction_ref || `ESC-${Date.now()}-${fundingOrder.id.slice(0, 6)}`,
      });
      message.success('Escrow funded successfully');
      setFundingOrder(null);
      fundForm.resetFields();
      loadPortal();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to fund escrow');
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
              style={{ background: item.is_read ? 'transparent' : '#f0f5ff', cursor: 'pointer' }}
              onClick={() => { markAsRead(item.id); setNotifOpen(false); }}
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
      <Button size="small" type="primary" onClick={() => {
        form.setFieldsValue({ bid_id: row.id });
        document.getElementById('requirements-section')?.scrollIntoView({ behavior: 'smooth' });
      }}>Set Requirements</Button>
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
      title: 'Escrow Status',
      render: (_, row) => <Tag color={['funded', 'released'].includes(row.escrow_status) ? 'success' : 'warning'}>{row.escrow_status || 'not funded'}</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningOrder(row)}>Sign</Button>
          {!['funded', 'released'].includes(row.escrow_status) && !['completed', 'disputed'].includes(row.status) && (
            <>
              <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => setPayingOrder(row)}>
                Pay Now
              </Button>
              <Button size="small" icon={<BankOutlined />} onClick={() => {
                fundForm.setFieldsValue({ amount: Number(row.total_amount), payment_method: 'bank_transfer' });
                setFundingOrder(row);
              }}>Manual Escrow</Button>
            </>
          )}
          {['delivered', 'delivery_in_progress'].includes(row.status) && (
            <Button size="small" type="primary" onClick={() => handleUpdateOrderStatus(row.id, 'completed')}>Complete Order</Button>
          )}
          {!['completed', 'pending_acceptance', 'disputed'].includes(row.status) && (
            <Button size="small" danger onClick={() => handleUpdateOrderStatus(row.id, 'disputed')}>Dispute</Button>
          )}
        </Space>
      ),
    },
  ];

  const requestColumns = [
    { title: 'Title', dataIndex: 'title', render: v => <Text strong>{v}</Text> },
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
  ];

  return (
    <div>
      {/* Media Banner Header */}
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.customer})` }}>
        <div>
          <h2>Customer Portal</h2>
          <p>Submit procurement requirements, track orders, fund escrow via Mobile Money or Bank, and view digital signatures.</p>
        </div>
        <div className="page-media-actions">
          <Popover content={notificationContent} title="Notifications" trigger="click" open={notifOpen} onOpenChange={setNotifOpen}>
            <Badge count={unreadCount} size="small" style={{ marginRight: 8 }}>
              <Button icon={<BellOutlined />} />
            </Badge>
          </Popover>
          <Button icon={<ReloadOutlined />} onClick={loadPortal} loading={invoiceLoading}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateReqModal(true)}>
            New Procurement Request
          </Button>
        </div>
      </div>

      {/* Key Metrics Summary Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Open Balance" value={money(summary?.ar?.open)} prefix={<FileTextOutlined />} />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Overdue" value={money(summary?.ar?.overdue)} prefix={<ClockCircleOutlined />} color={Number(summary?.ar?.overdue || 0) > 0 ? '#cf1322' : '#389e0d'} />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Paid This Month" value={money(summary?.paidThisMonth)} color="#389e0d" />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <DashboardStatistic title="Active Orders" value={orders.length} prefix={<ShoppingCartOutlined />} color="#1677ff" />
        </Col>
      </Row>

      {/* Workflow Stage Steps Progress */}
      <Card style={{ marginBottom: 20 }}>
        <Title level={5} style={{ marginBottom: 12 }}>Procurement Lifecycle Progress</Title>
        <ProgressSteps steps={customerSteps} current={orders.length > 0 ? 3 : customerBids.length > 0 ? 1 : 0} />
      </Card>

      {/* Main Tabbed Content */}
      <Tabs
        defaultActiveKey="bids_requirements"
        items={[
          {
            key: 'bids_requirements',
            label: <span><FileTextOutlined /> Bids & Requirements</span>,
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card title="Open Bids for Your Organization" className="table-card" style={{ marginBottom: 16 }}>
                    <Table
                      rowKey="id"
                      dataSource={customerBids}
                      columns={bidColumns}
                      pagination={{ pageSize: 5 }}
                      scroll={{ x: 500 }}
                      locale={{ emptyText: <EnhancedEmpty title="No Open Bids" description="There are no open bids for your organization yet. Submit a custom procurement request below." /> }}
                    />
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card id="requirements-section" title="Set Requirements for Selected Bid" className="table-card">
                    <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Budgets remain hidden from suppliers during bid evaluation for fairness." />
                    <Form form={form} layout="vertical" onFinish={onFinishRequirements}>
                      <Form.Item name="bid_id" label="Select Bid" rules={[{ required: true, message: 'Please select a bid' }]}>
                        <Select
                          showSearch
                          placeholder="Select a bid"
                          optionFilterProp="children"
                          filterOption={(input, option) =>
                            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                          }
                        >
                          {customerBids.map(bid => (
                            <Option key={bid.id} value={bid.id}>
                              {bid.title} (Deadline: {new Date(bid.deadline).toLocaleDateString()})
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                      <Form.Item name="budget_amount" label="Budget Amount (ZMW)">
                        <InputNumber min={0} style={{ width: '100%' }} placeholder="e.g. 50000" />
                      </Form.Item>
                      <Form.Item name="expected_delivery_time" label="Expected Delivery Timeline">
                        <Input placeholder="e.g. 14 business days" />
                      </Form.Item>

                      {/* Payment Method Dropdown */}
                      <Form.Item name="payment_method" label="Preferred Payment Method" rules={[{ required: true, message: 'Please select a payment method' }]}>
                        <Select placeholder="Select preferred payment provider">
                          {PAYMENT_METHOD_OPTIONS.map(opt => (
                            <Option key={opt.value} value={opt.value}>
                              {opt.label}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>

                      <Form.Item name="certification_standards" label="Detailed Technical Specifications & Quality Standards" rules={[{ required: true, message: 'Please provide detailed specifications and quality standards' }]}>
                        <Input.TextArea rows={4} placeholder="Please provide specific detailed specifications, warranty duration, and quality standards (e.g. ISO 9001, ZBS standards, etc.) to ensure suppliers have clear guidelines." />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} disabled={!customerBids.length} icon={<SendOutlined />}>
                        Submit Requirements to Admin
                      </Button>
                    </Form>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'procurement_requests',
            label: <span><PlusOutlined /> Direct Procurement Requests</span>,
            children: (
              <Card
                title="My Custom Procurement Requests"
                extra={
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateReqModal(true)}>
                    New Request
                  </Button>
                }
              >
                <Alert
                  type="info"
                  showIcon
                  message="Submit a custom procurement request directly to Business Admin when there are no open bids matching your needs."
                  style={{ marginBottom: 16 }}
                />
                <Table
                  rowKey="id"
                  dataSource={procurementRequests}
                  columns={requestColumns}
                  pagination={{ pageSize: 5 }}
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
                  locale={{ emptyText: <EnhancedEmpty title="No Requests Yet" description="Submit your first procurement request to Business Admin." /> }}
                />
              </Card>
            ),
          },
          {
            key: 'orders_escrow',
            label: <span><ShoppingCartOutlined /> Orders & Escrow</span>,
            children: (
              <Card title="Orders & Escrow Funding" className="table-card">
                <Table
                  rowKey="id"
                  loading={invoiceLoading}
                  dataSource={orders}
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
            label: <span><FileTextOutlined /> Invoices & Signatures</span>,
            children: (
              <Card title="My Invoices" className="table-card">
                <Table
                  rowKey="id"
                  loading={invoiceLoading}
                  dataSource={invoices}
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

      {/* Modal: Create Custom Procurement Request */}
      <Modal
        title={
          <Space>
            <PlusOutlined style={{ color: '#1677ff' }} />
            <span>Create Custom Procurement Request</span>
          </Space>
        }
        open={createReqModal}
        onCancel={() => setCreateReqModal(false)}
        footer={null}
      >
        <Form form={reqForm} layout="vertical" onFinish={onFinishCustomRequest} initialValues={{ quantity: 1, unit_of_measure: 'each' }}>
          <Form.Item name="title" label="Request Title / Item Required" rules={[{ required: true, message: 'Title is required' }]}>
            <Input placeholder="e.g. Supply of 50 Laptops for Lusaka Office" />
          </Form.Item>
          
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="quantity" label="Quantity" rules={[{ required: true, message: 'Quantity is required' }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="e.g. 50" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="unit_of_measure" label="Unit of Measure" rules={[{ required: true }]}>
                <Select placeholder="Select UoM">
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

          <Form.Item name="description" label="Detailed Technical Specifications" rules={[{ required: true, message: 'Specifications are required' }]}>
            <Input.TextArea rows={3} placeholder="Provide technical specifications, dimensions, brand preferences, etc." />
          </Form.Item>

          <Form.Item name="warranty" label="Warranty & Support Requirement">
            <Input placeholder="e.g. 1 Year Local Warranty and onsite support" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="estimated_budget" label="Estimated Budget (ZMW)">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="e.g. 150000" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="payment_method" label="Payment Method" rules={[{ required: true }]}>
                <Select placeholder="Select method">
                  {PAYMENT_METHOD_OPTIONS.map(opt => (
                    <Option key={opt.value} value={opt.value}>{opt.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="required_delivery_date" label="Required Delivery Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={requestLoading} block icon={<SendOutlined />}>
              Send Procurement Request to Business Admin
            </Button>
          </Form.Item>
        </Form>
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
        orderLabel={payingOrder ? `Order ${payingOrder.id?.slice(0, 8)} — ${payingOrder.supplier_name || 'Supplier'}` : ''}
        onSuccess={() => { setPayingOrder(null); loadPortal(); }}
      />
      <Modal
        title={fundingOrder ? `Fund Escrow for Order ${fundingOrder.id.slice(0, 8)}` : 'Fund Escrow'}
        open={!!fundingOrder}
        onCancel={() => setFundingOrder(null)}
        onOk={submitEscrowFunding}
      >
        <Form form={fundForm} layout="vertical">
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Funds are held in escrow until Business Admin releases payment after fulfillment." />
          <Form.Item name="amount" label="Amount (ZMW)" rules={[{ required: true }]}>
            <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="payment_method" label="Payment Method" rules={[{ required: true }]}>
            <Select options={PAYMENT_METHOD_OPTIONS} />
          </Form.Item>
          <Form.Item name="transaction_ref" label="Transaction Reference">
            <Input placeholder="Optional bank/mobile money reference" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
