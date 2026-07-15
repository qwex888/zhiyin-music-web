import { vi } from 'vitest';

/** 收集 SW message 监听器，供测试触发 audio-cached */
const messageHandlers: Array<(event: MessageEvent) => void> = [];

Object.defineProperty(globalThis.navigator, 'serviceWorker', {
  configurable: true,
  writable: true,
  value: {
    addEventListener(type: string, handler: EventListener) {
      if (type === 'message') messageHandlers.push(handler as (e: MessageEvent) => void);
    },
    removeEventListener(type: string, handler: EventListener) {
      if (type !== 'message') return;
      const idx = messageHandlers.indexOf(handler as (e: MessageEvent) => void);
      if (idx >= 0) messageHandlers.splice(idx, 1);
    },
    controller: {
      postMessage: vi.fn(),
    },
  },
});

export function emitSwMessage(data: unknown) {
  const event = { data } as MessageEvent;
  for (const h of [...messageHandlers]) h(event);
}

(globalThis as unknown as { __emitSwMessage: typeof emitSwMessage }).__emitSwMessage = emitSwMessage;

// URL.createObjectURL / revoke 在 jsdom 可能缺失
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url') as typeof URL.createObjectURL;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
}
