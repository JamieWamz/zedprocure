import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [dashboardRoute, setDashboardRoute] = useState('/login');
  const [loading, setLoading] = useState(true);
  const logoutRef = useRef();

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setDashboardRoute('/login');
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  logoutRef.current = logout;

  // Axios interceptor for automatic 401 handling
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response && error.response.status === 401) {
          if (logoutRef.current) {
            logoutRef.current();
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get('/api/me')
        .then(res => {
          setDashboardRoute(res.data.dashboardRoute);
          setUser({ role: res.data.role, tenantId: res.data.tenantId });
        })
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token, logout]);

  const login = async (email, password) => {
    const res = await axios.post('/api/auth/login', { email, password });
    const { access_token } = res.data;
    localStorage.setItem('token', access_token);
    setToken(access_token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    const meRes = await axios.get('/api/me');
    setDashboardRoute(meRes.data.dashboardRoute);
    setUser({ role: meRes.data.role, tenantId: meRes.data.tenantId });
    return meRes.data.dashboardRoute;
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, dashboardRoute, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);