import React, { useState, useEffect } from 'react';
import { Layout, Menu } from 'antd';
import {
  FileTextOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  ShopOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import TenantBidsList from './TenantBidsList';
import CreateBidWizard from './CreateBidWizard';
import BidDetail from './BidDetail';
import SupplierVerification from './SupplierVerification';
import FinancialLedger from './FinancialLedger';
import OrdersList from './OrdersList';

const { Sider, Content } = Layout;

export default function AdminPortal() {
  const { user } = useAuth();
  const role = user?.role;
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [];
  if (role === 'business_admin') {
    menuItems.push(
      { key: '/admin/bids', icon: <FileTextOutlined />, label: 'Bids' },
      { key: '/admin/bids/new', icon: <PlusOutlined />, label: 'Create Bid' },
      { key: '/admin/orders', icon: <CheckCircleOutlined />, label: 'Orders' },
      { key: '/admin/verification', icon: <ShopOutlined />, label: 'Supplier Verification' },
      { key: '/admin/ledger', icon: <DollarOutlined />, label: 'Financial Ledger' },
    );
  } else if (role === 'tenant_admin') {
    menuItems.push(
      { key: '/admin/bids', icon: <FileTextOutlined />, label: 'Bids' },
      { key: '/admin/bids/new', icon: <PlusOutlined />, label: 'Create Bid' },
      { key: '/admin/orders', icon: <CheckCircleOutlined />, label: 'Orders' },
    );
  }

  useEffect(() => {
    if (location.pathname === '/admin' && menuItems.length > 0) {
      navigate(menuItems[0].key, { replace: true });
    }
  }, [location.pathname, menuItems, navigate]);

  const renderContent = () => {
    const path = location.pathname;
    if (path === '/admin/bids') return <TenantBidsList />;
    if (path === '/admin/bids/new') return <CreateBidWizard />;
    if (path.startsWith('/admin/bids/') && path.split('/').length === 4) return <BidDetail />;
    if (path === '/admin/orders') return <OrdersList />;
    if (path === '/admin/verification') return <SupplierVerification />;
    if (path === '/admin/ledger') return <FinancialLedger />;
    return null;
  };

  if (!user) {
    return <div style={{ padding: 24, textAlign: 'center' }}>Loading admin...</div>;
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="light" width={220}>
        <div style={{ height: 32, margin: 16, background: 'rgba(0,0,0,0.05)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
          Admin Panel
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Content style={{ padding: '24px', background: '#fff', minHeight: 280 }}>
        {renderContent()}
      </Content>
    </Layout>
  );
}