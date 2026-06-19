import React, { useEffect, useState } from 'react';
import { Table, Typography } from 'antd';
import axios from 'axios';

const { Title } = Typography;

export default function PublicNoticeboard() {
  const [bids, setBids] = useState([]);

  useEffect(() => {
    axios.get('/api/public/bids').then(res => setBids(res.data));
  }, []);

  const columns = [
    { title: 'Title', dataIndex: 'title' },
    { title: 'Procuring Entity', dataIndex: 'tenant_name' },
    { title: 'Description', dataIndex: 'description' },
    { title: 'Deadline', dataIndex: 'deadline', render: val => new Date(val).toLocaleString() },
    { title: 'Evaluation Method', dataIndex: 'evaluation_method' },
    { title: 'Views', dataIndex: 'views_count' },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: 24 }}>
      <Title level={2}>Public Procurement Noticeboard</Title>
      <Title level={4} type="secondary">Open bids from all procuring entities</Title>
      <Table dataSource={bids} rowKey="id" columns={columns} pagination={{ pageSize: 10 }} />
    </div>
  );
}
