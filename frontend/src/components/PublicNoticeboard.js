import React, { useEffect, useState } from 'react';
import { Table, Typography, Select, Tag, Spin, Empty } from 'antd';
import axios from 'axios';

const { Title } = Typography;

const businessCategories = [
  'All Categories',
  'Construction & Infrastructure',
  'ICT & Software',
  'Healthcare & Medical',
  'Agriculture & Food',
  'Transport & Logistics',
  'Education & Training',
  'Professional Services',
  'Manufacturing',
  'Energy & Utilities',
  'Other',
];

export default function PublicNoticeboard() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('All Categories');

  useEffect(() => {
    setLoading(true);
    axios.get('/api/public/bids').then(res => {
      setBids(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filteredBids = categoryFilter === 'All Categories'
    ? bids
    : bids.filter(b => b.business_category === categoryFilter);

  const columns = [
    { title: 'Title', dataIndex: 'title', key: 'title' },
    { title: 'Procuring Entity', dataIndex: 'tenant_name', key: 'tenant_name' },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: 'Category', dataIndex: 'business_category', key: 'business_category',
      render: (v) => v ? <Tag color="blue">{v}</Tag> : <Tag>General</Tag>,
    },
    {
      title: 'Deadline', dataIndex: 'deadline', key: 'deadline',
      render: val => new Date(val).toLocaleString(),
    },
    { title: 'Evaluation Method', dataIndex: 'evaluation_method', key: 'evaluation_method' },
    { title: 'Views', dataIndex: 'views_count', key: 'views_count' },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: 24 }}>
      <Title level={2}>Public Procurement Noticeboard</Title>
      <Title level={4} type="secondary">Open bids from all procuring entities</Title>

      <div style={{ marginBottom: 16 }}>
        <Select
          value={categoryFilter}
          onChange={setCategoryFilter}
          style={{ width: 280 }}
          placeholder="Filter by category"
        >
          {businessCategories.map(cat => (
            <Select.Option key={cat} value={cat}>{cat}</Select.Option>
          ))}
        </Select>
      </div>

      <Table
        dataSource={filteredBids}
        rowKey="id"
        columns={columns}
        pagination={{ pageSize: 10 }}
        loading={loading}
        locale={{ emptyText: <Empty description="No open bids found" /> }}
      />
    </div>
  );
}
