import React, { useEffect, useState } from 'react';
import { Table, message, Tag, Space, Button, Input, Select, Card, Statistic, Row, Col } from 'antd';
import { SearchOutlined, FileTextOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';

const statusColors = {
  draft: 'default',
  open: 'blue',
  evaluation: 'orange',
  awarded: 'green',
  closed: 'red',
};

export default function TenantBidsList() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const navigate = useNavigate();

  const fetchBids = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/tenant/bids');
      setBids(data);
    } catch {
      message.error('Failed to load bids');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBids(); }, []);

  const filteredBids = bids.filter(bid => {
    const matchesSearch = !searchText || 
      bid.title?.toLowerCase().includes(searchText.toLowerCase()) ||
      bid.description?.toLowerCase().includes(searchText.toLowerCase());
    const matchesStatus = statusFilter === 'all' || bid.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const columns = [
    { 
      title: 'Title', 
      dataIndex: 'title', 
      key: 'title',
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (text, record) => <Link to={`/admin/bids/${record.id}`}>{text}</Link>,
    },
    { 
      title: 'Status', 
      dataIndex: 'status', 
      key: 'status',
      render: (v) => <Tag color={statusColors[v] || 'default'}>{v?.toUpperCase()}</Tag>,
      filters: [
        { text: 'Draft', value: 'draft' },
        { text: 'Open', value: 'open' },
        { text: 'Evaluation', value: 'evaluation' },
        { text: 'Awarded', value: 'awarded' },
        { text: 'Closed', value: 'closed' },
      ],
      onFilter: (value) => setStatusFilter(value),
    },
    { 
      title: 'Deadline', 
      dataIndex: 'deadline', 
      key: 'deadline', 
      render: val => new Date(val).toLocaleString(),
      sorter: (a, b) => new Date(a.deadline) - new Date(b.deadline),
    },
    { 
      title: 'Method', 
      dataIndex: 'evaluation_method', 
      key: 'evaluation_method',
      render: (v) => <Tag>{v === 'lowest_price' ? 'Lowest Price' : 'Best Value'}</Tag>,
    },
    { 
      title: 'Visibility', 
      dataIndex: 'visibility', 
      key: 'visibility',
      render: (v) => <Tag color={v === 'global' ? 'blue' : 'default'}>{v || 'restricted'}</Tag>,
    },
    { title: 'Views', dataIndex: 'views_count', key: 'views_count', sorter: (a, b) => a.views_count - b.views_count },
    {
      title: 'Action',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button size="small" type="link" onClick={() => navigate(`/admin/bids/${record.id}`)}>
            View / Evaluate
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Procurement Bids</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/bids/new')}>
          Create New Bid
        </Button>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic 
              title="Total Bids" 
              value={bids.length} 
              prefix={<FileTextOutlined />} 
              valueStyle={{ color: '#1677ff' }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic 
              title="Open Bids" 
              value={bids.filter(b => b.status === 'open').length} 
              valueStyle={{ color: '#1677ff' }} 
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic 
              title="Under Evaluation" 
              value={bids.filter(b => b.status === 'evaluation').length} 
              valueStyle={{ color: '#fa8c16' }} 
            />
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          placeholder="Search bids"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          style={{ width: 'min(240px, 100%)' }}
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 160 }}
          placeholder="Filter by status"
        >
          <Select.Option value="all">All Statuses</Select.Option>
          <Select.Option value="draft">Draft</Select.Option>
          <Select.Option value="open">Open</Select.Option>
          <Select.Option value="evaluation">Evaluation</Select.Option>
          <Select.Option value="awarded">Awarded</Select.Option>
          <Select.Option value="closed">Closed</Select.Option>
        </Select>
        <Button icon={<ReloadOutlined />} onClick={fetchBids} loading={loading}>
          Refresh
        </Button>
      </Space>

      <Table 
        dataSource={filteredBids} 
        rowKey="id" 
        columns={columns} 
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: 800 }}
      />
    </div>
  );
}