import { ref, onMounted, onUnmounted } from 'vue';

/**
 * 图片懒加载 Hook
 * 使用 Intersection Observer 控制图片加载时机
 */
export function useLazyImage(options: {
  rootMargin?: string;
  threshold?: number;
} = {}) {
  const { rootMargin = '100px', threshold = 0.01 } = options;
  
  const observer = ref<IntersectionObserver | null>(null);
  const loadedImages = new Set<string>();
  
  // 创建 Intersection Observer
  const createObserver = () => {
    if ('IntersectionObserver' in window) {
      observer.value = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const img = entry.target as HTMLImageElement;
              const src = img.dataset.src;
              
              if (src && !loadedImages.has(src)) {
                // 加载图片
                img.src = src;
                loadedImages.add(src);
                
                // 加载完成后移除 data-src
                img.onload = () => {
                  img.removeAttribute('data-src');
                  img.classList.add('loaded');
                };
                
                // 停止观察已加载的图片
                observer.value?.unobserve(img);
              }
            }
          });
        },
        {
          rootMargin,
          threshold,
        }
      );
    }
  };
  
  // 观察单个元素
  const observe = (element: HTMLElement) => {
    if (observer.value) {
      observer.value.observe(element);
    }
  };
  
  // 取消观察单个元素
  const unobserve = (element: HTMLElement) => {
    if (observer.value) {
      observer.value.unobserve(element);
    }
  };
  
  // 清理
  const cleanup = () => {
    if (observer.value) {
      observer.value.disconnect();
      observer.value = null;
    }
    loadedImages.clear();
  };
  
  onMounted(() => {
    createObserver();
  });
  
  onUnmounted(() => {
    cleanup();
  });
  
  return {
    observe,
    unobserve,
    cleanup,
  };
}

const PLACEHOLDER_SRC = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';

function loadImage(img: HTMLImageElement) {
  const src = img.dataset.src;
  if (!src) return;

  img.classList.remove('loaded', 'load-error');
  img.src = src;

  img.onload = () => {
    img.classList.add('loaded');
    img.onload = null;
    img.onerror = null;
  };
  img.onerror = () => {
    img.classList.add('load-error');
    img.onload = null;
    img.onerror = null;
  };
}

function setupObserver(el: HTMLImageElement) {
  const prev = (el as any)._lazyObserver as IntersectionObserver | undefined;
  if (prev) prev.disconnect();

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadImage(entry.target as HTMLImageElement);
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '150px', threshold: 0.01 },
  );

  observer.observe(el);
  (el as any)._lazyObserver = observer;
}

/**
 * 简化版：用于 Vue 指令
 */
export const lazyImageDirective = {
  mounted(el: HTMLImageElement, binding: { value: string }) {
    el.src = PLACEHOLDER_SRC;
    el.dataset.src = binding.value;
    setupObserver(el);
  },

  updated(el: HTMLImageElement, binding: { value: string; oldValue?: string | null }) {
    if (binding.value === binding.oldValue) return;
    el.dataset.src = binding.value;
    el.src = PLACEHOLDER_SRC;
    el.classList.remove('loaded', 'load-error');
    setupObserver(el);
  },

  unmounted(el: HTMLImageElement) {
    const observer = (el as any)._lazyObserver as IntersectionObserver | undefined;
    if (observer) {
      observer.disconnect();
      delete (el as any)._lazyObserver;
    }
    el.onload = null;
    el.onerror = null;
  },
};
