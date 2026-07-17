import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Table, Tag, Spin, Alert, Button, Tabs, Badge, List, Typography, Empty, Popover, Statistic, message as msg } from 'antd';
import { BellOutlined, FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined, SafetyCertificateOutlined, TrophyOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { cdnImages } from '../cdnAssets';

const { Text, Title } = Typography;

export default function SupplierDashboard() {
  const [bids, setBids] = useState([]);
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [bidsRes, statusRes, notifRes, countRes] = await Promise.all([
          axios.get('/api/supplier/bids'),
          axios.get('/api/supplier/verification/status').catch(() => null),
          axios.get('/api/notifications').catch(() => ({ data: [] })),
          axios.get('/api/notifications/unread-count').catch(() => ({ data: { count: 0 } })),
        ]);
        setBids(bidsRes.data);
        setVerificationStatus(statusRes?.data || null);
        setNotifications(notifRes.data);
        setUnreadCount(countRes.data.count);
      } catch (e) {
        console.error('Failed to load supplier dashboard:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();

    // Poll notifications every 30s
    const interval = setInterval(async () => {
      try {
        const [notifRes, countRes] = await Promise.all([
          axios.get('/api/notifications').catch(() => ({ data: [] })),
          axios.get('/api/notifications/unread-count').catch(() => ({ data: { count: 0 } })),
        ]);
        setNotifications(notifRes.data);
        setUnreadCount(countRes.data.count);
      } catch (_) {}
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const markAsRead = async (id) => {
    try {
      await axios.put(`/api/notifications/${id}/read`);
      const [notifRes, countRes] = await Promise.all([
        axios.get('/api/notifications'),
        axios.get('/api/notifications/unread-count'),
      ]);
      setNotifications(notifRes.data);
      setUnreadCount(countRes.data.count);
    } catch (_) {}
  };

  const notificationContent = (
    <div style={{ width: 360, maxHeight: 400, overflowY: 'auto' }}>
      {notifications.length === 0 ? (
        <Empty description="No notifications" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={notifications.slice(0, 20)}
          renderItem={(item) => (
            <List.Item
              style={{ background: item.is_read ? 'transparent' : '#f0f5ff', cursor: 'pointer' }}
              onClick={() => { markAsRead(item.id); if (item.link) navigate(item.link); setNotifOpen(false); }}
            >
              <List.Item.Meta
                title={<Text strong={!item.is_read} style={{ fontSize: 13 }}>{item.title}</Text>}
                description={<Text style={{ fontSize: 11, color: '#999' }}>{item.message?.substring(0, 80)}</Text>}
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;

  const isVerified = verificationStatus?.verification_status === 'verified';

  const columns = [
    { title: 'Bid Title', dataIndex: 'title', key: 'title' },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: 'Deadline', dataIndex: 'deadline', key: 'deadline',
      render: (v) => new Date(v).toLocaleString(),
    },
    {
      title: 'Visibility', dataIndex: 'visibility', key: 'visibility',
      render: (v) => <Tag color={v === 'global' ? 'blue' : 'default'}>{v || 'restricted'}</Tag>,
    },
    {
      title: 'Status', key: 'status',
      render: (_, row) => row.accepted === true
        ? <Tag color="success">Accepted</Tag>
        : row.accepted === false
          ? <Tag color="error">Declined</Tag>
          : <Tag color="processing">Open</Tag>,
    },
    {
      title: 'Action', key: 'action',
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => navigate(`/bids/${row.id}`)}>
          {row.bid_supplier_id ? 'View / Respond' : 'View Details'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.supplier})` }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Supplier Dashboard</h2>
          <p>Browse open bids, manage responses, and track your verification status.</p>
        </div>
        <div className="page-media-actions">
          <Popover content={notificationContent} title="Notifications" trigger="click"
            open={notifOpen} onOpenChange={setNotifOpen}>
            <Badge count={unreadCount} size="small" style={{ marginRight: 8 }}>
              <Button icon={<BellOutlined />} />
            </Badge>
          </Popover>
          <Button icon={<SafetyCertificateOutlined />} onClick={() => navigate('/supplier/verification')}>
            Verification Status
          </Button>
        </div>
      </div>

      {/* Verification banner */}
      {!isVerified && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Account not yet verified"
          description="You must be verified before submitting bids. Upload your documents and wait for admin approval."
          action={<Button size="small" onClick={() => navigate('/supplier/verification')}>Upload Documents</Button>}
        />
      )}

      {/* Stats cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card className="stat-card">
            <Statistic
              title="Open Bids Available"
              value={bids.filter(b => !b.accepted && b.visibility === 'global').length}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="stat-card">
            <Statistic
              title="My Invitations"
              value={bids.filter(b => b.bid_supplier_id).length}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="stat-card">
            <Statistic
              title="Verification Status"
              value={verificationStatus?.verification_status || 'Pending'}
              prefix={<SafetyCertificateOutlined />}
              valueStyle={{ color: isVerified ? '#52c41a' : '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Open Bids Table */}
      <Card title={<span><TrophyOutlined /> Available Bids</span>} className="table-card">
        <Table
          dataSource={bids}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="middle"
          scroll={{ x: 700 }}
          locale={{ emptyText: 'No open bids available at this time. Check back later for new opportunities.' }}
        />
      </Card>
    </div>
  );
}

