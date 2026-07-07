#!/usr/bin/env bash
set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

# 确保工作区干净
if [ -n "$(git status --porcelain)" ]; then
  error "工作区有未提交的更改，请先提交或暂存"
fi

# 确保在主分支
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
  warn "当前分支: $BRANCH (不是 main/master)"
  read -rp "是否继续? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
fi

# 读取当前版本
CURRENT=$(node -p "require('./package.json').version")
info "当前版本: v${CURRENT}"

# 解析版本号
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# 选择版本类型
echo ""
echo "选择版本类型:"
echo "  1) patch  → v${MAJOR}.${MINOR}.$((PATCH + 1))"
echo "  2) minor  → v${MAJOR}.$((MINOR + 1)).0"
echo "  3) major  → v$((MAJOR + 1)).0.0"
echo "  4) 自定义"
echo ""
read -rp "请选择 [1-4] (默认 1): " choice
choice=${choice:-1}

case $choice in
  1) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  2) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
  3) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
  4)
    read -rp "输入版本号 (不带 v 前缀): " NEW_VERSION
    [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || error "无效的版本号格式"
    ;;
  *) error "无效选择" ;;
esac

TAG="v${NEW_VERSION}"

# 检查 tag 是否已存在
if git rev-parse "$TAG" &>/dev/null; then
  error "Tag ${TAG} 已存在"
fi

info "新版本: ${TAG}"
echo ""
read -rp "确认发布 ${TAG}? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { warn "已取消"; exit 0; }

# 更新 package.json 版本号
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version
info "已更新 package.json 版本号"

# 提交版本变更
git add package.json
git commit -m "release: ${TAG}"
info "已提交版本变更"

# 生成版本发布数据（在创建 tag 之前，确保 release_notes.md 包含在 tag 指向的 commit 中）
chmod +x scripts/generate-release-data.sh
./scripts/generate-release-data.sh "$NEW_VERSION"
mkdir -p releases
git add package.json releases/ release_notes.md 2>/dev/null || git add package.json release_notes.md
git commit --amend --no-edit || true

# 创建 tag（必须在 amend 之后，否则 tag 指向旧 commit）
git tag -a "$TAG" -m "Release ${TAG}"
info "已创建 tag: ${TAG}"

# 推送到远程
git push origin "$BRANCH"
git push origin "$TAG"
info "已推送到远程，GitHub Actions 将构建并创建 Release（含 dist.tar.gz）"

echo ""
echo -e "${GREEN}🎉 发布已触发!${NC}"
echo "   版本: ${TAG}"
echo "   查看构建: https://github.com/qwex888/zhiyin-music-web/actions"
echo "   查看发布: https://github.com/qwex888/zhiyin-music-web/releases"
echo ""
echo "   说明: GitHub Release 由 CI 创建并上传 dist.tar.gz，请勿在本地执行 gh release create"
echo "   若 CI 失败，可在 Actions 中手动重跑「Build & Release」并输入 tag: ${TAG}"
