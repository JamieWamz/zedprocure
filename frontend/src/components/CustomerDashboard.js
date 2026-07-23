import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select,
  Space, Table, Tag, Typography, message, Card
} from 'antd';
import {
  AuditOutlined, BankOutlined, ClockCircleOutlined, FileTextOutlined, ReloadOutlined,
  SendOutlined, ShoppingCartOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';
import DigitalSignatureModal from './DigitalSignatureModal';
import PaymentModal from './PaymentModal';
import { useAuth } from '../context/AuthContext';
import EnhancedEmpty from './EnhancedEmpty';
import ProgressSteps from './ProgressSteps';
import DashboardStatistic from './DashboardStatistic';

const { Text } = Typography;

const customerSteps = [
  {
    title: 'Select Bid',
    description: 'Choose an open bid for your organization.',
  },
  {
    title: 'Set Requirements',
    description: 'Provide budget, delivery, and payment details.',
  },
  {
    title: 'Submit',
    description: 'Submit your requirements for evaluation.',
  },
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

export default function CustomerDashboard() {
  const [loading, setLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [signingInvoice, setSigningInvoice] = useState(null);
  const [signingOrder, setSigningOrder] = useState(null);
  const [payingOrder, setPayingOrder] = useState(null);
  const [fundingOrder, setFundingOrder] = useState(null);
  const [form] = Form.useForm();
  const [fundForm] = Form.useForm();
  const [customerBids, setCustomerBids] = useState([]);
  const { user } = useAuth();

  const loadPortal = useCallback(async () => {
    setInvoiceLoading(true);
    try {
      const [invoiceRes, summaryRes, orderRes] = await Promise.all([
        axios.get('/api/invoices?type=AR'),
        axios.get('/api/invoices/summary'),
        axios.get('/api/orders').catch(() => ({ data: [] })),
      ]);
      setInvoices(invoiceRes.data);
      setSummary(summaryRes.data);
      setOrders(orderRes.data);
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
        message.error(e.response?.data?.error || 'Failed to load available bids');
      }
    }
  }, [user]);

  useEffect(() => { loadPortal(); }, [loadPortal]);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await axios.post(`/api/bids/${values.bid_id}/requirements`, values);
      message.success('Requirement submitted');
      // Keep the form ready for a new requirement rather than accidentally re-submitting it.
      const submittedBidId = values.bid_id;
      form.resetFields();
      form.setFieldValue('bid_id', submittedBidId);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
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
      message.success('Escrow funded');
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
      message.success(`Order status updated to ${targetStatus}`);
      loadPortal();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to update order status');
    }
  };

  const columns = [
    { title: 'Invoice #', dataIndex: 'invoice_no', render: value => <Text code>{value}</Text> },
    { title: 'Due', dataIndex: 'due_date', render: (value, row) => <Text type={row.overdue ? 'danger' : undefined}>{value}</Text> },
    { title: 'Total', dataIndex: 'total_amount', render: value => money(value) },
    { title: 'Paid', dataIndex: 'paid_amount', render: value => money(value) },
    { title: 'Balance', render: (_, row) => money(Number(row.total_amount) - Number(row.paid_amount)) },
    { title: 'Status', render: (_, row) => statusTag(row) },
    { title: 'Action', render: (_, row) => <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningInvoice(row)}>Sign</Button> },
  ];

  const bidColumns = [
    { title: 'Bid Title', dataIndex: 'title', key: 'title', render: (v, row) => <Text strong>{v}</Text> },
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
    { title: 'Status', dataIndex: 'status', render: value => <Tag>{String(value).replaceAll('_', ' ')}</Tag> },
    {
      title: 'Escrow',
      render: (_, row) => <Tag color={row.escrow_status === 'funded' || row.escrow_status === 'released' ? 'success' : 'warning'}>{row.escrow_status || 'not funded'}</Tag>,
    },
    {
      title: 'Actions',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningOrder(row)}>Sign</Button>
          {row.escrow_status !== 'funded' && row.escrow_status !== 'released' && !['completed', 'disputed'].includes(row.status) && (
            <>
              <Button size="small" type="primary" icon={<BankOutlined />} onClick={() => setPayingOrder(row)}>
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

  return (
    <div>
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.customer})` }}>
        <div>
          <h2>Customer Portal</h2>
          <p>Submit procurement requirements and track invoices, balances and due dates in one workspace.</p>
        </div>
        <div className="page-media-actions">
          <Button icon={<ReloadOutlined />} onClick={loadPortal} loading={invoiceLoading}>Refresh</Button>
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <DashboardStatistic title="Open Balance" value={money(summary?.ar?.open)} prefix={<FileTextOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <DashboardStatistic title="Overdue" value={money(summary?.ar?.overdue)} prefix={<ClockCircleOutlined />} color={Number(summary?.ar?.overdue || 0) > 0 ? '#cf1322' : '#389e0d'} />
        </Col>
        <Col xs={24} md={8}>
          <DashboardStatistic title="Paid This Month" value={money(summary?.paidThisMonth)} color="#389e0d" />
        </Col>
        <Col xs={24} md={8}>
          <DashboardStatistic title="Orders" value={orders.length} prefix={<ShoppingCartOutlined />} />
        </Col>
      </Row>

      {/* Available Bids Section */}
      <Card title={<span><FileTextOutlined /> Open Bids for Your Organization</span>} className="table-card" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          dataSource={customerBids}
          columns={bidColumns}
          pagination={{ pageSize: 5 }}
          scroll={{ x: 600 }}
          locale={{ emptyText: <EnhancedEmpty title="No Open Bids" description="There are no open bids for your organization yet. Business Admin creates bids that you can set requirements on." /> }}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card id="requirements-section" title="Submit Requirements" className="table-card">
            <div style={{ marginBottom: 24 }}>
              <ProgressSteps steps={customerSteps} current={0} />
            </div>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Budgets remain hidden from suppliers during bid evaluation." />
            <Form form={form} layout="vertical" onFinish={onFinish}>
              <Form.Item name="bid_id" label="Bid" rules={[{ required: true, message: 'Please select a bid' }]}>
                <Select
                  showSearch
                  placeholder="Select a bid"
                  optionFilterProp="children"
                  filterOption={(input, option) =>
                    option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                  }
                >
                  {customerBids.map(bid => (
                    <Select.Option key={bid.id} value={bid.id}>
                      {bid.title} (Deadline: {new Date(bid.deadline).toLocaleDateString()})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item name="budget_amount" label="Budget (ZMW)">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="expected_delivery_time" label="Expected Delivery">
                <Input placeholder="e.g. 14 days" />
              </Form.Item>
              <Form.Item name="payment_method" label="Payment Method">
                <Input placeholder="Bank transfer, mobile money, escrow" />
              </Form.Item>
              <Form.Item name="certification_standards" label="Certification Standards">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} disabled={!customerBids.length} icon={<SendOutlined />}>Submit Requirement</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Orders & Escrow" className="table-card" style={{ marginBottom: 16 }}>
            <Table
              rowKey="id"
              loading={invoiceLoading}
              dataSource={orders}
              columns={orderColumns}
              pagination={{ pageSize: 5 }}
              scroll={{ x: 820 }}
              locale={{ emptyText: <EnhancedEmpty title="No Orders Yet" description="Your awarded bids and orders will appear here." ctaText="Browse Public Bids" ctaPath="/public/bids" /> }}
            />
          </Card>
          <Card title="My Invoices" className="table-card">
            <Table
              rowKey="id"
              loading={invoiceLoading}
              dataSource={invoices}
              columns={columns}
              pagination={{ pageSize: 6 }}
              scroll={{ x: 720 }}
              locale={{ emptyText: <EnhancedEmpty title="No Invoices Yet" description="Invoices will appear here once orders are fulfilled and billed." /> }}
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
            <InputNumber disabled min={0.01} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="payment_method" label="Payment Method" rules={[{ required: true }]}>
            <Select options={[{ value: 'bank_transfer', label: 'Bank Transfer' }, { value: 'mobile_money', label: 'Mobile Money' }]} />
          </Form.Item>
          <Form.Item name="transaction_ref" label="Transaction Reference">
            <Input placeholder="Optional bank/mobile money reference" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
