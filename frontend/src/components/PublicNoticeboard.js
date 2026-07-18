import React, { useEffect, useState } from 'react';
import { Table, Typography, Select, Tag, Spin, Empty, Input, Space, Card, Statistic, Row, Col } from 'antd';
import { SearchOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
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

const statusColors = {
  draft: 'default',
  open: 'blue',
  evaluation: 'orange',
  awarded: 'green',
  closed: 'red',
};

export default function PublicNoticeboard() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    setLoading(true);
    axios.get('/api/public/bids')
      .then(res => {
        setBids(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredBids = bids.filter(bid => {
    const matchesCategory = categoryFilter === 'All Categories' || bid.business_category === categoryFilter;
    const matchesSearch = !searchText || 
      bid.title?.toLowerCase().includes(searchText.toLowerCase()) ||
      bid.description?.toLowerCase().includes(searchText.toLowerCase()) ||
      bid.tenant_name?.toLowerCase().includes(searchText.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const columns = [
    { 
      title: 'Title', 
      dataIndex: 'title', 
      key: 'title',
      sorter: (a, b) => a.title.localeCompare(b.title),
    },
    { 
      title: 'Procuring Entity', 
      dataIndex: 'tenant_name', 
      key: 'tenant_name',
      sorter: (a, b) => (a.tenant_name || '').localeCompare(b.tenant_name || ''),
    },
    { 
      title: 'Description', 
      dataIndex: 'description', 
      key: 'description', 
      ellipsis: true,
      render: (text) => text || '-',
    },
    {
      title: 'Category', 
      dataIndex: 'business_category', 
      key: 'business_category',
      render: (v) => v ? <Tag color="blue">{v}</Tag> : <Tag>General</Tag>,
      filters: businessCategories.filter(c => c !== 'All Categories').map(c => ({ text: c, value: c })),
      onFilter: (value, record) => record.business_category === value,
    },
    {
      title: 'Deadline', 
      dataIndex: 'deadline', 
      key: 'deadline',
      render: (val) => new Date(val).toLocaleString(),
      sorter: (a, b) => new Date(a.deadline) - new Date(b.deadline),
    },
    { 
      title: 'Method', 
      dataIndex: 'evaluation_method', 
      key: 'evaluation_method',
      render: (v) => <Tag>{v === 'lowest_price' ? 'Lowest Price' : 'Best Value'}</Tag>,
    },
    { 
      title: 'Status', 
      dataIndex: 'status', 
      key: 'status',
      render: (v) => <Tag color={statusColors[v] || 'default'}>{v?.toUpperCase()}</Tag>,
    },
    { title: 'Views', dataIndex: 'views_count', key: 'views_count', sorter: (a, b) => a.views_count - b.views_count },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '40px auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2}>Public Procurement Noticeboard</Title>
        <Title level={4} type="secondary">Open bids from all procuring entities</Title>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={8}>
          <Card size="small">
            <Statistic 
              title="Total Open Bids" 
              value={bids.filter(b => b.status === 'open').length} 
              prefix={<FileTextOutlined />} 
              valueStyle={{ color: '#1677ff' }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card size="small">
            <Statistic 
              title="Under Evaluation" 
              value={bids.filter(b => b.status === 'evaluation').length} 
              valueStyle={{ color: '#fa8c16' }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card size="small">
            <Statistic 
              title="Awarded" 
              value={bids.filter(b => b.status === 'awarded').length} 
              valueStyle={{ color: '#52c41a' }} 
            />
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, flexWrap: 'wrap', width: '100%' }}>
        <Input
          placeholder="Search bids by title, description, or entity"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          style={{ width: 300 }}
        />
        <Select
          value={categoryFilter}
          onChange={setCategoryFilter}
          style={{ width: 220 }}
          placeholder="Filter by category"
        >
          {businessCategories.map(cat => (
            <Select.Option key={cat} value={cat}>{cat}</Select.Option>
          ))}
        </Select>
        <Button icon={<ReloadOutlined />} onClick={() => {
          setLoading(true);
          axios.get('/api/public/bids').then(res => {
            setBids(res.data);
            setLoading(false);
          }).catch(() => setLoading(false));
        }}>
          Refresh
        </Button>
      </Space>

      <Table
        dataSource={filteredBids}
        rowKey="id"
        columns={columns}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        loading={loading}
        locale={{ emptyText: <Empty description="No open bids found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        scroll={{ x: 800 }}
      />
    </div>
  );
}