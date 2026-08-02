import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Select, Space, Table, Tag, Typography, message } from 'antd';
import { AuditOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import DigitalSignatureModal from './DigitalSignatureModal';
import ActionableEmptyState from './ActionableEmptyState';
import { useLocation, useNavigate } from 'react-router-dom';

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
  const location = useLocation();
  const navigate = useNavigate();
  const [completedAction, setCompletedAction] = useState(location.state?.completedAction || null);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    setStatusFilter(new URLSearchParams(location.search).get('status') || 'all');
  }, [location.search]);

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

  const handleUpdateOrderStatus = async (orderId, targetStatus) => {
    try {
      await axios.patch(`/api/orders/${orderId}/status`, { status: targetStatus });
      message.success(`Order status updated to ${targetStatus}`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to update order status');
    }
  };

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
        <Space wrap>
          <Button size="small" icon={<AuditOutlined />} onClick={() => setSigningOrder(row)}>Sign Contract</Button>
          {['delivered', 'delivery_in_progress'].includes(row.status) && (
            <Button size="small" type="primary" onClick={() => handleUpdateOrderStatus(row.id, 'completed')}>Complete Order</Button>
          )}
          {!['completed', 'pending_acceptance', 'disputed'].includes(row.status) && (
            <Button size="small" danger onClick={() => handleUpdateOrderStatus(row.id, 'disputed')}>Dispute</Button>
          )}
        </Space>
      ),
    },
  ];

  const visibleOrders = statusFilter === 'all' ? orders : orders.filter(order => order.status === statusFilter);

  return (
    <div className="workspace-page">
    {completedAction && (
      <Alert
        className="completion-banner"
        type="success"
        showIcon
        closable
        onClose={() => setCompletedAction(null)}
        message={completedAction.title}
        description={completedAction.description}
      />
    )}
    <Card
      title="Orders & Paperless Contracts"
      className="table-card"
      extra={(
        <Space wrap>
          <Select
            aria-label="Filter orders by status"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              navigate(value === 'all' ? '/admin/orders' : `/admin/orders?status=${encodeURIComponent(value)}`, { replace: true });
            }}
            style={{ width: 190 }}
            options={[
              { value: 'all', label: 'All order statuses' },
              { value: 'pending_acceptance', label: 'Pending acceptance' },
              { value: 'accepted', label: 'Accepted' },
              { value: 'delivery_in_progress', label: 'Delivery in progress' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'completed', label: 'Completed' },
              { value: 'disputed', label: 'Disputed' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
        </Space>
      )}
    >
      <Table
        loading={loading}
        dataSource={visibleOrders}
        rowKey="id"
        columns={columns}
        scroll={{ x: 900 }}
        rowClassName={(record) => new URLSearchParams(location.search).get('focus') === record.id ? 'notification-focus-row' : ''}
        locale={{ emptyText: <ActionableEmptyState title="No orders yet" description="Award a supplier response from bid evaluation to create the first order." ctaText="Review bids" ctaPath="/admin/bids" /> }}
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
    </div>
  );
}
