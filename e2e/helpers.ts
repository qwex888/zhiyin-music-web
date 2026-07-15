import type { Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';

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
 * serviceWorkers: 'block' 时流直达 Howler。
 */
export async function installApiMocks(page: Page, mode: MockLibraryMode = 'local') {
  const songs = mode === 'strm' ? STRM_SONGS : LOCAL_SONGS;
  const wav = toneWav(3);

  await page.route('**/api/**', async (route) => {
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
  await expect(toggle).toHaveAttribute('data-buffering', 'false', { timeout: 15_000 });
  await expect(toggle).toHaveAttribute('data-playing', 'true', { timeout: 15_000 });

  const seek = page.getByTestId('player-seek');
  // 进度应随播放前进（避免静音/假就绪）
  await expect
    .poll(async () => Number(await seek.inputValue()), { timeout: 8_000 })
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
  await page.waitForSelector('text=/Local Track|Strm Track/', { timeout: 15_000 });
  if (title) {
    await page.getByText(title, { exact: true }).first().dblclick();
  } else {
    await page.locator('.group.grid').first().dblclick();
  }
  await waitForPlaying(page, title);
}

export { LOCAL_SONGS, STRM_SONGS };
