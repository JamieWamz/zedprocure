import React from 'react';
import { Layout, Button, Typography, Space, Select, Tooltip } from 'antd';
import { LogoutOutlined, ArrowLeftOutlined, MenuOutlined, BankOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const { Header, Content } = Layout;
const { Text } = Typography;

export default function AppLayout({ children, showBack = false }) {
  const { logout, user, activeTenantId, setActiveTenantId, tenants } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleBack = () => {
    navigate(-1);
  };

  const pathTitles = {
    '/system-health': 'System Health',
    '/admin-dashboard': 'Business Administration',
    '/admin-dashboard/ledger': 'Financial Ledger',
    '/admin-dashboard/verification': 'Supplier Verification',
    '/tenant-admin': 'Procurement Management',
    '/tenant-admin/bids/new': 'Create New Bid',
    '/customer': 'Customer Portal',
    '/supplier': 'Supplier Portal',
  };
  const currentTitle = pathTitles[location.pathname] || 'Procurement Portal';

  // Determine if we should show the organization picker
  const showOrgPicker = user && (user.role === 'business_admin' || user.role === 'system_admin') && tenants.length > 0;

  return (
    <Layout className="app-bg">
      <Header 
        className="header-gradient" 
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {showBack && (
            <Button 
              type="text" 
              icon={<ArrowLeftOutlined />} 
              onClick={handleBack} 
              style={{ color: '#fff' }}
              aria-label="Go back"
            >
              Back
            </Button>
          )}
          <Text 
            strong 
            style={{ color: '#fff', fontSize: 18 }}
            aria-label={currentTitle}
          >
            Freshstart Procurement Portal
          </Text>
        </div>
        <Space>
          {showOrgPicker && (
            <Tooltip title="Select a Workspace/Organization">
              <Select
                value={activeTenantId}
                onChange={setActiveTenantId}
                style={{ minWidth: 200 }}
                placeholder="Select a Workspace/Organization"
                dropdownMatchSelectWidth={false}
                prefix={<BankOutlined />}
              >
                {tenants.map(t => (
                  <Select.Option key={t.id} value={t.id}>
                    {t.name}
                  </Select.Option>
                ))}
              </Select>
            </Tooltip>
          )}
          {!activeTenantId && showOrgPicker && (
            <Text style={{ color: '#ffd666', fontSize: 12 }}>
              Select a Workspace/Organization
            </Text>
          )}
          <Text style={{ color: '#fff' }} aria-label={`Logged in as ${user?.email || 'User'}`}>
            {user?.email || 'User'}
          </Text>
          <Button 
            type="text" 
            icon={<LogoutOutlined />} 
            onClick={handleLogout} 
            style={{ color: '#fff' }}
            aria-label="Logout"
          >
            Logout
          </Button>
        </Space>
      </Header>
      <Content className="content-wrapper" role="main">
        {children}
      </Content>
    </Layout>
  );
}
