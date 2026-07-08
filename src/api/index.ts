import axios from 'axios';
import { useAuthStore } from '@/stores/auth';
import router from '@/router';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const authStore = useAuthStore();
  if (authStore.token) {
    config.headers.Authorization = `Bearer ${authStore.token}`;
  }
  return config;
});

let isLoggingOut = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isLoggingOut) {
      isLoggingOut = true;
      // 超时保护：无论导航结果如何，最多 3 秒后重置标志
      const timeout = setTimeout(() => { isLoggingOut = false; }, 3000);
      const authStore = useAuthStore();
      authStore.logout();
      const currentRoute = router.currentRoute.value;
      if (currentRoute.name !== 'Login') {
        router.replace({ name: 'Login' }).catch(() => {}).finally(() => {
          clearTimeout(timeout);
          isLoggingOut = false;
        });
      } else {
        clearTimeout(timeout);
        isLoggingOut = false;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
