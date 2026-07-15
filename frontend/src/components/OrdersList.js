import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Space, Table, Tag, Typography, message } from 'antd';
import { AuditOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import DigitalSignatureModal from './DigitalSignatureModal';

const { Text } = Typography;

function money(value) {
  return `ZMW ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function OrdersList() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [signingOrder, setSigningOrder] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/orders');
      setOrders(data);
    } catch {
      message.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: 'Order', dataIndex: 'id', render: val => <Text code>{val.substring(0, 8)}</Text> },
    { title: 'Organization', dataIndex: 'tenant_name', render: value => value || '-' },
    { title: 'Supplier', dataIndex: 'supplier_name', render: value => value || '-' },
    { title: 'Total', dataIndex: 'total_amount', align: 'right', render: value => money(value) },
    { title: 'Status', dataIndex: 'status', render: value => <Tag>{String(value).replaceAll('_', ' ')}</Tag> },
    {
      title: 'Digital Signatures',
      dataIndex: 'signature_count',
      render: value => <Tag color={Number(value || 0) > 0 ? 'success' : 'warning'}>{value || 0} signed</Tag>,
    },
    {
      title: 'Actions',
      render: (_, row) => (
        <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningOrder(row)}>Sign Contract</Button>
      ),
    },
  ];

  return (
    <Card
      title="Orders & Paperless Contracts"
      className="table-card"
      extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>}
    >
      <Table
        loading={loading}
        dataSource={orders}
        rowKey="id"
        columns={columns}
        scroll={{ x: 900 }}
      />
      <DigitalSignatureModal
        open={!!signingOrder}
        onClose={() => setSigningOrder(null)}
        documentType="order"
        documentId={signingOrder?.id}
        documentLabel={signingOrder ? `Order ${signingOrder.id.slice(0, 8)} contract with ${signingOrder.supplier_name || 'supplier'}` : ''}
        onSigned={load}
      />
    </Card>
  );
}
