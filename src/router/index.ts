import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { isOfflineMode } from '@/offline/network';
import i18n from '@/i18n';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'Home',
      component: () => import('@/views/Home.vue'),
    },
    {
      path: '/songs',
      name: 'Songs',
      component: () => import('@/views/Songs.vue'),
    },
    {
      path: '/albums',
      name: 'Albums',
      component: () => import('@/views/Albums.vue'),
    },
    {
      path: '/albums/:id',
      name: 'AlbumDetail',
      component: () => import('@/views/AlbumDetail.vue'),
    },
    {
      path: '/artists',
      name: 'Artists',
      component: () => import('@/views/Artists.vue'),
    },
    {
      path: '/artists/:id',
      name: 'ArtistDetail',
      component: () => import('@/views/ArtistDetail.vue'),
    },
    {
      path: '/history',
      name: 'History',
      component: () => import('@/views/History.vue'),
      meta: { onlineOnly: true },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/Settings.vue'),
      meta: { onlineOnly: true },
    },
    {
      path: '/changelog',
      name: 'Changelog',
      component: () => import('@/views/Changelog.vue'),
      meta: { onlineOnly: true },
    },
    {
      path: '/users',
      name: 'UserManagement',
      component: () => import('@/views/UserManagement.vue'),
      meta: { onlineOnly: true, adminOnly: true },
    },
    {
      path: '/offline',
      name: 'Offline',
      component: () => import('@/views/Offline.vue'),
    },
    {
      path: '/stats',
      name: 'Stats',
      component: () => import('@/views/Stats.vue'),
      meta: { onlineOnly: true, adminOnly: true },
    },
    {
      path: '/scrape',
      name: 'Scrape',
      component: () => import('@/views/Scrape.vue'),
      meta: { onlineOnly: true, adminOnly: true },
    },
    {
      path: '/settings/scrape-sources',
      name: 'ScrapeSources',
      component: () => import('@/views/ScrapeSources.vue'),
      meta: { onlineOnly: true, adminOnly: true },
    },
    {
      path: '/organize',
      name: 'Organize',
      component: () => import('@/views/Organize.vue'),
      meta: { onlineOnly: true, adminOnly: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      redirect: '/',
    },
  ],
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  if (to.meta.public) {
    if (authStore.isAuthenticated && to.name === 'Login') {
      return { name: 'Home' };
    }
    return true;
  }

  if (authStore.initialized === null) {
    const isInit = await authStore.checkInitStatus();
    if (!isInit) {
      authStore.logout();
      return { name: 'Login' };
    }
  } else if (!authStore.initialized) {
    authStore.logout();
    return { name: 'Login' };
  }

  if (!authStore.isAuthenticated) {
    return { name: 'Login' };
  }

  if (to.meta.adminOnly && !authStore.isAdmin) {
    return { name: 'Home' };
  }

  if (to.meta.onlineOnly && isOfflineMode()) {
    return {
      name: 'Songs',
      query: { offline: '1' },
      state: { offlineRedirect: i18n.global.t('offline.route_blocked') },
    };
  }

  return true;
});

export default router;
