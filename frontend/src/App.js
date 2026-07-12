import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import UnifiedLogin from './components/UnifiedLogin';
import SystemHealthPortal from './components/SystemHealthPortal';
import AdminPortal from './components/AdminPortal';
import CustomerDashboard from './components/CustomerDashboard';
import SupplierDashboard from './components/SupplierDashboard';
import BidDetail from './components/BidDetail';
import PublicNoticeboard from './components/PublicNoticeboard';
import AppLayout from './components/AppLayout';

function PrivateRoute({ children, requiredRoute }) {
  const { user, dashboardRoute, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  // Check if the required route is compatible with the user's dashboard route
  // Use prefix matching so /admin/* routes work when dashboardRoute is /admin
  if (requiredRoute && dashboardRoute && !dashboardRoute.startsWith(requiredRoute.replace('/*', ''))) {
    return <Navigate to={dashboardRoute} replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<UnifiedLogin />} />
          <Route path="/system-health" element={
            <PrivateRoute requiredRoute="/system-health"><SystemHealthPortal /></PrivateRoute>
          } />
          <Route path="/admin/*" element={
            <PrivateRoute requiredRoute="/admin"><AdminPortal /></PrivateRoute>
          } />
          <Route path="/customer/*" element={
            <PrivateRoute requiredRoute="/customer"><CustomerDashboard /></PrivateRoute>
          } />
          <Route path="/supplier/*" element={
            <PrivateRoute requiredRoute="/supplier"><SupplierDashboard /></PrivateRoute>
          } />
          <Route path="/supplier/bids/:bidId" element={
            <PrivateRoute requiredRoute="/supplier"><BidDetail /></PrivateRoute>
          } />
          <Route path="/public/bids" element={<PublicNoticeboard />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}