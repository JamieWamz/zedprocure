import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Empty, Input, Row, Space, Statistic,
  Table, Tabs, Tag, Typography, message,
} from 'antd';
import {
  AuditOutlined, BankOutlined, BarChartOutlined, DownloadOutlined,
  FileTextOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ReChartTooltip,
  XAxis, YAxis,
} from 'recharts';
import { cdnImages } from '../cdnAssets';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const ACCOUNT_COLORS = {
  asset: 'blue',
  liability: 'volcano',
  equity: 'purple',
  revenue: 'green',
  expense: 'red',
};

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

export default function FinancialLedger() {
  const [journal, setJournal] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [trialBalance, setTrialBalance] = useState(null);
  const [income, setIncome] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [cashFlow, setCashFlow] = useState([]);
  const [filters, setFilters] = useState({ search: '', range: null });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.range?.[0]) params.set('from', filters.range[0].format('YYYY-MM-DD'));
      if (filters.range?.[1]) params.set('to', filters.range[1].format('YYYY-MM-DD'));

      const [journalRes, accountsRes, trialRes, incomeRes, balanceRes, cashRes] = await Promise.all([
        axios.get(`/api/ledger/journal?${params.toString()}`),
        axios.get('/api/ledger/accounts'),
        axios.get('/api/ledger/trial-balance'),
        axios.get('/api/ledger/income-statement'),
        axios.get('/api/ledger/balance-sheet'),
        axios.get('/api/ledger/cash-flow'),
      ]);

      setJournal(journalRes.data);
      setAccounts(accountsRes.data);
      setTrialBalance(trialRes.data);
      setIncome(incomeRes.data);
      setBalanceSheet(balanceRes.data);
      setCashFlow(cashRes.data.map(row => ({
        ...row,
        cashIn: Number(row.cashIn),
        cashOut: Number(row.cashOut),
        net: Number(row.net),
      })));
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load accounting workspace');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const journalColumns = [
    { title: 'Date', dataIndex: 'entry_date', render: val => new Date(val).toLocaleString() },
    { title: 'Description', dataIndex: 'description' },
    { title: 'Reference', dataIndex: 'reference_type', render: value => <Tag>{value}</Tag> },
    {
      title: 'Lines',
      dataIndex: 'lines',
      render: lines => (
        <Space direction="vertical" size={2}>
          {(lines || []).map((line, index) => (
            <Text key={`${line.account_code}-${index}`} style={{ fontSize: 12 }}>
              <Text code>{line.account_code}</Text> {line.account_name}: Dr {money(line.debit)} / Cr {money(line.credit)}
            </Text>
          ))}
        </Space>
      ),
    },
  ];

  const accountColumns = [
    { title: 'Code', dataIndex: 'code', render: value => <Text code>{value}</Text> },
    { title: 'Account', dataIndex: 'name' },
    { title: 'Type', dataIndex: 'type', render: value => <Tag color={ACCOUNT_COLORS[value]}>{value}</Tag> },
    { title: 'Debit', dataIndex: 'debit', align: 'right', render: value => money(value) },
    { title: 'Credit', dataIndex: 'credit', align: 'right', render: value => money(value) },
    { title: 'Balance', dataIndex: 'balance', align: 'right', render: value => <Text strong>{money(value)}</Text> },
  ];

  const trialColumns = [
    { title: 'Code', dataIndex: 'code', render: value => <Text code>{value}</Text> },
    { title: 'Account', dataIndex: 'name' },
    { title: 'Normal', dataIndex: 'normalBalance', render: value => <Tag>{value}</Tag> },
    { title: 'Debit', dataIndex: 'debit', align: 'right', render: value => money(value) },
    { title: 'Credit', dataIndex: 'credit', align: 'right', render: value => money(value) },
    { title: 'Balance', dataIndex: 'balance', align: 'right', render: value => money(value) },
  ];

  const cashNet = useMemo(() => cashFlow.reduce((sum, row) => sum + row.net, 0), [cashFlow]);
  const balanceGap = balanceSheet
    ? Number(balanceSheet.assets) - Number(balanceSheet.totalLiabilitiesEquity)
    : 0;

  const exportJournal = () => {
    downloadCsv('journal-export.csv', [
      ['Date', 'Description', 'Reference', 'Lines'],
      ...journal.map(entry => [
        new Date(entry.entry_date).toISOString(),
        entry.description,
        entry.reference_type,
        (entry.lines || []).map(line => `${line.account_code} Dr ${line.debit} Cr ${line.credit}`).join('; '),
      ]),
    ]);
  };

  const exportAccounts = () => {
    downloadCsv('chart-of-accounts.csv', [
      ['Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance'],
      ...accounts.map(account => [
        account.code,
        account.name,
        account.type,
        account.debit,
        account.credit,
        account.balance,
      ]),
    ]);
  };

  const exportTrialBalance = () => {
    downloadCsv('trial-balance.csv', [
      ['Code', 'Account', 'Normal Balance', 'Debit', 'Credit', 'Balance'],
      ...(trialBalance?.lines || []).map(line => [
        line.code,
        line.name,
        line.normalBalance,
        line.debit,
        line.credit,
        line.balance,
      ]),
      ['Totals', '', '', trialBalance?.totalDebit || 0, trialBalance?.totalCredit || 0, ''],
    ]);
  };

  const exportStatements = () => {
    downloadCsv('financial-statements.csv', [
      ['Statement', 'Line', 'Amount'],
      ['Income Statement', 'Revenue', income?.revenue || 0],
      ['Income Statement', 'Expenses', income?.expenses || 0],
      ['Income Statement', 'Net Profit', income?.netProfit || 0],
      ['Balance Sheet', 'Assets', balanceSheet?.assets || 0],
      ['Balance Sheet', 'Liabilities', balanceSheet?.liabilities || 0],
      ['Balance Sheet', 'Equity', balanceSheet?.equity || 0],
      ['Balance Sheet', 'Retained Earnings', balanceSheet?.retainedEarnings || 0],
      ['Cash Flow', '12-month Net Cash', cashNet],
    ]);
  };

  const reportItems = [
    {
      key: 'journal',
      label: 'Journal',
      children: (
        <Card className="table-card" extra={<Button icon={<DownloadOutlined />} onClick={exportJournal}>Export Journal</Button>}>
          <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search description or reference"
              value={filters.search}
              onChange={e => setFilters(current => ({ ...current, search: e.target.value }))}
              onPressEnter={load}
              style={{ width: 280 }}
            />
            <RangePicker
              value={filters.range}
              onChange={range => setFilters(current => ({ ...current, range }))}
            />
            <Button icon={<ReloadOutlined />} onClick={load}>Apply</Button>
          </Space>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={journal}
            columns={journalColumns}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 900 }}
            locale={{ emptyText: <Empty description="No journal entries found" /> }}
          />
        </Card>
      ),
    },
    {
      key: 'accounts',
      label: 'Chart of Accounts',
      children: (
        <Card className="table-card" extra={<Button icon={<DownloadOutlined />} onClick={exportAccounts}>Export Accounts</Button>}>
          <Table rowKey="code" loading={loading} dataSource={accounts} columns={accountColumns} pagination={false} scroll={{ x: 760 }} />
        </Card>
      ),
    },
    {
      key: 'trial',
      label: 'Trial Balance',
      children: (
        <Card
          className="table-card"
          title={trialBalance?.balanced ? <Tag color="success">Balanced</Tag> : <Tag color="error">Out of balance</Tag>}
          extra={<Space><Text strong>Dr {money(trialBalance?.totalDebit)} / Cr {money(trialBalance?.totalCredit)}</Text><Button icon={<DownloadOutlined />} onClick={exportTrialBalance}>Export</Button></Space>}
        >
          <Table rowKey="code" loading={loading} dataSource={trialBalance?.lines || []} columns={trialColumns} pagination={false} scroll={{ x: 760 }} />
        </Card>
      ),
    },
    {
      key: 'income',
      label: 'Income Statement',
      children: (
        <Row gutter={[16, 16]}>
          <Col span={24}><Button icon={<DownloadOutlined />} onClick={exportStatements}>Export Statements</Button></Col>
          <Col xs={24} md={8}><Card><Statistic title="Revenue" value={money(income?.revenue)} prefix={<BarChartOutlined />} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="Expenses" value={money(income?.expenses)} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="Net Profit" value={money(income?.netProfit)} valueStyle={{ color: Number(income?.netProfit || 0) >= 0 ? '#389e0d' : '#cf1322' }} /></Card></Col>
          <Col span={24}><Alert type="info" showIcon message={`Current margin: ${income?.margin || '0.0'}%`} /></Col>
        </Row>
      ),
    },
    {
      key: 'balance',
      label: 'Balance Sheet',
      children: (
        <Row gutter={[16, 16]}>
          <Col span={24}><Button icon={<DownloadOutlined />} onClick={exportStatements}>Export Statements</Button></Col>
          <Col xs={24} md={8}><Card><Statistic title="Assets" value={money(balanceSheet?.assets)} prefix={<BankOutlined />} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="Liabilities" value={money(balanceSheet?.liabilities)} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="Equity + Retained Earnings" value={money(Number(balanceSheet?.equity || 0) + Number(balanceSheet?.retainedEarnings || 0))} /></Card></Col>
          <Col span={24}>
            <Alert
              type={balanceSheet?.balanced ? 'success' : 'warning'}
              showIcon
              message={balanceSheet?.balanced ? 'Balance sheet is balanced' : `Balance gap: ${money(balanceGap)}`}
            />
          </Col>
        </Row>
      ),
    },
    {
      key: 'cash',
      label: 'Cash Flow',
      children: (
        <Card className="table-card">
          {cashFlow.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={cashFlow}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <ReChartTooltip formatter={value => money(value)} />
                <Bar dataKey="cashIn" name="Cash in" fill="#1677ff" />
                <Bar dataKey="cashOut" name="Cash out" fill="#fa8c16" />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty description="No cash movements yet" />}
        </Card>
      ),
    },
  ];

  return (
    <div>
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.ledger})` }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}><AuditOutlined /> Accounting Workspace</h2>
          <p>Review posted journal entries, account balances, financial statements and cash movement.</p>
        </div>
        <div className="page-media-actions">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Net Profit" value={money(income?.netProfit)} valueStyle={{ color: Number(income?.netProfit || 0) >= 0 ? '#389e0d' : '#cf1322' }} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Cash Net 12m" value={money(cashNet)} valueStyle={{ color: cashNet >= 0 ? '#389e0d' : '#cf1322' }} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Trial Balance" value={trialBalance?.balanced ? 'Balanced' : 'Review'} valueStyle={{ color: trialBalance?.balanced ? '#389e0d' : '#cf1322' }} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="Balance Sheet" value={balanceSheet?.balanced ? 'Balanced' : 'Review'} valueStyle={{ color: balanceSheet?.balanced ? '#389e0d' : '#cf1322' }} /></Card></Col>
      </Row>

      <Tabs items={reportItems} />
    </div>
  );
}
