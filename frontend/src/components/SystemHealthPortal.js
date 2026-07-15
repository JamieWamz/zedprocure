import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select,
  Space, Statistic, Switch, Table, Tabs, Tag, Typography, message,
} from 'antd';
import {
  AuditOutlined, BankOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ConsoleSqlOutlined, DatabaseOutlined, FileTextOutlined, PlusOutlined,
  ReloadOutlined, SafetyCertificateOutlined, ShopOutlined, TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';

const { Text } = Typography;
const IMMUTABLE_EMAIL = 'wamuyuwamundia@gmail.com';

function money(value) {
  return `ZMW ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function mb(bytes) {
  return `${Number((bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
}

export default function SystemHealthPortal() {
  const [stats, setStats] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [editAdminOpen, setEditAdminOpen] = useState(false);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState(null);

  const [adminForm] = Form.useForm();
  const [editAdminForm] = Form.useForm();
  const [tenantForm] = Form.useForm();
  const [userForm] = Form.useForm();

  const [consoleCommand, setConsoleCommand] = useState('');
  const [consoleOutput, setConsoleOutput] = useState('');
  const [consoleLoading, setConsoleLoading] = useState(false);
  const activeAdmins = admins.filter(admin => admin.is_active);
  const hasSystemAdmin = activeAdmins.some(admin => admin.role === 'system_admin');
  const hasBusinessAdmin = activeAdmins.some(admin => admin.role === 'business_admin');
  const adminSeatsFull = hasSystemAdmin && hasBusinessAdmin;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, adminsRes, tenantsRes, usersRes, suppliersRes, auditRes] = await Promise.all([
        axios.get('/api/system/stats'),
        axios.get('/api/system/admins'),
        axios.get('/api/admin/tenants'),
        axios.get('/api/admin/tenant-users'),
        axios.get('/api/admin/suppliers'),
        axios.get('/api/admin/audit-logs').catch(() => ({ data: [] })),
      ]);
      setStats(statsRes.data);
      setAdmins(adminsRes.data);
      setTenants(tenantsRes.data);
      setTenantUsers(usersRes.data);
      setSuppliers(suppliersRes.data);
      setAuditLogs(auditRes.data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load system admin console');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => {
      axios.get('/api/system/stats').then(res => setStats(res.data)).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const handleAddAdmin = async (values) => {
    setFormLoading(true);
    try {
      await axios.post('/api/admin/admins', values);
      message.success('Administrator created');
      setAddAdminOpen(false);
      adminForm.resetFields();
      loadAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create administrator');
    } finally {
      setFormLoading(false);
    }
  };

  const openEditAdmin = (record) => {
    setSelectedAdmin(record);
    editAdminForm.setFieldsValue(record);
    setEditAdminOpen(true);
  };

  const handleEditAdmin = async (values) => {
    setFormLoading(true);
    try {
      await axios.put(`/api/system/admins/${selectedAdmin.id}`, values);
      message.success('Administrator updated');
      setEditAdminOpen(false);
      loadAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update administrator');
    } finally {
      setFormLoading(false);
    }
  };

  const toggleAdminActive = async (record, checked) => {
    if (record.email === IMMUTABLE_EMAIL) {
      message.error('Cannot deactivate the immutable admin');
      return;
    }
    try {
      await axios.put(`/api/system/admins/${record.id}`, { is_active: checked });
      message.success(`Admin ${checked ? 'activated' : 'deactivated'}`);
      loadAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update admin');
    }
  };

  const deactivateAdmin = async (id) => {
    try {
      await axios.delete(`/api/system/admins/${id}`);
      message.success('Admin deactivated');
      loadAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to deactivate admin');
    }
  };

  const handleCreateTenant = async (values) => {
    setFormLoading(true);
    try {
      await axios.post('/api/admin/tenants', values);
      message.success('Organization created');
      setTenantOpen(false);
      tenantForm.resetFields();
      loadAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create organization');
    } finally {
      setFormLoading(false);
    }
  };

  const handleCreateUser = async (values) => {
    setFormLoading(true);
    try {
      await axios.post('/api/admin/tenant-users', values);
      message.success('User created');
      setUserOpen(false);
      userForm.resetFields();
      loadAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  };

  const toggleTenantUser = async (id) => {
    try {
      await axios.put(`/api/admin/tenant-users/${id}/toggle-active`);
      message.success('User status updated');
      loadAll();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to update user');
    }
  };

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
    { title: 'Email', dataIndex: 'email', render: (value, record) => record.email === IMMUTABLE_EMAIL ? <Space><Text>{value}</Text><Tag color="gold">Primary</Tag></Space> : value },
    { title: 'Role', dataIndex: 'role', render: value => <Tag color={value === 'system_admin' ? 'purple' : 'blue'}>{value.replace('_', ' ')}</Tag> },
    {
      title: 'Active',
      dataIndex: 'is_active',
      render: (value, record) => record.email === IMMUTABLE_EMAIL
        ? <Switch checked disabled />
        : <Switch checked={value} onChange={checked => toggleAdminActive(record, checked)} />,
    },
    { title: 'Last Login', dataIndex: 'last_login', render: value => value ? new Date(value).toLocaleString() : 'Never' },
    {
      title: 'Actions',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openEditAdmin(record)}>Edit</Button>
          {record.email === IMMUTABLE_EMAIL ? (
            <Text type="secondary">Immutable</Text>
          ) : (
            <Popconfirm title="Deactivate this admin?" onConfirm={() => deactivateAdmin(record.id)}>
              <Button size="small" danger>Deactivate</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const tenantColumns = [
    { title: 'Organization', dataIndex: 'name' },
    { title: 'Registration', dataIndex: 'registration_number', render: value => value || '-' },
    { title: 'Status', dataIndex: 'is_active', render: value => <Tag color={value ? 'green' : 'red'}>{value ? 'Active' : 'Inactive'}</Tag> },
    { title: 'Users', dataIndex: 'active_users' },
    { title: 'Bids', dataIndex: 'total_bids' },
    { title: 'Created', dataIndex: 'created_at', render: value => value ? new Date(value).toLocaleDateString() : '-' },
  ];

  const userColumns = [
    { title: 'Name', dataIndex: 'full_name' },
    { title: 'Email', dataIndex: 'email' },
    { title: 'Organization', dataIndex: 'tenant_name' },
    { title: 'Role', dataIndex: 'role', render: value => <Tag>{value}</Tag> },
    { title: 'Active', dataIndex: 'is_active', render: (value, record) => <Switch checked={value} onChange={() => toggleTenantUser(record.id)} /> },
    { title: 'Last Login', dataIndex: 'last_login', render: value => value ? new Date(value).toLocaleString() : 'Never' },
  ];

  const supplierColumns = [
    { title: 'Supplier', dataIndex: 'company_name' },
    { title: 'Registration', dataIndex: 'registration_number', render: value => value || '-' },
    {
      title: 'Verification',
      dataIndex: 'verification_status',
      render: value => {
        const color = value === 'verified' ? 'green' : value === 'rejected' ? 'red' : 'gold';
        return <Tag color={color}>{value.replace('_', ' ')}</Tag>;
      },
    },
    { title: 'Active', dataIndex: 'is_active', render: value => <Tag color={value ? 'green' : 'red'}>{value ? 'Active' : 'Inactive'}</Tag> },
    { title: 'Users', dataIndex: 'user_count' },
    { title: 'Created', dataIndex: 'created_at', render: value => value ? new Date(value).toLocaleDateString() : '-' },
  ];

  const auditColumns = [
    { title: 'When', dataIndex: 'created_at', render: value => new Date(value).toLocaleString() },
    { title: 'Actor', dataIndex: 'actor_email', render: value => value || '-' },
    { title: 'Action', dataIndex: 'action', render: value => <Tag>{value}</Tag> },
    { title: 'Target', render: (_, row) => row.target_type ? `${row.target_type}${row.target_id ? ` / ${row.target_id.slice(0, 8)}` : ''}` : '-' },
  ];

  const tabs = [
    {
      key: 'overview',
      label: 'Overview',
      children: (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Organizations" value={stats?.activeTenants || 0} suffix={`/ ${stats?.totalTenants || 0}`} prefix={<ShopOutlined />} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Active Users" value={stats?.activeUsers || 0} suffix={`/ ${stats?.totalUsers || 0}`} prefix={<TeamOutlined />} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Verified Suppliers" value={stats?.verifiedSuppliers || 0} suffix={`/ ${stats?.totalSuppliers || 0}`} prefix={<SafetyCertificateOutlined />} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Cash Controlled" value={money(stats?.totalCashOnPlatform)} prefix={<BankOutlined />} valueStyle={{ color: '#389e0d' }} /></Card></Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Active Bids" value={stats?.activeBids || 0} prefix={<FileTextOutlined />} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Active Orders" value={stats?.orders?.active || 0} prefix={<CheckCircleOutlined />} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Open Invoices" value={stats?.invoices?.openCount || 0} prefix={<ClockCircleOutlined />} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card><Statistic title="Overdue Invoices" value={stats?.invoices?.overdueCount || 0} valueStyle={{ color: Number(stats?.invoices?.overdueCount || 0) > 0 ? '#cf1322' : '#389e0d' }} /></Card></Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="Platform Health" className="table-card">
                <Space direction="vertical" size={8}>
                  <Text>Database: <Tag color={stats?.dbStatus === 'connected' ? 'green' : 'red'}>{stats?.dbStatus || 'unknown'}</Tag></Text>
                  <Text>Ledger: <Tag color={stats?.ledger?.balanced ? 'green' : 'red'}>{stats?.ledger?.balanced ? 'Balanced' : 'Review needed'}</Tag></Text>
                  <Text>Journal entries: {stats?.ledger?.entries || 0}</Text>
                  <Text>Memory RSS: {mb(stats?.memory?.rss)} · Heap used: {mb(stats?.memory?.heapUsed)}</Text>
                  <Text>Load average: {stats?.cpuLoad?.map(value => Number(value).toFixed(2)).join(', ') || '-'}</Text>
                  <Text>Uptime: {stats?.systemUptime ? `${Math.floor(stats.systemUptime / 3600)}h ${Math.floor((stats.systemUptime % 3600) / 60)}m` : '-'}</Text>
                  <Text>Last refresh: {stats?.timestamp ? new Date(stats.timestamp).toLocaleString() : '-'}</Text>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Attention Queue" className="table-card">
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Alert type={Number(stats?.pendingSuppliers || 0) ? 'warning' : 'success'} showIcon message={`${stats?.pendingSuppliers || 0} suppliers pending verification`} />
                  <Alert type={Number(stats?.orders?.disputed || 0) ? 'error' : 'success'} showIcon message={`${stats?.orders?.disputed || 0} disputed orders`} />
                  <Alert type={Number(stats?.invoices?.overdueCount || 0) ? 'warning' : 'success'} showIcon message={`${money(stats?.invoices?.arOverdue)} overdue receivables`} />
                  <Alert type="info" showIcon message={`${stats?.audit?.last24h || 0} audit events in the last 24 hours`} />
                </Space>
              </Card>
            </Col>
          </Row>
        </>
      ),
    },
    {
      key: 'admins',
      label: 'Administrators',
      children: (
        <Card
          className="table-card"
          title="Platform Administrators"
          extra={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={adminSeatsFull}
              onClick={() => { adminForm.resetFields(); setAddAdminOpen(true); }}
            >
              Add Admin
            </Button>
          }
        >
          <Alert
            type={adminSeatsFull ? 'success' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message="Platform admin model: one System Admin and one Business Admin."
            description={`Active seats: System Admin ${hasSystemAdmin ? 'filled' : 'open'} · Business Admin ${hasBusinessAdmin ? 'filled' : 'open'}. The primary system admin is immutable.`}
          />
          <Table loading={loading} dataSource={admins} rowKey="id" columns={adminColumns} scroll={{ x: 900 }} />
        </Card>
      ),
    },
    {
      key: 'organizations',
      label: 'Organizations',
      children: (
        <Card
          className="table-card"
          title="Organizations"
          extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { tenantForm.resetFields(); setTenantOpen(true); }}>Create Organization</Button>}
        >
          <Table loading={loading} dataSource={tenants} rowKey="id" columns={tenantColumns} scroll={{ x: 760 }} />
        </Card>
      ),
    },
    {
      key: 'users',
      label: 'Users',
      children: (
        <Card
          className="table-card"
          title="Tenant Users"
          extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { userForm.resetFields(); setUserOpen(true); }}>Create User</Button>}
        >
          <Table loading={loading} dataSource={tenantUsers} rowKey="id" columns={userColumns} scroll={{ x: 980 }} />
        </Card>
      ),
    },
    {
      key: 'suppliers',
      label: 'Suppliers',
      children: (
        <Card className="table-card" title="Supplier Estate">
          <Table loading={loading} dataSource={suppliers} rowKey="id" columns={supplierColumns} scroll={{ x: 820 }} />
        </Card>
      ),
    },
    {
      key: 'audit',
      label: 'Audit',
      children: (
        <Card className="table-card" title="Recent Audit Events">
          <Table
            loading={loading}
            dataSource={auditLogs}
            rowKey="id"
            columns={auditColumns}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 820 }}
            locale={{ emptyText: <Empty description="No audit events yet" /> }}
          />
        </Card>
      ),
    },
    {
      key: 'console',
      label: 'Console',
      children: (
        <Card title={<><ConsoleSqlOutlined /> Server Console</>} className="table-card">
          <Input.Search
            placeholder="uptime, memory, load, db status, db version, active users, free"
            value={consoleCommand}
            onChange={e => setConsoleCommand(e.target.value)}
            onSearch={runConsoleCommand}
            enterButton="Run"
            loading={consoleLoading}
          />
          <pre className="console-output" style={{ padding: 12, marginTop: 12, maxHeight: 340, overflowY: 'auto' }}>
            {consoleOutput || 'Server console ready.\n'}
          </pre>
        </Card>
      ),
    },
  ];

  return (
    <div>
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.system})` }}>
        <div>
          <h2><DatabaseOutlined /> System Administration</h2>
          <p>Operate the whole platform: health, admin seats, organizations, users, suppliers, accounting signals and audit activity.</p>
        </div>
        <div className="page-media-actions">
          <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>Refresh</Button>
        </div>
      </div>

      <Tabs items={tabs} />

      <Modal title="Add Administrator" open={addAdminOpen} onCancel={() => setAddAdminOpen(false)} footer={null}>
        <Form form={adminForm} layout="vertical" onFinish={handleAddAdmin}>
          <Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={[
              { value: 'system_admin', label: 'System Admin', disabled: hasSystemAdmin },
              { value: 'business_admin', label: 'Business Admin', disabled: hasBusinessAdmin },
            ]} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={formLoading} block>Create</Button>
        </Form>
      </Modal>

      <Modal title="Edit Administrator" open={editAdminOpen} onCancel={() => setEditAdminOpen(false)} footer={null}>
        <Form form={editAdminForm} layout="vertical" onFinish={handleEditAdmin}>
          <Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select
              disabled={selectedAdmin?.email === IMMUTABLE_EMAIL}
              options={[
                { value: 'system_admin', label: 'System Admin', disabled: selectedAdmin?.role !== 'system_admin' && hasSystemAdmin },
                { value: 'business_admin', label: 'Business Admin', disabled: selectedAdmin?.role !== 'business_admin' && hasBusinessAdmin },
              ]}
            />
          </Form.Item>
          <Form.Item name="password" label="New Password"><Input.Password placeholder="Leave blank to keep current password" /></Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked"><Switch /></Form.Item>
          <Button type="primary" htmlType="submit" loading={formLoading} block>Save Changes</Button>
        </Form>
      </Modal>

      <Modal title="Create Organization" open={tenantOpen} onCancel={() => setTenantOpen(false)} onOk={() => tenantForm.submit()} confirmLoading={formLoading}>
        <Form form={tenantForm} layout="vertical" onFinish={handleCreateTenant}>
          <Form.Item name="name" label="Organization Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="registration_number" label="Registration Number"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Create Tenant User" open={userOpen} onCancel={() => setUserOpen(false)} onOk={() => userForm.submit()} confirmLoading={formLoading}>
        <Form form={userForm} layout="vertical" onFinish={handleCreateUser}>
          <Form.Item name="tenant_id" label="Organization" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={tenants.map(tenant => ({ value: tenant.id, label: tenant.name }))}
            />
          </Form.Item>
          <Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={[{ value: 'customer', label: 'Customer' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
