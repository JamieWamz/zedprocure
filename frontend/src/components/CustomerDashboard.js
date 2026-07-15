import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Row, Statistic,
  Table, Tag, Typography, message,
} from 'antd';
import {
  ClockCircleOutlined, FileTextOutlined, ReloadOutlined, SendOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';

const { Text } = Typography;

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
  const [summary, setSummary] = useState(null);

  const loadInvoices = useCallback(async () => {
    setInvoiceLoading(true);
    try {
      const [invoiceRes, summaryRes] = await Promise.all([
        axios.get('/api/invoices?type=AR'),
        axios.get('/api/invoices/summary'),
      ]);
      setInvoices(invoiceRes.data);
      setSummary(summaryRes.data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load invoices');
    } finally {
      setInvoiceLoading(false);
    }
  }, []);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await axios.post(`/api/bids/${values.bid_id}/requirements`, values);
      message.success('Requirement submitted');
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { title: 'Invoice #', dataIndex: 'invoice_no', render: value => <Text code>{value}</Text> },
    { title: 'Due', dataIndex: 'due_date', render: (value, row) => <Text type={row.overdue ? 'danger' : undefined}>{value}</Text> },
    { title: 'Total', dataIndex: 'total_amount', render: value => money(value) },
    { title: 'Paid', dataIndex: 'paid_amount', render: value => money(value) },
    { title: 'Balance', render: (_, row) => money(Number(row.total_amount) - Number(row.paid_amount)) },
    { title: 'Status', render: (_, row) => statusTag(row) },
  ];

  return (
    <div>
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.customer})` }}>
        <div>
          <h2>Customer Portal</h2>
          <p>Submit procurement requirements and track invoices, balances and due dates in one workspace.</p>
        </div>
        <div className="page-media-actions">
          <Button icon={<ReloadOutlined />} onClick={loadInvoices} loading={invoiceLoading}>Refresh Invoices</Button>
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Open Balance" value={money(summary?.ar?.open)} prefix={<FileTextOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Overdue" value={money(summary?.ar?.overdue)} prefix={<ClockCircleOutlined />} valueStyle={{ color: Number(summary?.ar?.overdue || 0) > 0 ? '#cf1322' : '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Paid This Month" value={money(summary?.paidThisMonth)} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="Submit Requirements" className="table-card">
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Budgets remain hidden from suppliers during bid evaluation." />
            <Form layout="vertical" onFinish={onFinish}>
              <Form.Item name="bid_id" label="Bid ID" rules={[{ required: true }]}>
                <Input placeholder="Enter bid UUID" />
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
              <Button type="primary" htmlType="submit" loading={loading} icon={<SendOutlined />}>Submit Requirement</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="My Invoices" className="table-card">
            <Table
              rowKey="id"
              loading={invoiceLoading}
              dataSource={invoices}
              columns={columns}
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
