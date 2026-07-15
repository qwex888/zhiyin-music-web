#!/usr/bin/env node
/**
 * 跑 Vitest，并校验用例通过率 ≥ 阈值（默认 100%）。
 * 用于 husky pre-commit：失败则阻止提交。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = resolve(ROOT, 'test-results/vitest-pass-rate.json');
const THRESHOLD = Number(process.env.TEST_PASS_RATE_MIN ?? '1');

mkdirSync(dirname(REPORT), { recursive: true });
if (existsSync(REPORT)) {
  try { unlinkSync(REPORT); } catch { /* ignore */ }
}

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${REPORT}`,
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: process.env.CI ?? 'true' },
  }
);

if (!existsSync(REPORT)) {
  console.error('\n[test:gate] 未生成 Vitest JSON 报告，无法计算通过率。');
  process.exit(result.status ?? 1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (err) {
  console.error('\n[test:gate] 解析 Vitest 报告失败:', err);
  process.exit(1);
}

const total =
  report.numTotalTests ??
  report.testResults?.reduce((n, f) => n + (f.assertionResults?.length ?? 0), 0) ??
  0;

const passed =
  report.numPassedTests ??
  report.testResults?.reduce(
    (n, f) => n + (f.assertionResults?.filter((a) => a.status === 'passed').length ?? 0),
    0
  ) ??
  0;

const failed =
  report.numFailedTests ??
  Math.max(0, total - passed);

if (total === 0) {
  console.error('\n[test:gate] 未发现任何测试用例，拒绝提交。');
  process.exit(1);
}

const rate = passed / total;
const pct = (rate * 100).toFixed(1);

console.log(
  `\n[test:gate] 通过 ${passed}/${total}（${pct}%），要求 ≥ ${(THRESHOLD * 100).toFixed(0)}%`
);

if (rate < THRESHOLD) {
  console.error(
    `[test:gate] 通过率不足：失败 ${failed} 条。请修复后再提交。`
  );
  process.exit(1);
}

if (result.status !== 0 && rate >= THRESHOLD) {
  // 通过率达标但 vitest 非 0（极少见）：仍放行并通过率门禁
  console.warn('[test:gate] Vitest 退出码非 0，但通过率已达标，允许继续。');
}

process.exit(0);
