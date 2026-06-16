<div align="center">
  <img src="src/assets/logo.svg" alt="ZHIYIN Logo" width="128" />
  <h1>ZHIYIN Music · 知音音乐</h1>
  <p>Self-hosted NAS music streaming web client</p>

  ![Vue](https://img.shields.io/badge/Vue_3-4FC08D?logo=vuedotjs&logoColor=white)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)

  [简体中文](./README_CN.md) | English
</div>

---

## Introduction

**ZHIYIN Music（知音音乐）** is a music streaming frontend application designed for NAS users, providing a modern web interface to manage and play your personal music library.

### Features

- 🎵 Online streaming with multiple quality options (128k / 192k / 320k / FLAC / Original)
- 📝 Synchronized lyrics display with bilingual support
- 🎨 Light / Dark theme switching
- 🌐 Chinese / English bilingual interface
- 📱 Responsive design for desktop and mobile
- 🔍 Music library scanning & management
- 📊 Playback statistics & data visualization
- 🎯 Smart recommendations
- 🏷️ Multi-source metadata scraping (NetEase, QQ Music, Kugou, Kuwo, Migu, AcoustID) with lyrics preview and batch operations
- 📂 File organization — rename and restructure music files based on scraped metadata
- 📴 Offline mode — PWA with Service Worker caches audio streams on first play; supports Range-based seek from cache, IndexedDB library sync, and network-aware auto fallback
- ☁️ STRM support — play remote cloud-storage files (`.strm`) via server proxy; auto-detects source type, locks quality to Original, and shows distinct error messages for remote failures

### Tech Stack

| Technology | Purpose |
|------------|---------|
| Vue 3 + Composition API | Frontend framework |
| TypeScript | Type safety |
| Tailwind CSS | Styling |
| Pinia | State management |
| Vue Router | Routing |
| Vue I18n | Internationalization |
| Howler.js | Audio playback |
| Workbox + vite-plugin-pwa | Offline PWA & Service Worker |
| Vite | Build tool |

---

## Backend Deployment

> **This repository contains frontend code only.** To fully experience ZHIYIN, you need to deploy the backend service first.

Backend GitHub repository (includes Docker examples and config samples): [**github/zhiyin-music**](https://github.com/qwex888/zhiyin-music)

Backend Docker image: [**qwex333/zhiyin-music**](https://hub.docker.com/r/qwex333/zhiyin-music)

```bash
docker pull qwex333/zhiyin-music:latest
```

Quick start with Docker Compose (example):

```yaml
version: '3.8'

services:
  zhiyin-music:
    image: qwex333/zhiyin-music:latest
    container_name: zhiyin-music
    
    ports:
      - "8080:8080"
    
    volumes:
      # 音乐目录可选（只读）- 请修改为你的实际路径
      # 默认配置会自动扫描 /music，无需再手动配置 config.toml
      - ./music:/music
      
      # 数据库目录可选（持久化）
      #- ./data:/data
      
      # 封面缓存目录(可选， 如果想手动管理封面)
      #- ./covers:/covers
      
      
      # Web 前端已内置于镜像中（/app/web）
      # 如需使用自定义前端，可取消注释覆盖：
      # - ./web/dist:/app/web:ro
      
      # 配置文件（可选，高级自定义时再启用）
      # - ./config.toml:/app/config.toml:ro
    
    environment:
      # 日志级别
      - RUST_LOG=info
      # Subsonic 密码加密 Pepper（可选）
      # 不设置时服务会自动生成并持久化到 /data/.zhiyin/key_pepper
      # 设置后优先使用该值（适合多实例统一密钥）
      # 生成方式: openssl rand -hex 32
      # - MUSIC_KEY_PEPPER=your-random-hex-secret-here
      # 如需自定义托管文件路径（可选）：
      # - MUSIC_KEY_PEPPER_FILE=/data/.zhiyin/key_pepper
      
      # 初始管理员（仅首次启动时生效，创建后可删除）
      # - MUSIC_ADMIN_USER=admin
      # - MUSIC_ADMIN_PASSWORD=your_secure_password
      
      # 如需覆盖默认配置，可通过 MUSIC_* 环境变量或挂载 config.toml
    
    # 内存限制（含文件页缓存），防止在小内存主机上占用过多内存
    # 256m 适合大多数场景；极低内存主机可设为 192m，追求缓存加速可设为 512m
    # mem_limit: 256m
    
    restart: unless-stopped
    
    # 健康检查（镜像中未安装 curl/wget，使用内置二进制的 HTTP 自检）
    # 如安装了 wget 可替换为: test: ["CMD-SHELL", "wget -qO- http://localhost:8080/api/health || exit 1"]
    healthcheck:
      test: ["CMD", "zhiyin-music", "--health-check"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
    
    networks:
      - music-network

networks:
  music-network:
    driver: bridge

# 使用说明（零配置默认）：
# 1. 修改 volumes 中的音乐目录路径（./music 改为你的实际路径）
# 2. 运行: docker-compose up -d
# 3. 查看日志: docker-compose logs -f
# 4. 停止服务: docker-compose down
# 5. 访问 API: http://localhost:8080/api/songs
# 6. 访问文档: http://localhost:8080/swagger-ui
# 7. 如需高级自定义：挂载 config.toml 或设置 MUSIC_* 环境变量
#
# 配置热重载（无需重启）：
#   docker-compose kill -s SIGHUP zhiyin-music

```

The backend listens on port `8080` by default. During frontend development, Vite proxies `/api` requests to the backend.

---

## Local Development

### Prerequisites

- Node.js >= 18
- pnpm / npm / yarn

### Install & Run

```bash
# Install dependencies
npm install

# Start dev server (default port 7321)
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

### Dev Proxy Configuration

In development mode, API requests are proxied to the backend service. Update `proxy.target` in `vite.config.ts` to point to your backend:

```ts
proxy: {
  '/api': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
  }
}
```

---

## Sponsor & Support

ZHIYIN Music is an open-source project, free to use. If you find it helpful, you can support the development by:

- ⭐ Starring the project
- 🐛 Submitting Issues or PRs
- ☕ Buying the author a coffee

<div align="center">
  <img src="docs/donate/alipay.jpg" alt="Alipay" width="200" />
</div>

---

## License

MIT
