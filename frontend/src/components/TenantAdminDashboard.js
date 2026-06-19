import React, { useEffect, useState } from 'react';
import { Button, Table, message } from 'antd';
import { PlusOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function TenantAdminDashboard() {
  const [bids, setBids] = useState([]);

  const fetchBids = async () => {
    try {
      const { data } = await axios.get('/api/tenant/bids');
      setBids(data);
    } catch (err) {
      message.error('Failed to load bids');
    }
  };

  useEffect(() => { fetchBids(); }, []);

  const columns = [
    { title: 'Title', dataIndex: 'title' },
    { title: 'Status', dataIndex: 'status' },
    { title: 'Deadline', dataIndex: 'deadline', render: val => new Date(val).toLocaleString() },
    { title: 'Action', render: (_, record) => (
        <Link to={`/tenant-admin/bids/${record.id}`}>View</Link>
    )}
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Procurement Management</h2>
        <div>
          <Link to="/tenant-admin/orders">
            <Button icon={<ShoppingCartOutlined />} style={{ marginRight: 8 }}>Orders</Button>
          </Link>
          <Link to="/tenant-admin/bids/new">
            <Button type="primary" icon={<PlusOutlined />}>Create New Bid</Button>
          </Link>
        </div>
      </div>
      <Table dataSource={bids} rowKey="id" columns={columns} />
    </div>
  );
}
