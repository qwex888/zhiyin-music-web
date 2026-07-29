import { test, expect } from '@playwright/test';
import {
  fixturesAvailable,
  installFixtureApiMocks,
  loginAsAdmin,
  goSongsAndPlayFirst,
  waitForServiceWorker,
  waitForPlaying,
} from './helpers';

/**
 * L3：真实夹具 + 弱网限速 + 允许 Service Worker。
 * 优先使用 e2e/test-plan-a-short.flac（由完整夹具截取）；夹具已 gitignore。
 */
test.describe('弱网缓存 L3 · 路径 A/B', () => {
  test.skip(!fixturesAvailable(), '缺少 e2e/test-plan-a.flac / test-plan-a-short.flac');

  test.use({ serviceWorkers: 'allow' });
  test.setTimeout(120_000);

  test('路径 A：弱网起播 + seek 后 Range 优先后方', async ({ page }) => {
    const { rangeLog, fileSize } = await installFixtureApiMocks(page, {
      mode: 'local',
      preferFullFixture: true,
      throttleBytesPerSec: 4 * 1024 * 1024,
      maxThrottleDelayMs: 350,
    });

    await loginAsAdmin(page);
    await waitForServiceWorker(page);
    await goSongsAndPlayFirst(page, 'Fixture Local FLAC');

    const mark = rangeLog.length;
    const seek = page.getByTestId('player-seek');
    await seek.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '55';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect
      .poll(async () => Number(await seek.inputValue()), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(45);
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'true');

    // 完整夹具 ~39MB：起播通常只缓存开头数 MB，seek 到 55% 应打到后方 Range
    const seekByte = Math.floor(fileSize * 0.45);
    await expect
      .poll(() => rangeLog.slice(mark).some((r) => r.start >= seekByte - 5 * 1024 * 1024), {
        timeout: 40_000,
      })
      .toBe(true);

    await waitForPlaying(page, 'Fixture Local FLAC');
  });

  test('路径 B：弱网 progressive 泵满后可 seek', async ({ page }) => {
    await installFixtureApiMocks(page, {
      mode: 'strm',
      throttleBytesPerSec: 6 * 1024 * 1024,
      maxThrottleDelayMs: 300,
    });

    await loginAsAdmin(page);
    await waitForServiceWorker(page);
    await goSongsAndPlayFirst(page, 'Fixture Strm FLAC');

    const seek = page.getByTestId('player-seek');
    // 未缓存时应禁用；泵满 / hot-swap 后可拖
    await expect(seek).toBeEnabled({ timeout: 90_000 });

    await seek.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '40';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect
      .poll(async () => Number(await seek.inputValue()), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(30);
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'true');
  });
});
