import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

axios.defaults.withCredentials = true;
axios.defaults.baseURL = process.env.REACT_APP_API_BASE_URL || '';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [dashboardRoute, setDashboardRoute] = useState('/login');
  const [loading, setLoading] = useState(true);
  const [activeTenantId, setActiveTenantId] = useState(null);
  const [tenants, setTenants] = useState([]);
  const refreshingRef = useRef(false);

  const applyMe = useCallback((data) => {
    setDashboardRoute(data.dashboardRoute);
    setUser({
      role: data.role,
      user_type: data.user_type,
      tenantId: data.tenantId,
      email: data.email,
      full_name: data.full_name,
    });
    // Initialize active tenant from user's default tenant
    if (data.tenantId) {
      setActiveTenantId(data.tenantId);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch {
      // ignore network errors on logout
    }
    setUser(null);
    setDashboardRoute('/login');
    setActiveTenantId(null);
    setTenants([]);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) throw new Error('refresh already in progress');
    refreshingRef.current = true;
    try {
      await axios.post('/api/auth/refresh');
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  // Initial session bootstrap (cookie may already be present).
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const meRes = await axios.get('/api/me');
        if (!cancelled) applyMe(meRes.data);
      } catch (e) {
        if (e.response && e.response.status === 401) {
          try {
            await refresh();
            const meRes = await axios.get('/api/me');
            if (!cancelled) applyMe(meRes.data);
          } catch {
            if (!cancelled) setDashboardRoute('/login');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    bootstrap();
    return () => { cancelled = true; };
  }, [applyMe, refresh]);

  // Fetch available tenants for business_admin users
  useEffect(() => {
    if (user?.role === 'business_admin' || user?.role === 'system_admin') {
      axios.get('/api/tenant/list')
        .then(res => setTenants(res.data))
        .catch(() => {});
    }
  }, [user]);

  // Axios request interceptor: inject X-Tenant-ID header on POST/PUT requests
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use(
      (config) => {
        // Only inject tenant header for POST and PUT requests to /api/
        if (config.method && ['post', 'put'].includes(config.method.toLowerCase()) && config.url && config.url.startsWith('/api/')) {
          const tenantId = activeTenantId;
          if (tenantId) {
            config.headers['X-Tenant-ID'] = String(tenantId);
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );
    return () => axios.interceptors.request.eject(requestInterceptor);
  }, [activeTenantId]);

  // Axios interceptor: on 401, attempt a single token refresh then retry.
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const original = error.config;
        if (
          error.response &&
          error.response.status === 401 &&
          !original._retry &&
          original.url &&
          !original.url.includes('/api/auth/refresh')
        ) {
          original._retry = true;
          try {
            await refresh();
            return axios(original);
          } catch {
            logout();
          }
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [refresh, logout]);

  const login = async (email, password) => {
    await axios.post('/api/auth/login', { email, password });
    const meRes = await axios.get('/api/me');
    applyMe(meRes.data);
    return meRes.data.dashboardRoute;
  };

  const handleSetActiveTenant = useCallback((tenantId) => {
    setActiveTenantId(tenantId);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, login, logout, dashboardRoute, loading,
      activeTenantId, setActiveTenantId: handleSetActiveTenant,
      tenants,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);