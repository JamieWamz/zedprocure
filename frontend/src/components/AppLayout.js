import React from 'react';
import { Layout, Button, Typography, Space, Select, Tooltip } from 'antd';
import { LogoutOutlined, ArrowLeftOutlined, BankOutlined, BulbOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigate, useLocation } from 'react-router-dom';

const { Header, Content } = Layout;
const { Text } = Typography;

export default function AppLayout({ children, showBack = false }) {
  const { logout, user, activeTenantId, setActiveTenantId, tenants } = useAuth();
  const { appearance, setAppearance } = useTheme();
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
        className="header-gradient app-layout-header" 
        role="banner"
      >
        <div className="app-layout-header-left" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {showBack && (
            <Button 
              type="text" 
              icon={<ArrowLeftOutlined />} 
              onClick={handleBack} 
              style={{ color: '#fff', whiteSpace: 'nowrap' }}
              aria-label="Go back"
            >
              Back
            </Button>
          )}
          <Text 
            strong 
            className="header-title"
            style={{ color: '#fff', fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            aria-label={currentTitle}
          >
            Freshstart Procurement Portal
          </Text>
        </div>
        <div className="app-layout-header-right" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Tooltip title="Appearance">
            <Select 
              className="header-appearance-select"
              aria-label="Appearance" 
              value={appearance} 
              onChange={setAppearance} 
              style={{ width: 118 }} 
              prefix={<BulbOutlined />}
              options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} 
            />
          </Tooltip>
          {showOrgPicker && (
            <Tooltip title="Select a Workspace/Organization">
              <Select
                className="header-org-picker"
                value={activeTenantId}
                onChange={setActiveTenantId}
                style={{ minWidth: 160 }}
                placeholder="Select Workspace"
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
            <Text style={{ color: '#ffd666', fontSize: 12, whiteSpace: 'nowrap' }}>
              Select Workspace
            </Text>
          )}
          <Text className="header-user-email" style={{ color: '#fff', fontSize: 13, whiteSpace: 'nowrap' }} aria-label={`Logged in as ${user?.email || 'User'}`}>
            {user?.email || 'User'}
          </Text>
          <Button 
            type="text" 
            icon={<LogoutOutlined />} 
            onClick={handleLogout} 
            style={{ color: '#fff', whiteSpace: 'nowrap' }}
            aria-label="Logout"
          >
            Logout
          </Button>
        </div>
      </Header>
      <Content className="content-wrapper" role="main">
        {children}
      </Content>
    </Layout>
  );
}
