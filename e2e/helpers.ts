import type { Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_A_FLAC = path.join(E2E_DIR, 'test-plan-a.flac');
/** 由完整夹具截取的短样，加速 L3 自动化（仍 gitignore） */
export const FIXTURE_A_FLAC_SHORT = path.join(E2E_DIR, 'test-plan-a-short.flac');
export const FIXTURE_B_STRM = path.join(E2E_DIR, 'test-plan-b.strm');

/**
 * 生成带轻微音调的 WAV（非全静音），便于 headed 模式下确认“在播”。
 * Howler format 列表首位是 mp3，但 html5 会用 Response Content-Type 解码，wav 即可。
 */
function toneWav(seconds = 3, freq = 440): Buffer {
  const sampleRate = 16000;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    // 低音量正弦，避免刺耳
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.2;
    const int16 = Math.max(-32767, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(int16, 44 + i * 2);
  }
  return buffer;
}

const LOCAL_SONGS = [
  {
    id: 1,
    title: 'Local Track A',
    artist_id: 1,
    album_id: 1,
    artist: 'Artist A',
    album: 'Album A',
    duration_secs: 3,
    file_path: '/music/a.wav',
    bitrate: 256,
    channels: 1,
    codec: 'wav',
    source_type: 'local',
  },
  {
    id: 2,
    title: 'Local Track B',
    artist_id: 1,
    album_id: 1,
    artist: 'Artist A',
    album: 'Album A',
    duration_secs: 3,
    file_path: '/music/b.wav',
    bitrate: 256,
    channels: 1,
    codec: 'wav',
    source_type: 'local',
  },
];

const STRM_SONGS = [
  {
    id: 101,
    title: 'Strm Track X',
    artist_id: 2,
    album_id: 2,
    artist: 'Remote',
    album: 'Cloud',
    duration_secs: 3,
    file_path: '/strm/x.wav',
    bitrate: 256,
    channels: 1,
    codec: 'wav',
    source_type: 'strm',
  },
  {
    id: 102,
    title: 'Strm Track Y',
    artist_id: 2,
    album_id: 2,
    artist: 'Remote',
    album: 'Cloud',
    duration_secs: 3,
    file_path: '/strm/y.wav',
    bitrate: 256,
    channels: 1,
    codec: 'wav',
    source_type: 'strm',
  },
];

function pageOf<T>(items: T[], offset = 0, limit = 50) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
    page: 1,
    total_pages: 1,
    has_next: false,
    has_prev: false,
  };
}

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

export type MockLibraryMode = 'local' | 'strm';

/**
 * 拦截 /api/*，使 E2E 不依赖真实后端。
 * 使用 context.route：允许 Service Worker 时，SW 内部 fetch 也能命中 mock。
 * serviceWorkers: 'block' 时流直达 Howler。
 */
export async function installApiMocks(page: Page, mode: MockLibraryMode = 'local') {
  const songs = mode === 'strm' ? STRM_SONGS : LOCAL_SONGS;
  const wav = toneWav(3);

  await page.context().route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === '/api/auth/status' && method === 'GET') {
      return json(route, { initialized: true, message: 'ok' });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      return json(route, {
        token: 'e2e-token',
        user: {
          id: 1,
          username: 'admin',
          role: 'admin',
          display_name: 'Admin',
          is_active: true,
        },
      });
    }
    if (path === '/api/health' && method === 'GET') {
      return json(route, { status: 'ok' });
    }
    if (path === '/api/stats' && method === 'GET') {
      return json(route, {
        library: { songs: songs.length, albums: 1, artists: 1 },
        playback: {},
        quality: {},
        recent: {},
        storage: {},
        system: {},
        top_content: {},
      });
    }
    if (path === '/api/history/stats' && method === 'GET') {
      return json(route, {});
    }
    if (path === '/api/songs' && method === 'GET') {
      return json(route, pageOf(songs));
    }
    if (path.match(/^\/api\/songs\/\d+$/) && method === 'GET') {
      const id = Number(path.split('/').pop());
      const song = songs.find((s) => s.id === id) ?? songs[0];
      return json(route, song);
    }
    if (path === '/api/songs/batch' && method === 'POST') {
      return json(route, songs);
    }
    if (path === '/api/albums' && method === 'GET') {
      return json(route, pageOf([]));
    }
    if (path === '/api/artists' && method === 'GET') {
      return json(route, pageOf([]));
    }
    if (path === '/api/recommend' && method === 'GET') {
      return json(route, []);
    }
    if (path === '/api/history/recent' && method === 'GET') {
      return json(route, []);
    }
    if (path === '/api/stream-token' && method === 'POST') {
      return json(route, { stream_token: 'e2e-st', expires_in: 300 });
    }
    if (path.match(/^\/api\/stream\/\d+$/) && method === 'GET') {
      const range = req.headers()['range'];
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : wav.length - 1;
        const slice = wav.subarray(start, end + 1);
        return route.fulfill({
          status: 206,
          contentType: 'audio/wav',
          body: slice,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(slice.length),
            'Content-Range': `bytes ${start}-${start + slice.length - 1}/${wav.length}`,
          },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: wav,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(wav.length),
        },
      });
    }
    if (path.startsWith('/api/covers/')) {
      return route.fulfill({ status: 404, body: '' });
    }
    return json(route, {});
  });
}

export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/用户名|Username/i).or(page.locator('input[autocomplete="username"]')).fill('admin');
  await page.locator('input[autocomplete="current-password"]').fill('Admin1234');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
}

/** 等到底部播放器进入真实播放态（非仅标题）。 */
export async function waitForPlaying(page: Page, expectedTitle?: string) {
  const title = page.getByTestId('player-current-title');
  await expect(title).toBeVisible({ timeout: 15_000 });
  if (expectedTitle) {
    await expect(title).toHaveText(expectedTitle, { timeout: 10_000 });
  }

  const toggle = page.getByTestId('player-toggle');
  // 弱网/大文件：若已加载但未起播，再点一次播放
  try {
    await expect(toggle).toHaveAttribute('data-playing', 'true', { timeout: 8_000 });
  } catch {
    if ((await toggle.getAttribute('data-playing')) !== 'true') {
      await toggle.click();
    }
  }
  await expect(toggle).toHaveAttribute('data-buffering', 'false', { timeout: 30_000 });
  await expect(toggle).toHaveAttribute('data-playing', 'true', { timeout: 30_000 });

  const seek = page.getByTestId('player-seek');
  // 进度应随播放前进（避免静音/假就绪）
  await expect
    .poll(async () => Number(await seek.inputValue()), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

export async function goSongsAndPlayAll(page: Page) {
  await page.goto('/songs');
  await page.waitForSelector('text=/Local Track|Strm Track/', { timeout: 15_000 });
  await page.locator('button').filter({ hasText: /播放全部|Play All/i }).click();
  await waitForPlaying(page);
}

export async function goSongsAndPlayFirst(page: Page, title?: string) {
  await page.goto('/songs');
  await page.waitForSelector('text=/Local Track|Strm Track|Fixture/', { timeout: 15_000 });
  if (title) {
    await page.getByText(title, { exact: true }).first().dblclick();
  } else {
    await page.locator('.group.grid').first().dblclick();
  }
  await waitForPlaying(page, title);
}

export { LOCAL_SONGS, STRM_SONGS };

// --------------- L3 真实夹具（gitignore: e2e/test-plan*）---------------

export function fixturesAvailable(): boolean {
  return fs.existsSync(FIXTURE_A_FLAC) || fs.existsSync(FIXTURE_A_FLAC_SHORT);
}

function resolveFixtureAudio(preferFull = false): { filePath: string; durationSecs: number } {
  if (preferFull && fs.existsSync(FIXTURE_A_FLAC)) {
    return { filePath: FIXTURE_A_FLAC, durationSecs: 318 };
  }
  if (fs.existsSync(FIXTURE_A_FLAC_SHORT)) {
    return { filePath: FIXTURE_A_FLAC_SHORT, durationSecs: 45 };
  }
  if (fs.existsSync(FIXTURE_A_FLAC)) {
    return { filePath: FIXTURE_A_FLAC, durationSecs: 318 };
  }
  throw new Error(`缺少夹具: ${FIXTURE_A_FLAC} 或 ${FIXTURE_A_FLAC_SHORT}`);
}

export type FixtureMockOptions = {
  mode: 'local' | 'strm';
  /** 近似限速：每个 Range/整包按字节估算延迟并封顶，模拟弱网 */
  throttleBytesPerSec?: number;
  maxThrottleDelayMs?: number;
  /** 路径 A seek 验证建议用完整夹具，确保 seek 点超出起播已缓存区 */
  preferFullFixture?: boolean;
};

export type StreamRangeLog = { start: number; end: number; at: number };

/**
 * 用本地 FLAC 夹具拦截 /api/stream，供路径 A/B 弱网 E2E。
 * Path B 的 .strm 仅作元数据标记（source_type=strm）；实际上游体仍走夹具 FLAC，
 * 避免依赖局域网 quark URL。
 */
export async function installFixtureApiMocks(
  page: Page,
  options: FixtureMockOptions,
): Promise<{ rangeLog: StreamRangeLog[]; fileSize: number; durationSecs: number }> {
  if (!fs.existsSync(FIXTURE_A_FLAC) && !fs.existsSync(FIXTURE_A_FLAC_SHORT)) {
    throw new Error(`缺少夹具: ${FIXTURE_A_FLAC}`);
  }
  const { filePath, durationSecs } = resolveFixtureAudio(!!options.preferFullFixture);
  const audio = fs.readFileSync(filePath);
  const fileSize = audio.byteLength;
  const rangeLog: StreamRangeLog[] = [];
  const throttleBps = options.throttleBytesPerSec ?? 2 * 1024 * 1024;
  const maxDelay = options.maxThrottleDelayMs ?? 800;

  const songs = options.mode === 'strm'
    ? [{
        id: 901,
        title: 'Fixture Strm FLAC',
        artist_id: 1,
        album_id: 1,
        artist: 'Fixture',
        album: 'E2E',
        duration_secs: durationSecs,
        file_path: fs.existsSync(FIXTURE_B_STRM)
          ? fs.readFileSync(FIXTURE_B_STRM, 'utf8').trim()
          : '/strm/fixture.flac',
        bitrate: 1411,
        channels: 2,
        codec: 'flac',
        source_type: 'strm',
      }]
    : [{
        id: 801,
        title: 'Fixture Local FLAC',
        artist_id: 1,
        album_id: 1,
        artist: 'Fixture',
        album: 'E2E',
        duration_secs: durationSecs,
        file_path: '/music/test-plan-a.flac',
        bitrate: 1411,
        channels: 2,
        codec: 'flac',
        source_type: 'local',
      }];

  const sleepThrottle = async (byteLen: number) => {
    if (!throttleBps || byteLen <= 0) return;
    const ms = Math.min(maxDelay, Math.ceil((byteLen / throttleBps) * 1000));
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  };

  await page.context().route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathName = url.pathname;
    const method = req.method();

    if (pathName === '/api/auth/status' && method === 'GET') {
      return json(route, { initialized: true, message: 'ok' });
    }
    if (pathName === '/api/auth/login' && method === 'POST') {
      return json(route, {
        token: 'e2e-token',
        user: {
          id: 1,
          username: 'admin',
          role: 'admin',
          display_name: 'Admin',
          is_active: true,
        },
      });
    }
    if (pathName === '/api/health' && method === 'GET') {
      return json(route, { status: 'ok' });
    }
    if (pathName === '/api/stats' && method === 'GET') {
      return json(route, {
        library: { songs: songs.length, albums: 1, artists: 1 },
        playback: {},
        quality: {},
        recent: {},
        storage: {},
        system: {},
        top_content: {},
      });
    }
    if (pathName === '/api/history/stats' && method === 'GET') {
      return json(route, {});
    }
    if (pathName === '/api/songs' && method === 'GET') {
      return json(route, pageOf(songs));
    }
    if (pathName.match(/^\/api\/songs\/\d+$/) && method === 'GET') {
      return json(route, songs[0]);
    }
    if (pathName === '/api/songs/batch' && method === 'POST') {
      return json(route, songs);
    }
    if (pathName === '/api/albums' && method === 'GET') {
      return json(route, pageOf([]));
    }
    if (pathName === '/api/artists' && method === 'GET') {
      return json(route, pageOf([]));
    }
    if (pathName === '/api/recommend' && method === 'GET') {
      return json(route, []);
    }
    if (pathName === '/api/history/recent' && method === 'GET') {
      return json(route, []);
    }
    if (pathName === '/api/stream-token' && method === 'POST') {
      return json(route, { stream_token: 'e2e-st', expires_in: 300 });
    }
    if (pathName.match(/^\/api\/stream\/\d+$/) && method === 'GET') {
      const range = req.headers()['range'];
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] !== undefined && m[2] !== ''
          ? Number(m[2])
          : fileSize - 1;
        const safeEnd = Math.min(end, fileSize - 1);
        const slice = audio.subarray(start, safeEnd + 1);
        rangeLog.push({ start, end: safeEnd, at: Date.now() });
        await sleepThrottle(slice.length);
        return route.fulfill({
          status: 206,
          contentType: 'audio/flac',
          body: slice,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(slice.length),
            'Content-Range': `bytes ${start}-${safeEnd}/${fileSize}`,
          },
        });
      }
      rangeLog.push({ start: 0, end: fileSize - 1, at: Date.now() });
      await sleepThrottle(Math.min(fileSize, 2 * 1024 * 1024));
      return route.fulfill({
        status: 200,
        contentType: 'audio/flac',
        body: audio,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
        },
      });
    }
    if (pathName.startsWith('/api/covers/')) {
      return route.fulfill({ status: 404, body: '' });
    }
    return json(route, {});
  });

  return { rangeLog, fileSize, durationSecs };
}

export async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg?.active || navigator.serviceWorker.controller);
  }, { timeout: 30_000 });
  // 确保当前页已被 SW 控制（否则 stream 不走稀疏/progressive）
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
      timeout: 30_000,
    });
  }
}

