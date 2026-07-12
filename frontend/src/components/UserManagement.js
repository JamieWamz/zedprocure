import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, message, Tag, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const { user } = useAuth();
  const isTenantAdmin = user?.role === 'tenant_admin';

  const fetchUsers = async () => {
    try {
      const { data } = await axios.get('/api/admin/tenant-users');
      setUsers(data);
    } catch {
      message.error('Failed to load users');
    }
  };

  const fetchTenants = async () => {
    if (isTenantAdmin) return;
    try {
      const { data } = await axios.get('/api/admin/tenants');
      setTenants(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchTenants();
  }, []);

  const handleCreate = async (values) => {
    setLoading(true);
    try {
      await axios.post('/api/admin/tenant-users', values);
      message.success('User created successfully');
      setModalOpen(false);
      form.resetFields();
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (userId) => {
    try {
      const { data } = await axios.put(`/api/admin/tenant-users/${userId}/toggle-active`);
      message.success(`User ${data.is_active ? 'activated' : 'deactivated'}`);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to toggle user status');
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'full_name' },
    { title: 'Email', dataIndex: 'email' },
    { title: 'Tenant', dataIndex: 'tenant_name' },
    { title: 'Role', dataIndex: 'role', render: val => <Tag>{val}</Tag> },
    {
      title: 'Active',
      dataIndex: 'is_active',
      render: (val, record) => (
        !isTenantAdmin ? (
          <Switch checked={val} onChange={() => handleToggleActive(record.id)} />
        ) : (
          <Tag color={val ? 'green' : 'red'}>{val ? 'Active' : 'Inactive'}</Tag>
        )
      ),
    },
    { title: 'Created', dataIndex: 'created_at', render: val => new Date(val).toLocaleDateString() },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>User Accounts</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Create User
        </Button>
      </div>

      <Table dataSource={users} rowKey="id" columns={columns} />

      <Modal
        title="Create New User"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          {!isTenantAdmin && (
            <Form.Item name="tenant_id" label="Tenant" rules={[{ required: true }]}>
              <Select placeholder="Select tenant">
                {tenants.map(t => (
                  <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
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
              <Select.Option value="tenant_admin">Tenant Admin</Select.Option>
              <Select.Option value="customer">Customer</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}