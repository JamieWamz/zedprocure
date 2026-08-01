import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, List, Modal,
  Popconfirm, Progress, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag,
  Typography, message,
} from 'antd';
import {
  AuditOutlined, BankOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloudServerOutlined, CodeOutlined, ConsoleSqlOutlined, DatabaseOutlined,
  DeploymentUnitOutlined, ExperimentOutlined, FileTextOutlined, PlusOutlined,
  PlayCircleOutlined, ReloadOutlined, RocketOutlined, SafetyCertificateOutlined,
  ShopOutlined, TeamOutlined, ToolOutlined, UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminSupportInbox from './AdminSupportInbox';
import RotatingMediaBanner from './RotatingMediaBanner';
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

function duration(value) {
  if (Number(value) < 1000) return `${value || 0} ms`;
  return `${(Number(value) / 1000).toFixed(1)} s`;
}

const RISK_META = {
  safe: { color: 'success', label: 'Read-only / test' },
  caution: { color: 'warning', label: 'Maintenance' },
  critical: { color: 'error', label: 'Privileged change' },
};

const SYSTEM_TAB_KEYS = new Set([
  'overview', 'tests', 'operations', 'deployments', 'admins',
  'organizations', 'users', 'suppliers', 'audit', 'console',
  'support',
]);

export default function SystemHealthPortal() {
  const [stats, setStats] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [controlPlane, setControlPlane] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState(null);
  const [operationResult, setOperationResult] = useState(null);
  const [operationModal, setOperationModal] = useState(null);
  const [operationConfirmation, setOperationConfirmation] = useState('');
  const [deployTarget, setDeployTarget] = useState('all');
  const [clearDeployCache, setClearDeployCache] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const tabQuery = new URLSearchParams(location.search).get('tab');
  const requestedTab = SYSTEM_TAB_KEYS.has(tabQuery) ? tabQuery : 'overview';

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
      const [statsRes, adminsRes, tenantsRes, usersRes, suppliersRes, auditRes, controlRes] = await Promise.all([
        axios.get('/api/system/stats'),
        axios.get('/api/system/admins'),
        axios.get('/api/admin/tenants'),
        axios.get('/api/admin/tenant-users'),
        axios.get('/api/admin/suppliers'),
        axios.get('/api/admin/audit-logs').catch(() => ({ data: [] })),
        axios.get('/api/system/control-plane').catch(() => ({ data: null })),
      ]);
      setStats(statsRes.data);
      setAdmins(adminsRes.data);
      setTenants(tenantsRes.data);
      setTenantUsers(usersRes.data);
      setSuppliers(suppliersRes.data);
      setAuditLogs(auditRes.data);
      setControlPlane(controlRes.data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load system admin console');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectTab = (tab) => {
    navigate(`/system-health?tab=${encodeURIComponent(tab)}`, { replace: true });
    window.setTimeout(() => document.getElementById('system-control-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const executeOperation = async (operation, confirmation = '', args = {}) => {
    setOperationLoading(operation.id);
    try {
      const { data } = await axios.post(`/api/system/operations/${operation.id}`, { confirmation, args });
      setOperationResult(data);
      setOperationModal(null);
      setOperationConfirmation('');
      message.success(data.summary || `${operation.label} completed`);
      const controlRes = await axios.get('/api/system/control-plane');
      setControlPlane(controlRes.data);
    } catch (error) {
      const detail = error.response?.data?.detail || error.response?.data?.error || 'Operation failed';
      setOperationResult({ operation: operation.id, status: 'failed', summary: detail });
      message.error(detail);
    } finally {
      setOperationLoading(null);
    }
  };

  const requestOperation = (operation) => {
    if (!operation.enabled) return message.warning(operation.disabledReason || 'This operation is not configured.');
    if (operation.confirmation) {
      setOperationConfirmation('');
      setDeployTarget('all');
      setClearDeployCache(false);
      setOperationModal(operation);
      return;
    }
    executeOperation(operation);
  };

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
    { title: 'Email', dataIndex: 'email', render: (value, record) => record.role === 'system_admin' ? <Space><Text>{value}</Text><Tag color="gold">Primary</Tag></Space> : value },
    { title: 'Role', dataIndex: 'role', render: value => <Tag color={value === 'system_admin' ? 'purple' : 'blue'}>{value.replace('_', ' ')}</Tag> },
    {
      title: 'Active',
      dataIndex: 'is_active',
      render: (value, record) => record.role === 'system_admin'
        ? <Switch checked disabled />
        : <Switch checked={value} onChange={checked => toggleAdminActive(record, checked)} />,
    },
    { title: 'Last Login', dataIndex: 'last_login', render: value => value ? new Date(value).toLocaleString() : 'Never' },
    {
      title: 'Actions',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openEditAdmin(record)}>Edit</Button>
          {record.role === 'system_admin' ? (
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

  const operationHistoryColumns = [
    { title: 'When', dataIndex: 'createdAt', render: value => value ? new Date(value).toLocaleString() : '-' },
    { title: 'Operation', dataIndex: 'operation', render: value => <Text code>{String(value || '').replaceAll('_', ' ')}</Text> },
    { title: 'Result', dataIndex: 'status', render: value => <Tag color={value === 'passed' ? 'success' : value === 'warning' ? 'warning' : 'error'}>{value || 'unknown'}</Tag> },
    { title: 'Summary', dataIndex: 'summary', ellipsis: true },
    { title: 'Duration', dataIndex: 'durationMs', render: value => duration(value) },
  ];

  const operations = controlPlane?.operations || [];
  const operationsFor = group => operations.filter(operation => operation.group === group);
  const renderOperationCard = operation => {
    const risk = RISK_META[operation.risk] || RISK_META.safe;
    return (
      <Col xs={24} md={12} xl={8} key={operation.id}>
        <Card className={`system-operation-card system-operation-card--${operation.risk}`}>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Space style={{ justifyContent: 'space-between', width: '100%' }} align="start">
              <div className="system-operation-icon">
                {operation.group === 'tests' ? <ExperimentOutlined /> : operation.group === 'deployment' ? <RocketOutlined /> : operation.group === 'upgrade' ? <DeploymentUnitOutlined /> : <ToolOutlined />}
              </div>
              <Tag color={risk.color}>{risk.label}</Tag>
            </Space>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>{operation.label}</Typography.Title>
              <Text type="secondary">{operation.description}</Text>
            </div>
            {!operation.enabled && <Alert type="warning" showIcon message={operation.disabledReason} />}
            <Button
              type={operation.risk === 'safe' ? 'primary' : 'default'}
              danger={operation.risk === 'critical'}
              icon={<PlayCircleOutlined />}
              block
              disabled={!operation.enabled}
              loading={operationLoading === operation.id}
              onClick={() => requestOperation(operation)}
            >
              {operation.confirmation ? 'Review & run' : 'Run now'}
            </Button>
          </Space>
        </Card>
      </Col>
    );
  };

  const operationResultPanel = operationResult && (
    <Card className="system-operation-result" style={{ marginBottom: 18 }}>
      <Alert
        type={operationResult.status === 'passed' ? 'success' : operationResult.status === 'warning' ? 'warning' : 'error'}
        showIcon
        message={operationResult.summary}
        description={operationResult.operation ? `Operation: ${operationResult.operation.replaceAll('_', ' ')} · ${duration(operationResult.durationMs)}` : undefined}
        action={<Button size="small" onClick={() => setOperationResult(null)}>Dismiss</Button>}
      />
      {operationResult.checks?.length > 0 && (
        <List
          size="small"
          style={{ marginTop: 12 }}
          dataSource={operationResult.checks}
          renderItem={item => (
            <List.Item extra={<Tag color={item.status === 'passed' ? 'success' : item.status === 'warning' ? 'warning' : 'error'}>{item.status}</Tag>}>
              <List.Item.Meta title={item.name} description={item.detail} />
            </List.Item>
          )}
        />
      )}
      {operationResult.deployments?.length > 0 && (
        <Descriptions bordered size="small" column={1} style={{ marginTop: 12 }}>
          {operationResult.deployments.map(deploy => (
            <Descriptions.Item key={deploy.target} label={`${deploy.target} deploy`}>{deploy.deployId || deploy.status}</Descriptions.Item>
          ))}
        </Descriptions>
      )}
    </Card>
  );

  const tabs = [
    {
      key: 'overview',
      label: 'Overview',
      children: (
        <>
          {operationResultPanel}
          <Card className="system-command-hero" style={{ marginBottom: 18 }}>
            <Row gutter={[24, 18]} align="middle">
              <Col xs={24} lg={15}>
                <Text className="next-action-eyebrow">Operations control plane</Text>
                <Typography.Title level={2} style={{ margin: '5px 0 8px' }}>Platform command center</Typography.Title>
                <Text type="secondary">
                  Test production health, apply schema upgrades, run maintenance, inspect the release, and trigger guarded deployments from one audited workspace.
                </Text>
                <Space wrap style={{ marginTop: 18 }}>
                  <Button type="primary" icon={<ExperimentOutlined />} onClick={() => selectTab('tests')}>Run test suites</Button>
                  <Button icon={<ToolOutlined />} onClick={() => selectTab('operations')}>Maintenance tools</Button>
                  <Button icon={<RocketOutlined />} onClick={() => selectTab('deployments')}>Update & deploy</Button>
                  <Button icon={<ConsoleSqlOutlined />} onClick={() => selectTab('console')}>Developer console</Button>
                </Space>
              </Col>
              <Col xs={24} lg={9}>
                <div className="release-status-panel">
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Text strong>Current release</Text>
                    <Tag color={controlPlane?.database?.migrations?.pending?.length ? 'warning' : 'success'}>
                      {controlPlane?.database?.migrations?.pending?.length ? 'Upgrade available' : 'Up to date'}
                    </Tag>
                  </Space>
                  <Text code>{controlPlane?.runtime?.commit?.slice(0, 12) || 'Loading…'}</Text>
                  <Text type="secondary">{controlPlane?.runtime?.service || 'Service'} · Node {controlPlane?.runtime?.node || '-'}</Text>
                  <Progress
                    percent={controlPlane?.database?.migrations?.local?.length
                      ? Math.round((controlPlane.database.migrations.applied.length / controlPlane.database.migrations.local.length) * 100)
                      : 0}
                    status={controlPlane?.database?.migrations?.pending?.length ? 'active' : 'success'}
                    format={() => `${controlPlane?.database?.migrations?.applied?.length || 0}/${controlPlane?.database?.migrations?.local?.length || 0} migrations`}
                  />
                </div>
              </Col>
            </Row>
          </Card>

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
      key: 'tests',
      label: <span><ExperimentOutlined /> Test Center</span>,
      children: (
        <>
          {operationResultPanel}
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Production-safe diagnostic suites"
            description="These tests use read-only database checks and configuration assertions. They do not execute arbitrary shell commands or expose secret values."
          />
          <Row gutter={[16, 16]}>{operationsFor('tests').map(renderOperationCard)}</Row>
        </>
      ),
    },
    {
      key: 'operations',
      label: <span><ToolOutlined /> Operations</span>,
      children: (
        <>
          {operationResultPanel}
          <Card title="Maintenance & developer tools" className="table-card" style={{ marginBottom: 18 }}>
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message="Privileged operations are allow-listed and audited"
              description="Maintenance and upgrade actions require an exact confirmation phrase. Only one database maintenance operation can run at a time."
              style={{ marginBottom: 16 }}
            />
            <Row gutter={[16, 16]}>
              {[...operationsFor('developer'), ...operationsFor('maintenance'), ...operationsFor('upgrade')].map(renderOperationCard)}
            </Row>
          </Card>
          <Card title="Recent operation history" className="table-card">
            <Table
              rowKey="id"
              dataSource={controlPlane?.history || []}
              columns={operationHistoryColumns}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 760 }}
              locale={{ emptyText: <Empty description="No system operations have been run yet" /> }}
            />
          </Card>
        </>
      ),
    },
    {
      key: 'deployments',
      label: <span><RocketOutlined /> Update & Deploy</span>,
      children: (
        <>
          {operationResultPanel}
          <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
            <Col xs={24} lg={12}>
              <Card title={<span><CodeOutlined /> Release & Runtime</span>} className="table-card" style={{ height: '100%' }}>
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="Commit"><Text code copyable>{controlPlane?.runtime?.commit || '-'}</Text></Descriptions.Item>
                  <Descriptions.Item label="Application">{controlPlane?.runtime?.application || '-'} {controlPlane?.runtime?.version ? `v${controlPlane.runtime.version}` : ''}</Descriptions.Item>
                  <Descriptions.Item label="Environment"><Tag color="blue">{controlPlane?.runtime?.environment || '-'}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Node runtime">{controlPlane?.runtime?.node || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Service">{controlPlane?.runtime?.service || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Branch">{controlPlane?.deployment?.branch || 'main'}</Descriptions.Item>
                  <Descriptions.Item label="Started">{controlPlane?.runtime?.startedAt ? new Date(controlPlane.runtime.startedAt).toLocaleString() : '-'}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title={<span><DatabaseOutlined /> Database Upgrade State</span>} className="table-card" style={{ height: '100%' }}>
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="Database">{controlPlane?.database?.name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="PostgreSQL">{controlPlane?.database?.version || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Database size">{mb(controlPlane?.database?.sizeBytes)}</Descriptions.Item>
                  <Descriptions.Item label="Applied migrations">{controlPlane?.database?.migrations?.applied?.length || 0}</Descriptions.Item>
                  <Descriptions.Item label="Pending migrations">
                    <Tag color={controlPlane?.database?.migrations?.pending?.length ? 'warning' : 'success'}>
                      {controlPlane?.database?.migrations?.pending?.length || 0}
                    </Tag>
                  </Descriptions.Item>
                </Descriptions>
                {controlPlane?.database?.migrations?.pending?.length > 0 && (
                  <List
                    size="small"
                    header={<Text strong>Pending upgrade files</Text>}
                    dataSource={controlPlane.database.migrations.pending}
                    renderItem={item => <List.Item><Text code>{item}</Text></List.Item>}
                  />
                )}
              </Card>
            </Col>
          </Row>
          <Card title="Deployment controls" className="table-card">
            <Alert
              type="info"
              showIcon
              message="Application updates remain Git-driven"
              description="This control deploys the latest commit already pushed to the configured Render branch. It does not edit source code or install packages inside an ephemeral production container."
              style={{ marginBottom: 16 }}
            />
            <Row gutter={[16, 16]}>{operationsFor('deployment').map(renderOperationCard)}</Row>
          </Card>
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
      key: 'support',
      label: 'Customer Care',
      children: <AdminSupportInbox />,
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
    <div className="workspace-page system-control-plane">
      <RotatingMediaBanner images={cdnImages.systemHeroes} imagePosition="center 45%" ariaLabel="System command center">
        <div>
          <h2><CloudServerOutlined /> System Command Center</h2>
          <p>Test, maintain, upgrade and deploy the platform from one guarded operations workspace.</p>
        </div>
        <div className="page-media-actions">
          <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>Refresh</Button>
        </div>
      </RotatingMediaBanner>

      <Tabs
        id="system-control-tabs"
        className="workspace-tabs system-control-tabs"
        activeKey={requestedTab}
        onChange={selectTab}
        items={tabs}
      />

      <Modal
        title={operationModal ? `Confirm: ${operationModal.label}` : 'Confirm system operation'}
        open={Boolean(operationModal)}
        onCancel={() => {
          if (operationLoading) return;
          setOperationModal(null);
          setOperationConfirmation('');
        }}
        closable={!operationLoading}
        maskClosable={false}
        keyboard={!operationLoading}
        footer={[
          <Button
            key="cancel"
            disabled={Boolean(operationLoading)}
            onClick={() => {
              setOperationModal(null);
              setOperationConfirmation('');
            }}
          >
            Cancel
          </Button>,
          <Button
            key="run"
            type="primary"
            danger={operationModal?.risk === 'critical'}
            icon={<PlayCircleOutlined />}
            loading={operationLoading === operationModal?.id}
            disabled={!operationModal || operationConfirmation !== operationModal.confirmation}
            onClick={() => executeOperation(
              operationModal,
              operationConfirmation,
              operationModal?.id === 'trigger_deploy'
                ? { target: deployTarget, clearCache: clearDeployCache }
                : {}
            )}
          >
            Run {operationModal?.label || 'operation'}
          </Button>,
        ]}
      >
        {operationModal && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={operationModal.risk === 'critical' ? 'error' : 'warning'}
              showIcon
              icon={<WarningOutlined />}
              message={RISK_META[operationModal.risk]?.label || 'Privileged operation'}
              description={operationModal.description}
            />

            {operationModal.id === 'trigger_deploy' && (
              <div className="system-operation-options">
                <div>
                  <Text strong>Deployment target</Text>
                  <Text type="secondary">Choose which configured Render service receives the latest commit.</Text>
                  <Select
                    value={deployTarget}
                    onChange={setDeployTarget}
                    style={{ width: '100%', marginTop: 8 }}
                    options={[
                      { value: 'all', label: 'Frontend and backend' },
                      { value: 'backend', label: 'Backend only' },
                      { value: 'frontend', label: 'Frontend only' },
                    ]}
                  />
                </div>
                <Divider />
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <div>
                    <Text strong>Clear build cache</Text>
                    <br />
                    <Text type="secondary">Use only when cached dependencies or build artifacts are stale.</Text>
                  </div>
                  <Switch checked={clearDeployCache} onChange={setClearDeployCache} />
                </Space>
              </div>
            )}

            <div>
              <Text strong>Type <Text code>{operationModal.confirmation}</Text> to continue</Text>
              <Input
                autoFocus
                value={operationConfirmation}
                onChange={event => setOperationConfirmation(event.target.value)}
                onPressEnter={() => {
                  if (operationConfirmation === operationModal.confirmation && !operationLoading) {
                    executeOperation(
                      operationModal,
                      operationConfirmation,
                      operationModal.id === 'trigger_deploy'
                        ? { target: deployTarget, clearCache: clearDeployCache }
                        : {}
                    );
                  }
                }}
                placeholder={operationModal.confirmation}
                status={operationConfirmation && operationConfirmation !== operationModal.confirmation ? 'error' : undefined}
                style={{ marginTop: 8 }}
              />
              <Text type="secondary">The operation and its result will be recorded in the immutable system log.</Text>
            </div>
          </Space>
        )}
      </Modal>

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
              disabled={selectedAdmin?.role === 'system_admin'}
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
