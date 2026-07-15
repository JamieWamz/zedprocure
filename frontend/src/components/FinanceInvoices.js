import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, DatePicker,
  message, Space, Drawer, Typography, Popconfirm, Empty, Tooltip, Statistic, Row, Col,
  Alert, Progress,
} from 'antd';
import {
  PlusOutlined, EyeOutlined, SendOutlined, StopOutlined, DollarOutlined,
  FileTextOutlined, ReloadOutlined, DownloadOutlined, BellOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { cdnImages } from '../cdnAssets';

const { Text } = Typography;

function money(value, currency = 'ZMW') {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const STATUS_META = {
  draft: { color: 'default', label: 'Draft' },
  sent: { color: 'processing', label: 'Sent' },
  partially_paid: { color: 'gold', label: 'Partially Paid' },
  paid: { color: 'success', label: 'Paid' },
  overdue: { color: 'error', label: 'Overdue' },
  cancelled: { color: 'default', label: 'Cancelled' },
};

const OPEN_STATUSES = ['sent', 'partially_paid'];

const TYPE_META = {
  AR: { color: 'blue', label: 'Receivable (AR)' },
  AP: { color: 'volcano', label: 'Payable (AP)' },
};

function statusTag(inv) {
  const key = inv.overdue ? 'overdue' : inv.status;
  const m = STATUS_META[key] || STATUS_META.draft;
  return <Tag color={m.color}>{m.label}</Tag>;
}

export default function FinanceInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [aging, setAging] = useState({ ar: null, ap: null });
  const [summary, setSummary] = useState(null);
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ status: undefined, type: undefined, due: undefined, q: '' });

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();

  const [view, setView] = useState(null);        // invoice being viewed (drawer)
  const [payOpen, setPayOpen] = useState(false);
  const [payForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const partyType = Form.useWatch('party_type', createForm);
  const nextDue = summary?.nextDue || [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.type) params.set('type', filters.type);
      if (filters.due) params.set('due', filters.due);
      if (filters.q) params.set('party', filters.q);
      const [inv, age, summaryRes] = await Promise.all([
        axios.get(`/api/invoices?${params.toString()}`),
        axios.get('/api/invoices/aging').catch(() => ({ data: { ar: null, ap: null } })),
        axios.get('/api/invoices/summary').catch(() => ({ data: null })),
      ]);
      setInvoices(inv.data);
      setAging(age.data);
      setSummary(summaryRes.data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const loadParties = useCallback(async (type = 'customer') => {
    if (type === 'external') {
      setParties([]);
      return;
    }
    try {
      const { data } = await axios.get(`/api/invoices/parties?type=${type || 'customer'}`);
      setParties(data);
    } catch (e) {
      setParties([]);
    }
  }, []);

  useEffect(() => {
    if (createOpen) loadParties(partyType);
  }, [createOpen, partyType, loadParties]);

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      type: 'AR', party_type: 'customer', currency: 'ZMW',
      issue_date: dayjs(), due_date: dayjs().add(30, 'day'),
      issue_now: false,
      lines: [{ description: '', quantity: 1, unit_price: 0, tax_rate: 0 }],
    });
    setCreateOpen(true);
  };

  const handlePartySelect = (partyId) => {
    const party = parties.find(p => p.party_id === partyId);
    if (!party) return;
    createForm.setFieldsValue({
      party_type: party.party_type,
      party_id: party.party_id,
      party_name: party.name,
      party_email: party.email,
    });
  };

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      const payload = {
        type: v.type, party_type: v.party_type, party_name: v.party_name,
        party_id: v.party_type !== 'external' ? v.party_id || undefined : undefined,
        party_email: v.party_email,
        order_id: v.order_id || undefined, bid_id: v.bid_id || undefined,
        issue_date: v.issue_date?.format('YYYY-MM-DD'), due_date: v.due_date.format('YYYY-MM-DD'),
        currency: v.currency, notes: v.notes, status: v.issue_now ? 'sent' : 'draft',
        lines: v.lines.map(l => ({
          description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate,
        })),
      };
      setSaving(true);
      await axios.post('/api/invoices', payload);
      message.success('Invoice created');
      setCreateOpen(false);
      load();
    } catch (e) {
      if (e.response) message.error(e.response?.data?.error || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const openView = async (id) => {
    try {
      const { data } = await axios.get(`/api/invoices/${id}`);
      setView(data);
    } catch (e) {
      message.error('Failed to load invoice');
    }
  };

  const changeStatus = async (id, status) => {
    try {
      await axios.patch(`/api/invoices/${id}`, { status });
      message.success(`Invoice ${status}`);
      setView(null);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed');
    }
  };

  const sendReminder = async () => {
    if (!view) return;
    try {
      setSaving(true);
      await axios.post(`/api/invoices/${view.id}/reminders`);
      message.success('Payment reminder sent');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to send reminder');
    } finally {
      setSaving(false);
    }
  };

  const submitPayment = async () => {
    try {
      const v = await payForm.validateFields();
      setSaving(true);
      await axios.post(`/api/invoices/${view.id}/payments`, {
        amount: v.amount, method: v.method, reference: v.reference,
        payment_date: v.payment_date?.format('YYYY-MM-DD'),
      });
      message.success('Payment recorded');
      setPayOpen(false);
      const { data } = await axios.get(`/api/invoices/${view.id}`);
      setView(data);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { title: 'Invoice #', dataIndex: 'invoice_no', key: 'invoice_no', render: v => <Text code>{v}</Text> },
    {
      title: 'Type', dataIndex: 'type', key: 'type',
      render: v => <Tag color={TYPE_META[v]?.color}>{TYPE_META[v]?.label}</Tag>,
    },
    { title: 'Party', dataIndex: 'party_name', key: 'party_name' },
    { title: 'Issued', dataIndex: 'issue_date', key: 'issue_date' },
    {
      title: 'Due', dataIndex: 'due_date', key: 'due_date',
      render: (v, r) => <span style={r.overdue ? { color: '#cf1322', fontWeight: 600 } : {}}>{v}</span>,
    },
    {
      title: 'Total', dataIndex: 'total_amount', key: 'total_amount',
      render: v => money(v),
    },
    {
      title: 'Balance', key: 'balance',
      render: (_, r) => {
        const bal = parseFloat(r.total_amount) - parseFloat(r.paid_amount);
        return money(bal);
      },
    },
    { title: 'Status', key: 'status', render: (_, r) => statusTag(r) },
    {
      title: 'Actions', key: 'actions', fixed: 'right',
      render: (_, r) => (
        <Space>
          <Tooltip title="View / manage"><Button size="small" icon={<EyeOutlined />} onClick={() => openView(r.id)} /></Tooltip>
        </Space>
      ),
    },
  ];

  const exportInvoices = () => {
    downloadCsv('invoices-export.csv', [
      ['Invoice #', 'Type', 'Party', 'Issue Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Status'],
      ...invoices.map(inv => [
        inv.invoice_no,
        inv.type,
        inv.party_name,
        inv.issue_date,
        inv.due_date,
        inv.total_amount,
        inv.paid_amount,
        (Number(inv.total_amount) - Number(inv.paid_amount)).toFixed(2),
        inv.overdue ? 'overdue' : inv.status,
      ]),
    ]);
  };

  return (
    <div>
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.invoices})` }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}><FileTextOutlined /> Invoices</h2>
          <p>Track receivables, payables, reminders, aging and payment status from one finance desk.</p>
        </div>
        <div className="page-media-actions">
            <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
            <Button icon={<DownloadOutlined />} onClick={exportInvoices}>Export</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New Invoice</Button>
        </div>
      </div>

      {summary && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic title="AR Open" value={money(summary.ar?.open)} valueStyle={{ color: '#1677ff' }} />
              <Progress percent={summary.ar?.total > 0 ? Math.min((Number(summary.ar.open) / Number(summary.ar.total)) * 100, 100) : 0} showInfo={false} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic title="AR Overdue" value={money(summary.ar?.overdue)} valueStyle={{ color: Number(summary.ar?.overdue || 0) > 0 ? '#cf1322' : '#389e0d' }} />
              <Text type="secondary">{summary.counts?.overdue || 0} overdue invoice{summary.counts?.overdue === 1 ? '' : 's'}</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic title="AP Open" value={money(summary.ap?.open)} valueStyle={{ color: '#fa8c16' }} />
              <Text type="secondary">{money(summary.ap?.dueSoon)} due in 7 days</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic title="Paid This Month" value={money(summary.paidThisMonth)} valueStyle={{ color: '#389e0d' }} />
              <Text type="secondary">{summary.counts?.paid || 0} paid invoices</Text>
            </Card>
          </Col>
        </Row>
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="AR Outstanding" value={money(aging.ar?.total)} valueStyle={{ color: '#1677ff' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="AR Over 90d" value={money(aging.ar?.d90_plus)} valueStyle={{ color: '#cf1322' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="AP Outstanding" value={money(aging.ap?.total)} valueStyle={{ color: '#fa8c16' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="AP Over 90d" value={money(aging.ap?.d90_plus)} valueStyle={{ color: '#cf1322' }} /></Card>
        </Col>
      </Row>

      {nextDue.length > 0 && (
        <Card
          className="table-card"
          title={<span><BellOutlined /> Payment Follow-up Queue</span>}
          style={{ marginBottom: 16 }}
        >
          <Table
            rowKey="id"
            size="small"
            dataSource={nextDue}
            pagination={false}
            scroll={{ x: 760 }}
            columns={[
              { title: 'Invoice #', dataIndex: 'invoice_no', render: v => <Text code>{v}</Text> },
              { title: 'Type', dataIndex: 'type', render: v => <Tag color={TYPE_META[v]?.color}>{TYPE_META[v]?.label}</Tag> },
              { title: 'Party', dataIndex: 'party_name' },
              {
                title: 'Due',
                dataIndex: 'due_date',
                render: (value, row) => (
                  <Text type={row.overdue ? 'danger' : undefined} strong={row.overdue}>{value}</Text>
                ),
              },
              { title: 'Balance', dataIndex: 'balance', align: 'right', render: value => money(value) },
              {
                title: 'Action',
                render: (_, row) => (
                  <Space>
                    {row.overdue && <Tag color="error">Overdue</Tag>}
                    <Button size="small" icon={<EyeOutlined />} onClick={() => openView(row.id)}>Open</Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card className="table-card">
        <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <Select allowClear placeholder="Status" style={{ width: 160 }} value={filters.status}
            onChange={v => setFilters(f => ({ ...f, status: v }))}
            options={Object.entries(STATUS_META).filter(([k]) => k !== 'overdue').map(([k, m]) => ({ value: k, label: m.label }))} />
          <Select allowClear placeholder="Type" style={{ width: 160 }} value={filters.type}
            onChange={v => setFilters(f => ({ ...f, type: v }))}
            options={Object.entries(TYPE_META).map(([k, m]) => ({ value: k, label: m.label }))} />
          <Select allowClear placeholder="Due" style={{ width: 160 }} value={filters.due}
            onChange={v => setFilters(f => ({ ...f, due: v }))}
            options={[
              { value: 'overdue', label: 'Overdue' },
              { value: 'next_7', label: 'Due next 7 days' },
            ]} />
          <Input.Search placeholder="Search party / number" allowClear style={{ width: 240 }}
            value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} onSearch={load} />
        </Space>
        <Table rowKey="id" dataSource={invoices} columns={columns} loading={loading}
          scroll={{ x: 900 }} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="No invoices yet" /> }} />
      </Card>

      {/* ─── Create Invoice Modal ─────────────────────────────────────────── */}
      <Modal title="New Invoice" open={createOpen} onCancel={() => setCreateOpen(false)}
        onOk={submitCreate} confirmLoading={saving} width={760} okText="Create Invoice">
        <Form form={createForm} layout="vertical">
          <Row gutter={12}>
            <Col span={8}><Form.Item name="type" label="Type" rules={[{ required: true }]}>
              <Select options={Object.entries(TYPE_META).map(([k, m]) => ({ value: k, label: m.label }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="party_type" label="Party Type" rules={[{ required: true }]}>
              <Select
                onChange={() => createForm.setFieldsValue({ party_id: undefined })}
                options={[{ value: 'customer', label: 'Customer' }, { value: 'supplier', label: 'Supplier' }, { value: 'external', label: 'External' }]}
              /></Form.Item></Col>
            <Col span={8}><Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
              <Select options={[{ value: 'ZMW', label: 'ZMW' }, { value: 'USD', label: 'USD' }]} /></Form.Item></Col>
          </Row>
          {partyType !== 'external' && (
            <Form.Item name="party_id" label="Known Party">
              <Select
                allowClear
                showSearch
                placeholder="Search existing customer or supplier"
                onChange={handlePartySelect}
                optionFilterProp="label"
                options={parties.map(p => ({
                  value: p.party_id,
                  label: `${p.name}${p.email ? ` - ${p.email}` : ''}${p.organization ? ` (${p.organization})` : ''}`,
                }))}
              />
            </Form.Item>
          )}
          <Row gutter={12}>
            <Col span={12}><Form.Item name="party_name" label="Party Name" rules={[{ required: true, message: 'Required' }]}>
              <Input placeholder="Company / person" /></Form.Item></Col>
            <Col span={12}><Form.Item name="party_email" label="Party Email"><Input placeholder="billing@example.com" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="issue_date" label="Issue Date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="due_date" label="Due Date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="issue_now" label="Issue Mode">
              <Select style={{ width: '100%' }}
                options={[{ value: true, label: 'Issue & send now' }, { value: false, label: 'Save as draft' }]} /></Form.Item></Col>
          </Row>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, idx) => (
                  <Row gutter={8} key={field.key} align="bottom" style={{ marginBottom: 4 }}>
                    <Col span={9}><Form.Item name={[field.name, 'description']} rules={[{ required: true, message: 'Desc' }]}>
                      <Input placeholder="Description" /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'quantity']} rules={[{ required: true }]}>
                      <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="Qty" /></Form.Item></Col>
                    <Col span={5}><Form.Item name={[field.name, 'unit_price']} rules={[{ required: true }]}>
                      <InputNumber min={0} step={0.01} style={{ width: '100%' }} prefix="ZMW" placeholder="Unit" /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'tax_rate']}>
                      <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} placeholder="Tax%" /></Form.Item></Col>
                    <Col span={2}><Button danger onClick={() => remove(field.name)} disabled={fields.length === 1}>X</Button></Col>
                  </Row>
                ))}
                <Button type="dashed" onClick={() => add({ quantity: 1, unit_price: 0, tax_rate: 0 })} block icon={<PlusOutlined />}>
                  Add line item
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label="Notes" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} placeholder="Optional notes" /></Form.Item>
        </Form>
      </Modal>

      {/* ─── Invoice Detail Drawer ───────────────────────────────────────── */}
      <Drawer title={view ? `Invoice ${view.invoice_no}` : 'Invoice'} width={680}
        open={!!view} onClose={() => setView(null)}>
        {view && (
          <>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={8}><Statistic title="Total" value={money(view.total_amount, view.currency)} /></Col>
              <Col span={8}><Statistic title="Paid" value={money(view.paid_amount, view.currency)} /></Col>
              <Col span={8}><Statistic title="Balance" value={money(parseFloat(view.total_amount) - parseFloat(view.paid_amount), view.currency)} valueStyle={{ color: '#cf1322' }} /></Col>
            </Row>
            <Alert
              type={view.due_date < dayjs().format('YYYY-MM-DD') && OPEN_STATUSES.includes(view.status) ? 'warning' : 'info'}
              showIcon
              style={{ marginBottom: 12 }}
              message={`${view.party_name}${view.party_email ? ` · ${view.party_email}` : ''}`}
              description={`Issued ${view.issue_date}. Due ${view.due_date}. ${view.notes || ''}`}
            />
            <Space style={{ marginBottom: 12 }}>
              {statusTag(view)}
              {view.status !== 'sent' && view.status !== 'paid' && view.status !== 'cancelled' && (
                <Button size="small" icon={<SendOutlined />} onClick={() => changeStatus(view.id, 'sent')}>Mark Sent</Button>
              )}
              {view.status !== 'cancelled' && view.status !== 'paid' && (
                <Popconfirm title="Cancel this invoice?" onConfirm={() => changeStatus(view.id, 'cancelled')}>
                  <Button size="small" icon={<StopOutlined />}>Cancel</Button>
                </Popconfirm>
              )}
              {view.status !== 'paid' && view.status !== 'cancelled' && (
                <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => {
                  payForm.resetFields();
                  payForm.setFieldsValue({ method: 'bank_transfer', payment_date: dayjs() });
                  setPayOpen(true);
                }}>Record Payment</Button>
              )}
              {OPEN_STATUSES.includes(view.status) && view.party_email && (
                <Button size="small" icon={<BellOutlined />} loading={saving} onClick={sendReminder}>Send Reminder</Button>
              )}
            </Space>

            <Card size="small" title="Line Items" style={{ marginBottom: 12 }}>
              <Table rowKey="id" size="small" pagination={false}
                dataSource={view.lines}
                columns={[
                  { title: 'Description', dataIndex: 'description' },
                  { title: 'Qty', dataIndex: 'quantity' },
                  { title: 'Unit', dataIndex: 'unit_price', render: v => money(v, view.currency) },
                  { title: 'Tax%', dataIndex: 'tax_rate' },
                  { title: 'Amount', dataIndex: 'amount', render: v => money(v, view.currency) },
                ]} />
            </Card>

            <Card size="small" title="Payments">
              {view.payments.length ? (
                <Table rowKey="id" size="small" pagination={false} dataSource={view.payments}
                  columns={[
                    { title: 'Date', dataIndex: 'payment_date' },
                    { title: 'Method', dataIndex: 'method' },
                    { title: 'Reference', dataIndex: 'reference', render: v => v || '—' },
                    { title: 'Amount', dataIndex: 'amount', render: v => money(v, view.currency) },
                  ]} />
              ) : <Empty description="No payments recorded" />}
            </Card>
          </>
        )}
      </Drawer>

      {/* ─── Record Payment Modal ────────────────────────────────────────── */}
      <Modal title={`Record Payment — ${view?.invoice_no}`} open={payOpen} onCancel={() => setPayOpen(false)}
        onOk={submitPayment} confirmLoading={saving} okText="Record Payment">
        {view && (
          <Form form={payForm} layout="vertical">
            <Alertish balance={parseFloat(view.total_amount) - parseFloat(view.paid_amount)} />
            <Form.Item name="amount" label="Amount (ZMW)" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} prefix="ZMW" /></Form.Item>
            <Form.Item name="method" label="Method" rules={[{ required: true }]}>
              <Select options={[
                { value: 'bank_transfer', label: 'Bank Transfer' },
                { value: 'mobile_money', label: 'Mobile Money' },
                { value: 'wallet', label: 'Wallet' },
                { value: 'cash', label: 'Cash' },
              ]} /></Form.Item>
            <Form.Item name="payment_date" label="Payment Date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="reference" label="Reference / Cheque #"><Input placeholder="Optional" /></Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}

function Alertish({ balance }) {
  return (
    <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
      Remaining balance: <Text strong>{money(balance)}</Text>
    </div>
  );
}
