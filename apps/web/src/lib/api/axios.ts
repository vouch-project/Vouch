import { BACKEND_API_URL } from '$lib/env';
import axios from 'axios';
import { JWT_STORAGE_KEY } from '../../constants';

export const axiosApi = axios.create({
  baseURL: `${BACKEND_API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(JWT_STORAGE_KEY);

  if (token) config.headers['Authorization'] = `Bearer ${token}`;

  return config;
});
