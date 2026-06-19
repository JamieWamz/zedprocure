import React, { useEffect, useState } from 'react';
import { Table, message } from 'antd';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function TenantBidsList() {
  const [bids, setBids] = useState([]);

  const fetchBids = async () => {
    try {
      const { data } = await axios.get('/api/tenant/bids');
      setBids(data);
    } catch {
      message.error('Failed to load bids');
    }
  };

  useEffect(() => { fetchBids(); }, []);

  const columns = [
    { title: 'Title', dataIndex: 'title' },
    { title: 'Status', dataIndex: 'status' },
    { title: 'Deadline', dataIndex: 'deadline', render: val => new Date(val).toLocaleString() },
    { title: 'Views', dataIndex: 'views_count' },
    { title: 'Eval. Method', dataIndex: 'evaluation_method' },
    {
      title: 'Action',
      render: (_, record) => <Link to={`/admin/bids/${record.id}`}>View</Link>,
    },
  ];

  return (
    <div>
      <h2>Procurement Bids</h2>
      <Table dataSource={bids} rowKey="id" columns={columns} />
    </div>
  );
}
