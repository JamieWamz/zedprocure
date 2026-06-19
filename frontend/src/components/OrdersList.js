import React, { useEffect, useState } from 'react';
import { Table, message } from 'antd';
import axios from 'axios';

export default function OrdersList() {
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    axios.get('/api/orders').then(res => setOrders(res.data)).catch(() => message.error('Failed to load orders'));
  }, []);
  const columns = [
    { title: 'Order ID', dataIndex: 'id', render: val => val.substring(0, 8) },
    { title: 'Bid ID', dataIndex: 'bid_id', render: val => val?.substring(0, 8) },
    { title: 'Supplier', dataIndex: 'awarded_supplier_id', render: val => val?.substring(0, 8) },
    { title: 'Total (ZMW)', dataIndex: 'total_amount' },
    { title: 'Status', dataIndex: 'status' },
  ];
  return <div><h2>Orders</h2><Table dataSource={orders} rowKey="id" columns={columns} /></div>;
}
