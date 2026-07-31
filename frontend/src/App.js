import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import SplashScreen from './components/SplashScreen';
import UnifiedLogin from './components/UnifiedLogin';
import SystemHealthPortal from './components/SystemHealthPortal';
import AdminPortal from './components/AdminPortal';
import CustomerDashboard from './components/CustomerDashboard';
import SupplierDashboard from './components/SupplierDashboard';
import SupplierRegistration from './components/SupplierRegistration';
import AcceptInvite from './components/AcceptInvite';
import BidDetail from './components/BidDetail';
import PublicNoticeboard from './components/PublicNoticeboard';
import AppLayout from './components/AppLayout';

function PrivateRoute({ children, requiredRoute }) {
  const { user, dashboardRoute, loading } = useAuth();
  if (loading) return <SplashScreen isRouteLoading={true} />;
  if (!user) return <Navigate to="/login" replace />;

  // Check if the required route is compatible with the user's dashboard route
  // Use prefix matching so /admin/* routes work when dashboardRoute is /admin
  if (requiredRoute && dashboardRoute && !dashboardRoute.startsWith(requiredRoute.replace('/*', ''))) {
    return <Navigate to={dashboardRoute} replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function AppContent() {
  return (
    <Routes>
          <Route path="/login" element={<UnifiedLogin />} />
          <Route path="/register/supplier" element={<SupplierRegistration />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/system-health" element={
            <PrivateRoute requiredRoute="/system-health"><SystemHealthPortal /></PrivateRoute>
          } />
          <Route path="/admin/*" element={
            <PrivateRoute requiredRoute="/admin"><AdminPortal /></PrivateRoute>
          } />
          <Route path="/customer/bids/:bidId" element={
            <PrivateRoute requiredRoute="/customer"><BidDetail /></PrivateRoute>
          } />
          <Route path="/customer/*" element={
            <PrivateRoute requiredRoute="/customer"><CustomerDashboard /></PrivateRoute>
          } />
          <Route path="/supplier/bids/:bidId" element={
            <PrivateRoute requiredRoute="/supplier"><BidDetail /></PrivateRoute>
          } />
          <Route path="/supplier/*" element={
            <PrivateRoute requiredRoute="/supplier"><SupplierDashboard /></PrivateRoute>
          } />
          <Route path="/public/bids" element={<PublicNoticeboard />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
