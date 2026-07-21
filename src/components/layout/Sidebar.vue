<script setup lang="ts">
import GithubIcon from '@/components/common/GithubIcon.vue';
import { Home, Library, Disc, Mic2, History, Settings, ChevronLeft, BarChart2, LogOut, Search, FolderTree, HardDrive, Sun, Moon, Shield, Database } from 'lucide-vue-next';
import { useTheme } from '@/composables/useTheme';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { computed, ref, type Component } from 'vue';

type MenuItem = { name: string; path: string; icon: Component; experimental?: boolean };
import { useAuthStore } from '@/stores/auth';
import { usePlayerStore } from '@/stores/player';
import { useAppConnectivity } from '@/offline/network';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
const isCollapsed = ref(false);
const { isOffline } = useAppConnectivity();
const { theme, toggleTheme } = useTheme();

const onlineOnlyPaths = new Set(['/history', '/stats', '/scrape', '/organize', '/settings', '/settings/scrape-sources']);

const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value;
};

const handleLogout = () => {
  usePlayerStore().clearQueue();
  authStore.logout();
  router.replace({ name: 'Login' });
};

// 菜单项配置
const menuItems = computed((): MenuItem[] => {
  const items: MenuItem[] = [
    { name: t('nav.home'), path: '/', icon: Home },
    { name: t('nav.songs'), path: '/songs', icon: Library },
    { name: t('nav.albums'), path: '/albums', icon: Disc },
    { name: t('nav.artists'), path: '/artists', icon: Mic2 },
    { name: t('nav.history'), path: '/history', icon: History },
  ];
  if (authStore.isAdmin) {
    items.push(
      { name: t('nav.stats'), path: '/stats', icon: BarChart2 },
      { name: t('nav.scrape'), path: '/scrape', icon: Search, experimental: true },
      { name: t('nav.scrape_sources'), path: '/settings/scrape-sources', icon: Database, experimental: true },
      { name: t('nav.organize'), path: '/organize', icon: FolderTree, experimental: true },
      { name: t('nav.users'), path: '/users', icon: Shield },
    );
  }
  return items;
});
</script>

<template>
  <aside
    class="bg-bg-surface border-r border-border flex flex-col h-full z-40 transition-all duration-300 ease-in-out relative group/sidebar"
    :class="isCollapsed ? 'w-20' : 'w-60'">
    <!-- Toggle Button -->
    <button @click="toggleSidebar"
      class="absolute -right-3 top-9 w-6 h-6 bg-bg-elevate border border-border rounded-full hidden md:flex items-center justify-center text-text-secondary hover:text-primary hover:border-primary/30 shadow-lg transition-all duration-300 z-50 opacity-0 group-hover/sidebar:opacity-100 focus:opacity-100"
      :class="{ 'opacity-100': isCollapsed }" :title="t('common.toggle_sidebar')">
      <ChevronLeft class="w-3.5 h-3.5 transition-transform duration-300" :class="{ 'rotate-180': isCollapsed }" />
    </button>

    <!-- Logo 区域 -->
    <div class="h-20 flex items-center" :class="isCollapsed ? 'justify-center px-0' : 'px-6'">
      <div class="flex items-center gap-2 overflow-hidden whitespace-nowrap flex-1" :class="isCollapsed ? 'justify-center' : ''">
        <Disc class="w-8 h-8 text-primary flex-shrink-0" />
        <h1 class="text-xl font-bold text-transparent bg-clip-text bg-primary-gradient transition-opacity duration-300"
          :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100'">
          ZHIYIN
        </h1>
      </div>
      <GithubIcon class="hidden md:block" v-if="!isCollapsed" />
    </div>
    <!-- 滚动视图 -->
    <div class="flex-1 overflow-y-auto">
      <!-- 导航菜单 -->
      <nav class="flex-1 px-3">
        <ul class="space-y-1">
          <li v-for="item in menuItems" :key="item.path">
            <component :is="isOffline && onlineOnlyPaths.has(item.path) ? 'span' : 'router-link'"
              :to="isOffline && onlineOnlyPaths.has(item.path) ? undefined : item.path"
              class="flex items-center gap-3 py-3 rounded-md text-sm font-medium transition-colors overflow-hidden whitespace-nowrap"
              :class="[
                isOffline && onlineOnlyPaths.has(item.path)
                  ? 'text-text-tertiary cursor-not-allowed opacity-40'
                  : route.path === item.path
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-secondary hover:bg-bg-elevate hover:text-text-primary',
                isCollapsed ? 'justify-center px-2' : 'px-4'
              ]" :title="isCollapsed ? item.name : ''">
              <component :is="item.icon" class="w-5 h-5 flex-shrink-0" />
              <span :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100 transition-opacity duration-300'">
                {{ item.name }} {{ item.experimental ? `（${t('settings.experimental')}）` : '' }}
              </span>
            </component>
          </li>
        </ul>
      </nav>

      <!-- 底部设置 & 退出 -->
      <div class="pb-24 p-4 border-t border-border space-y-1">
        <router-link to="/offline"
          class="flex items-center gap-3 py-3 w-full rounded-md text-sm font-medium transition-colors overflow-hidden whitespace-nowrap"
          :class="[
            route.path === '/offline'
              ? 'bg-primary/10 text-primary'
              : 'text-text-secondary hover:bg-bg-elevate hover:text-text-primary',
            isCollapsed ? 'justify-center px-2' : 'px-4'
          ]" :title="isCollapsed ? t('nav.offline') : ''">
          <HardDrive class="w-5 h-5 flex-shrink-0" />
          <span :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100 transition-opacity duration-300'">
            {{ t('nav.offline') }}
          </span>
        </router-link>
        <component :is="isOffline ? 'span' : 'router-link'" :to="isOffline ? undefined : '/settings'"
          class="flex items-center gap-3 py-3 w-full rounded-md text-sm font-medium transition-colors overflow-hidden whitespace-nowrap"
          :class="[
            isOffline
              ? 'text-text-tertiary cursor-not-allowed opacity-40'
              : route.path === '/settings'
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:bg-bg-elevate hover:text-text-primary',
            isCollapsed ? 'justify-center px-2' : 'px-4'
          ]" :title="isCollapsed ? t('nav.settings') : ''">
          <Settings class="w-5 h-5 flex-shrink-0" />
          <span :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100 transition-opacity duration-300'">
            {{ t('nav.settings') }}
          </span>
        </component>
        <button @click="toggleTheme"
          class="hidden md:flex items-center gap-3 py-3 w-full rounded-md text-sm font-medium transition-colors overflow-hidden whitespace-nowrap text-text-secondary hover:bg-bg-elevate hover:text-text-primary"
          :class="isCollapsed ? 'justify-center px-2' : 'px-4'" :title="isCollapsed ? t('settings.theme') : ''">
          <Sun v-if="theme === 'dark'" class="w-5 h-5 flex-shrink-0" />
          <Moon v-else class="w-5 h-5 flex-shrink-0" />
          <span :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100 transition-opacity duration-300'">
            {{ theme === 'dark' ? t('settings.light') : t('settings.dark') }}{{ t('settings.theme') }}
          </span>
        </button>
        <button @click="handleLogout"
          class="flex items-center gap-3 py-3 w-full rounded-md text-sm font-medium transition-colors overflow-hidden whitespace-nowrap text-text-secondary hover:bg-red-500/10 hover:text-red-400"
          :class="isCollapsed ? 'justify-center px-2' : 'px-4'" :title="t('auth.logout')">
          <LogOut class="w-5 h-5 flex-shrink-0" />
          <span :class="isCollapsed ? 'opacity-0 w-0' : 'opacity-100 transition-opacity duration-300'">
            {{ t('auth.logout') }}
          </span>
        </button>
      </div>
    </div>
  </aside>
</template>
