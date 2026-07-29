import { ref, watch, onUnmounted } from 'vue';
import { ensureCachedCoverObjectUrl } from '@/offline/media-cache';

/**
 * 封面显示：未命中缓存时只走一次 fetch→Cache→blob:，
 * 不再先把 /api/covers/{id} 赋给 <img>（避免与后台 fetch 双下载）。
 */
export function useCoverUrl(coverId: () => number | null | undefined) {
  const displayUrl = ref('');
  let activeObjectUrl: string | null = null;
  let currentId: number | null | undefined = null;

  const revokeActive = () => {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  };

  const resolve = async (id: number | null | undefined) => {
    currentId = id;
    if (!id) {
      revokeActive();
      displayUrl.value = '';
      return;
    }

    // 先清空网络 URL，等 blob 就绪再显示（A）
    displayUrl.value = '';

    const blobUrl = await ensureCachedCoverObjectUrl(id);
    if (currentId !== id) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }

    if (blobUrl) {
      revokeActive();
      activeObjectUrl = blobUrl;
      displayUrl.value = blobUrl;
      return;
    }

    // Cache/fetch 均失败时才回退网络（极少）
    displayUrl.value = `/api/covers/${id}`;
  };

  watch(coverId, (id) => void resolve(id), { immediate: true });

  onUnmounted(() => revokeActive());

  return { displayUrl, refresh: () => resolve(coverId()) };
}
