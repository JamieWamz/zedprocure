import React, { useEffect, useState } from 'react';
import {
  Card, Statistic, Row, Col, Table, Button, Modal, Form, Input, Select,
  message, Switch, Popconfirm, Typography, Space, Tag, Divider
} from 'antd';
import {
  UserOutlined, ShopOutlined, FileTextOutlined, DollarOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined, ConsoleSqlOutlined
} from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;
const IMMUTABLE_EMAIL = 'wamuyuwamundia@gmail.com';

export default function SystemHealthPortal() {
  const [stats, setStats] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  // Console
  const [consoleCommand, setConsoleCommand] = useState('');
  const [consoleOutput, setConsoleOutput] = useState('');
  const [consoleLoading, setConsoleLoading] = useState(false);

  const fetchStats = async () => {
    try {
      const { data } = await axios.get('/api/system/stats');
      setStats(data);
    } catch { /* ignore */ }
  };

  const fetchAdmins = async () => {
    try {
      const { data } = await axios.get('/api/system/admins');
      setAdmins(data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchStats();
    fetchAdmins();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  // Add admin
  const handleAddAdmin = async (values) => {
    setFormLoading(true);
    try {
      await axios.post('/api/admin/admins', values);
      message.success('Administrator created');
      fetchAdmins();
      setAddModalVisible(false);
      form.resetFields();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    } finally {
      setFormLoading(false);
    }
  };

  // Edit admin
  const openEditModal = (record) => {
    setSelectedAdmin(record);
    editForm.setFieldsValue(record);
    setEditModalVisible(true);
  };

  const handleEditAdmin = async (values) => {
    setFormLoading(true);
    try {
      await axios.put(`/api/system/admins/${selectedAdmin.id}`, values);
      message.success('Administrator updated');
      fetchAdmins();
      setEditModalVisible(false);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    } finally {
      setFormLoading(false);
    }
  };

  // Toggle active status
  const toggleActive = async (record, checked) => {
    if (record.email === IMMUTABLE_EMAIL) {
      message.error('Cannot deactivate the immutable admin');
      return;
    }
    try {
      await axios.put(`/api/system/admins/${record.id}`, { is_active: checked });
      message.success(`Admin ${checked ? 'activated' : 'deactivated'}`);
      fetchAdmins();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  // Delete (deactivate)
  const deleteAdmin = async (id) => {
    try {
      await axios.delete(`/api/system/admins/${id}`);
      message.success('Admin deactivated');
      fetchAdmins();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed');
    }
  };

  // Console
  const runConsoleCommand = async () => {
    if (!consoleCommand.trim()) return;
    setConsoleLoading(true);
    try {
      const { data } = await axios.post('/api/system/console', { command: consoleCommand.trim() });
      setConsoleOutput(prev => `> ${consoleCommand}\n${data.output}\n\n${prev}`);
      setConsoleCommand('');
    } catch (err) {
      setConsoleOutput(prev => `> ${consoleCommand}\nError: ${err.response?.data?.output || err.message}\n\n${prev}`);
    } finally {
      setConsoleLoading(false);
    }
  };

  const adminColumns = [
    { title: 'Name', dataIndex: 'full_name' },
    { title: 'Email', dataIndex: 'email' },
    { title: 'Role', dataIndex: 'role', render: val => val === 'system_admin' ? 'System Admin' : 'Business Admin' },
    {
      title: 'Active', dataIndex: 'is_active',
      render: (val, record) => (
        record.email === IMMUTABLE_EMAIL ? (
          <Switch checked disabled />
        ) : (
          <Switch checked={val} onChange={(checked) => toggleActive(record, checked)} />
        )
      )
    },
    { title: 'Last Login', dataIndex: 'last_login', render: val => val ? new Date(val).toLocaleString() : 'Never' },
    {
      title: 'Actions',
      render: (_, record) => {
        const isImmutable = record.email === IMMUTABLE_EMAIL;
        return (
          <Space>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEditModal(record)}>Edit</Button>
            {isImmutable ? (
              <Text type="secondary" italic>Immutable</Text>
            ) : (
              <Popconfirm title="Deactivate this admin?" onConfirm={() => deleteAdmin(record.id)}>
                <Button type="link" danger icon={<DeleteOutlined />}>Deactivate</Button>
              </Popconfirm>
            )}
          </Space>
        );
      }
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2>System Administration</h2>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card><Statistic title="Total Bids" value={stats?.totalBids || 0} prefix={<FileTextOutlined />} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Tenants" value={stats?.totalTenants || 0} prefix={<ShopOutlined />} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Suppliers" value={stats?.totalSuppliers || 0} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Users" value={stats?.totalUsers || 0} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Cash (ZMW)" value={stats?.totalCashOnPlatform || 0} prefix={<DollarOutlined />} precision={2} /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="Uptime (s)" value={stats?.systemUptime ? Math.floor(stats.systemUptime) : 0} /></Card>
        </Col>
      </Row>

      {/* Health details */}
      {stats && (
        <Card title="System Health" size="small" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col span={8}><Text>DB: {stats.dbStatus}</Text></Col>
            <Col span={8}><Text>Memory RSS: {(stats.memory?.rss / 1024 / 1024).toFixed(1)} MB</Text></Col>
            <Col span={8}><Text>Heap Used: {(stats.memory?.heapUsed / 1024 / 1024).toFixed(1)} MB</Text></Col>
            <Col span={8}><Text>Load: {stats.cpuLoad?.join(', ')}</Text></Col>
            <Col span={8}><Text>Timestamp: {new Date(stats.timestamp).toLocaleString()}</Text></Col>
          </Row>
        </Card>
      )}

      {/* Admin Table */}
      <Card
        title="Platform Administrators"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setAddModalVisible(true); }}>
            Add Admin
          </Button>
        }
        style={{ marginBottom: 24 }}
      >
        <Text type="secondary" style={{ marginBottom: 12, display: 'block' }}>
          Maximum 3 active administrators. The primary system admin (Mundia Wamuyuwa) is immutable.
        </Text>
        <Table dataSource={admins} rowKey="id" columns={adminColumns} pagination={false} />
      </Card>

      {/* Server Console */}
      <Card title={<><ConsoleSqlOutlined /> Server Console</>}>
        <Input.Search
          placeholder="Type command (uptime, memory, load, db status, db version, active users, free)"
          value={consoleCommand}
          onChange={(e) => setConsoleCommand(e.target.value)}
          onSearch={runConsoleCommand}
          enterButton="Run"
          loading={consoleLoading}
        />
        <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, marginTop: 12, maxHeight: 300, overflowY: 'auto', borderRadius: 4 }}>
          {consoleOutput || 'Server console ready.\n'}
        </pre>
      </Card>

      {/* Add Admin Modal */}
      <Modal
        title="Add Administrator"
        open={addModalVisible}
        onCancel={() => setAddModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleAddAdmin}>
          <Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="system_admin">System Admin</Select.Option>
              <Select.Option value="business_admin">Business Admin</Select.Option>
            </Select>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={formLoading} block>Create</Button>
        </Form>
      </Modal>

      {/* Edit Admin Modal */}
      <Modal
        title="Edit Administrator"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        footer={null}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditAdmin}>
          <Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="system_admin">System Admin</Select.Option>
              <Select.Option value="business_admin">Business Admin</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="password" label="New Password (leave empty to keep current)">
            <Input.Password placeholder="Optional" />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={formLoading} block>Save Changes</Button>
        </Form>
      </Modal>
    </div>
  );
}