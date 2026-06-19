import React, { useEffect, useState } from 'react';
import { Table, Card } from 'antd';
import axios from 'axios';

export default function FinancialLedger() {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    axios.get('/api/ledger/journal').then(res => setEntries(res.data));
  }, []);
  const columns = [
    { title: 'Date', dataIndex: 'entry_date', render: val => new Date(val).toLocaleString() },
    { title: 'Description', dataIndex: 'description' },
    { title: 'Reference', dataIndex: 'reference_type' },
    { title: 'Lines', dataIndex: 'lines', render: lines => lines.map(l => `${l.account_code}: Debit ${l.debit} Credit ${l.credit}`).join(', ') }
  ];
  return <Card title="Immutable General Ledger"><Table dataSource={entries} rowKey="id" columns={columns} /></Card>;
}
