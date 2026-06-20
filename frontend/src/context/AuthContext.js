import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [dashboardRoute, setDashboardRoute] = useState('/login');
  const [loading, setLoading] = useState(true);

  const decodeToken = (tok) => {
    try {
      const payload = JSON.parse(atob(tok.split('.')[1]));
      return payload;
    } catch { return null; }
  };

  useEffect(() => {
    if (token) {
      const payload = decodeToken(token);
      setUser(payload);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get('/api/me')
        .then(res => setDashboardRoute(res.data.dashboardRoute))
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email, password) => {
    const res = await axios.post('/api/auth/login', { email, password });
    const { access_token } = res.data;
    localStorage.setItem('token', access_token);
    localStorage.setItem('email', email);
    setToken(access_token);
    setUser(decodeToken(access_token));
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    const meRes = await axios.get('/api/me');
    setDashboardRoute(meRes.data.dashboardRoute);
    return meRes.data.dashboardRoute;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('email');
    setToken(null);
    setUser(null);
    setDashboardRoute('/login');
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, dashboardRoute, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);