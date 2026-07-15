import React, { useState, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import SplashScreen from './components/SplashScreen';
import UnifiedLogin from './components/UnifiedLogin';
import SystemHealthPortal from './components/SystemHealthPortal';
import AdminPortal from './components/AdminPortal';
import CustomerDashboard from './components/CustomerDashboard';
import SupplierDashboard from './components/SupplierDashboard';
import SupplierRegistration from './components/SupplierRegistration';
import BidDetail from './components/BidDetail';
import PublicNoticeboard from './components/PublicNoticeboard';
import AppLayout from './components/AppLayout';
import { cdnImages } from './cdnAssets';

function LoadingExperience() {
  const [showImage, setShowImage] = useState(false);
  
  useEffect(() => {
    // Small delay to ensure the background image is visible
    const timer = setTimeout(() => setShowImage(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="route-loading">
      <div 
        className="route-loading-bg" 
        style={{ 
          backgroundImage: `url(${cdnImages.loginHero})`,
          opacity: showImage ? 1 : 0,
          transition: 'opacity 0.5s ease-in'
        }} 
      />
      <div className="route-loading-overlay" />
      <div className="route-loading-content">
        <div className="route-loading-mark" />
        <h1>Freshstart Procurement</h1>
        <p>Preparing your workspace</p>
        <div className="route-loading-dots"><span /><span /><span /></div>
      </div>
    </div>
  );
}

function PrivateRoute({ children, requiredRoute }) {
  const { user, dashboardRoute, loading } = useAuth();
  if (loading) return <LoadingExperience />;
  if (!user) return <Navigate to="/login" replace />;

  // Check if the required route is compatible with the user's dashboard route
  // Use prefix matching so /admin/* routes work when dashboardRoute is /admin
  if (requiredRoute && dashboardRoute && !dashboardRoute.startsWith(requiredRoute.replace('/*', ''))) {
    return <Navigate to={dashboardRoute} replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function AppContent() {
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashFinish = useCallback(() => setSplashDone(true), []);

  if (!splashDone) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  return (
    <Routes>
          <Route path="/login" element={<UnifiedLogin />} />
          <Route path="/register/supplier" element={<SupplierRegistration />} />
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
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}