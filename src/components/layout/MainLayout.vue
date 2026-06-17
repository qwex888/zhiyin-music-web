<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import Sidebar from './Sidebar.vue';
import PlayerBar from './PlayerBar.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import GithubIcon from '@/components/common/GithubIcon.vue';
import { Menu } from 'lucide-vue-next';

const route = useRoute();
const { t } = useI18n();
const showMobileMenu = ref(false);

// 路由变化时关闭移动端菜单
watch(() => route.path, () => {
  showMobileMenu.value = false;
});
</script>

<template>
  <div class="flex flex-col h-screen overflow-hidden bg-bg-main text-text-primary font-sans selection:bg-primary selection:text-white">
    <OfflineBanner />

    <!-- 移动端 Header -->
    <header class="md:hidden h-14 bg-bg-surface/80 backdrop-blur-md border-b border-border flex items-center justify-between px-4 z-40 fixed top-0 w-full">
      <div class="font-bold text-lg text-transparent bg-clip-text bg-primary-gradient flex items-center">
        <span>ZHIYIN</span>
        <GithubIcon class="ml-2" />
      </div>
      <div class="flex items-center gap-3">
        <button class="p-2 text-text-secondary hover:text-text-primary transition-colors" @click="showMobileMenu = !showMobileMenu" :title="t('common.menu')">
          <Menu class="w-5 h-5" />
        </button>
      </div>
    </header>

    <!-- 移动端侧边栏蒙层 -->
    <transition name="fade">
      <div 
        v-if="showMobileMenu" 
        class="fixed inset-0 z-50 md:hidden bg-black/50 backdrop-blur-sm" 
        @click="showMobileMenu = false"
      ></div>
    </transition>
    
    <!-- 移动端侧边栏 -->
    <transition name="slide">
      <div v-if="showMobileMenu" class="fixed inset-y-0 left-0 z-50 md:hidden h-full shadow-2xl">
        <Sidebar class="h-full" />
      </div>
    </transition>

    <div class="flex flex-1 overflow-hidden pt-14 md:pt-0 pb-20">
      <!-- 桌面端 Sidebar -->
      <Sidebar class="hidden md:flex flex-shrink-0" />
      
      <!-- 主内容区 -->
      <main class="flex-1 overflow-y-auto bg-bg-main scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-800 scrollbar-track-transparent p-4 md:p-0 relative">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
    
    <!-- 底部播放器 -->
    <PlayerBar class="flex-shrink-0 border-t border-border z-50" />

  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(5px);
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}
</style>
