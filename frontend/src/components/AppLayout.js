import React from 'react';
import { Layout, Button, Typography, Space } from 'antd';
import { LogoutOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const { Header, Content } = Layout;
const { Text } = Typography;

export default function AppLayout({ children, showBack = false }) {
  const { logout } = useAuth();
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#001529', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {showBack && (
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack} style={{ color: '#fff' }}>
              Back
            </Button>
          )}
          <Text strong style={{ color: '#fff', fontSize: 18 }}>Zambia Procurement Portal</Text>
        </div>
        <Space>
          <Text style={{ color: '#fff' }}>{localStorage.getItem('email') || 'User'}</Text>
          <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout} style={{ color: '#fff' }}>
            Logout
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: '24px', background: '#f0f2f5' }}>
        {children}
      </Content>
    </Layout>
  );
}