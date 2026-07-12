import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, message, Tag, Statistic, Row, Col, Card } from 'antd';
import { PlusOutlined, BankOutlined, TeamOutlined, FileTextOutlined } from '@ant-design/icons';
import axios from 'axios';

export default function TenantManagement() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchTenants = async () => {
    try {
      const { data } = await axios.get('/api/admin/tenants');
      setTenants(data);
    } catch {
      message.error('Failed to load tenants');
    }
  };

  useEffect(() => { fetchTenants(); }, []);

  const handleCreate = async (values) => {
    setLoading(true);
    try {
      await axios.post('/api/admin/tenants', values);
      message.success('Tenant created successfully');
      setModalOpen(false);
      form.resetFields();
      fetchTenants();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create tenant');
    } finally {
      setLoading(false);
    }
  };

  const totalActive = tenants.filter(t => t.is_active).length;
  const totalUsers = tenants.reduce((s, t) => s + parseInt(t.active_users || 0), 0);
  const totalBids = tenants.reduce((s, t) => s + parseInt(t.total_bids || 0), 0);

  const columns = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Reg. Number', dataIndex: 'registration_number' },
    { title: 'Status', dataIndex: 'is_active', render: val => <Tag color={val ? 'green' : 'red'}>{val ? 'Active' : 'Inactive'}</Tag> },
    { title: 'Users', dataIndex: 'active_users' },
    { title: 'Bids', dataIndex: 'total_bids' },
    { title: 'Created', dataIndex: 'created_at', render: val => new Date(val).toLocaleDateString() },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card><Statistic title="Active Tenants" value={totalActive} prefix={<BankOutlined />} /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="Total Users" value={totalUsers} prefix={<TeamOutlined />} /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="Total Bids" value={totalBids} prefix={<FileTextOutlined />} /></Card>
        </Col>
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Organizations (Tenants)</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Create Tenant
        </Button>
      </div>

      <Table dataSource={tenants} rowKey="id" columns={columns} />

      <Modal
        title="Create New Tenant"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Organization Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="registration_number" label="Registration Number">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}