import axios from 'axios';

export const getFileUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  
  const baseUrl = axios.defaults.baseURL || '';
  return `${baseUrl}/api/documents/download?path=${encodeURIComponent(path)}`;
};
