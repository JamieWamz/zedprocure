import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import UnifiedLogin from './components/UnifiedLogin';
import SystemHealthPortal from './components/SystemHealthPortal';
import BusinessAdminDashboard from './components/BusinessAdminDashboard';
import FinancialLedger from './components/FinancialLedger';
import TenantAdminDashboard from './components/TenantAdminDashboard';
import CustomerDashboard from './components/CustomerDashboard';
import SupplierDashboard from './components/SupplierDashboard';
import SupplierVerification from './components/SupplierVerification';
import CreateBidWizard from './components/CreateBidWizard';
import BidDetail from './components/BidDetail';
import AppLayout from './components/AppLayout';
import PublicNoticeboard from './components/PublicNoticeboard';
import OrdersList from './components/OrdersList';

function PrivateRoute({ children, requiredRoute, showBack = false }) {
  const { token, dashboardRoute, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh' }}>Loading...</div>;
  if (!token) return <Navigate to="/login" replace />;
  if (requiredRoute && dashboardRoute !== requiredRoute) return <Navigate to={dashboardRoute} replace />;
  return <AppLayout showBack={showBack}>{children}</AppLayout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<UnifiedLogin />} />
          <Route path="/public" element={<PublicNoticeboard />} />
          <Route path="/system-health" element={<PrivateRoute requiredRoute="/system-health"><SystemHealthPortal /></PrivateRoute>} />
          <Route path="/admin-dashboard" element={<PrivateRoute requiredRoute="/admin-dashboard"><BusinessAdminDashboard /></PrivateRoute>} />
          <Route path="/admin-dashboard/ledger" element={<PrivateRoute requiredRoute="/admin-dashboard" showBack><FinancialLedger /></PrivateRoute>} />
          <Route path="/admin-dashboard/verification" element={<PrivateRoute requiredRoute="/admin-dashboard" showBack><SupplierVerification /></PrivateRoute>} />
          <Route path="/tenant-admin" element={<PrivateRoute requiredRoute="/tenant-admin"><TenantAdminDashboard /></PrivateRoute>} />
          <Route path="/tenant-admin/bids/new" element={<PrivateRoute requiredRoute="/tenant-admin" showBack><CreateBidWizard /></PrivateRoute>} />
          <Route path="/tenant-admin/bids/:bidId" element={<PrivateRoute requiredRoute="/tenant-admin" showBack><BidDetail /></PrivateRoute>} />
          <Route path="/tenant-admin/orders" element={<PrivateRoute requiredRoute="/tenant-admin" showBack><OrdersList /></PrivateRoute>} />
          <Route path="/customer" element={<PrivateRoute requiredRoute="/customer"><CustomerDashboard /></PrivateRoute>} />
          <Route path="/supplier" element={<PrivateRoute requiredRoute="/supplier"><SupplierDashboard /></PrivateRoute>} />
          <Route path="/supplier/bids/:bidId" element={<PrivateRoute requiredRoute="/supplier" showBack><BidDetail /></PrivateRoute>} />
          <Route path="*" element={<PrivateRoute><Navigate to="/login" /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
