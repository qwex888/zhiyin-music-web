import { test, expect } from '@playwright/test';
import {
  installApiMocks,
  loginAsAdmin,
  goSongsAndPlayFirst,
  goSongsAndPlayAll,
  waitForPlaying,
} from './helpers';

test.describe('冒烟 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, 'local');
  });

  test('登录成功进入首页', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('播放本地歌曲', async ({ page }) => {
    await loginAsAdmin(page);
    await goSongsAndPlayFirst(page, 'Local Track A');
    // waitForPlaying 已校验：标题 + data-playing + 进度前进
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'true');
  });

  test('拖动进度条 seek', async ({ page }) => {
    await loginAsAdmin(page);
    await goSongsAndPlayFirst(page, 'Local Track A');

    const seek = page.getByTestId('player-seek');
    await seek.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect
      .poll(async () => Number(await seek.inputValue()), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(40);
    // seek 后仍应保持播放
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'true');
  });

  test('切歌到下一首', async ({ page }) => {
    await loginAsAdmin(page);
    await goSongsAndPlayAll(page);
    await expect(page.getByTestId('player-current-title')).toHaveText('Local Track A');

    await page.getByTestId('player-next').click();
    await waitForPlaying(page, 'Local Track B');
  });

  test('未缓存首播也可 seek（UI 进度更新）', async ({ page }) => {
    await loginAsAdmin(page);
    await goSongsAndPlayFirst(page, 'Local Track A');

    const seek = page.getByTestId('player-seek');
    await seek.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '30';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThanOrEqual(20);
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'true');
  });
});

test.describe('冒烟 E2E · STRM', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, 'strm');
  });

  test('播放 strm 歌曲', async ({ page }) => {
    await loginAsAdmin(page);
    await goSongsAndPlayFirst(page, 'Strm Track X');
    await expect(page.getByTestId('player-toggle')).toHaveAttribute('data-playing', 'true');
  });

  test('strm 切歌', async ({ page }) => {
    await loginAsAdmin(page);
    await goSongsAndPlayAll(page);
    await expect(page.getByTestId('player-current-title')).toHaveText('Strm Track X');
    await page.getByTestId('player-next').click();
    await waitForPlaying(page, 'Strm Track Y');
  });
});
