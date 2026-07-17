<div align="center">
  <img src="src/assets/logo.svg" alt="ZHIYIN Logo" width="128" />
  <h1>ZHIYIN Music · 知音音乐</h1>
  <p>自部署 NAS 音乐流媒体 Web 客户端</p>

  ![Vue](https://img.shields.io/badge/Vue_3-4FC08D?logo=vuedotjs&logoColor=white)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
  ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)

  简体中文 | [English](./README.md)
</div>

---

## 简介

**ZHIYIN Music（知音音乐）** 是一个面向 NAS 用户的音乐流媒体前端应用，提供现代化的 Web 界面来管理和播放你的个人音乐库。

### 主要功能

- 🎵 在线串流播放，支持多种音质（128k / 192k / 320k / FLAC / 原始）
- 📝 歌词同步显示，支持双语歌词
- 🎨 亮色 / 暗色主题切换
- 🌐 中文 / English 双语界面
- 📱 响应式设计，适配桌面与移动端
- 🔍 音乐库扫描与管理
- 📊 播放统计与数据可视化
- 🎯 智能推荐
- 🏷️ 多源元数据刮削（网易云、QQ音乐、酷狗、酷我、咪咕、AcoustID），支持歌词预览与批量操作
- 📂 文件整理 — 根据刮削的元数据自动重命名和归档音乐文件
- 📴 离线模式 — PWA + Service Worker 首次播放自动缓存音频流，支持缓存内 Range 切片 seek、IndexedDB 曲库同步、断网自动降级离线播放
- ☁️ STRM 远程文件支持 — 通过服务端代理播放网盘直链（`.strm`），自动识别来源类型，远程歌曲锁定原始音质，播放失败显示专属错误提示

### 技术栈

| 技术 | 用途 |
|------|------|
| Vue 3 + Composition API | 前端框架 |
| TypeScript | 类型安全 |
| Tailwind CSS | 样式 |
| Pinia | 状态管理 |
| Vue Router | 路由 |
| Vue I18n | 国际化 |
| Howler.js | 音频播放 |
| Workbox + vite-plugin-pwa | 离线 PWA 与 Service Worker |
| Vite | 构建工具 |

---

## 后端部署

> **本项目仅包含前端代码。** 要完整体验 ZHIYIN，你需要先部署后端服务。

后端 github 地址（包含 docker 示例和配置文件示例）：[**github/zhiyin-music**](https://github.com/qwex888/zhiyin-music)

后端 Docker 镜像：[**qwex333/zhiyin-music**](https://hub.docker.com/r/qwex333/zhiyin-music)

```bash
docker pull qwex333/zhiyin-music:latest
```

使用 Docker Command 快速启动：

默认推荐挂载数据目录，迁移或删除重建数据不丢失

```bash
docker run --name zhiyin-music -v /path/to/your/music:/music -v ./data:/data -p 8080:8080 zhiyin-music:latest
```

如果你只想使用 strm 快速管理音乐库，那么可以试试：

```bash
docker run --name zhiyin-music -v /path/to/your/music:/music -p 8080:8080 zhiyin-music:latest
```

使用 Docker Compose 快速启动（示例）：

```yaml
version: '3.8'

services:
  zhiyin-music:
    image: qwex333/zhiyin-music:latest
    container_name: zhiyin-music

    # ──────────────────────────────────────────────────────────────
    # 用户身份（uid/gid）— 解决「刮削写入标签失败」的常见根因
    # ──────────────────────────────────────────────────────────────
    # 容器内进程必须以「对挂载音乐目录有写权限」的用户身份运行。
    # 若宿主机音乐文件归 uid=1000 所有，而容器以 root 或其他用户运行，
    # TagLib 保存标签时会失败（日志表现为：写入标签失败 / 文件无写入权限）。
    #
    # 查看宿主机音乐目录所有者：
    #   ls -ln /path/to/music | head
    #   # 输出类似: -rw-r--r-- 1 1000 1000 ...  → uid=1000, gid=1000
    #
    # 示例（按实际 ls -ln 结果取消注释并修改）：
    # user: "1000:1000"
    # 或分别指定：
    # user: "1000:1000"   # uid:gid
    #
    # 也可在宿主机侧放宽权限（二选一，优先用 user: 对齐）：
    #   chown -R 1000:1000 /path/to/music
    #   # 或 chmod -R u+w /path/to/music
    #
    # 注意：修改 user 后，./data 目录也需对应用户可写，否则数据库无法创建。
    # user: "1000:1000"
    
    ports:
      - "8080:8080"
    
    volumes:
      # 音乐目录可选 - 请修改为你的实际路径
      # 默认配置会自动扫描 /music，无需再手动配置 config.toml
      - ./music:/music
      
      # 数据库目录可选（持久化）
      - ./data:/data
      
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

后端服务默认监听 `8080` 端口，前端开发时通过 Vite 代理将 `/api` 请求转发到后端。

---

## 本地开发

### 前置条件

- Node.js >= 18
- pnpm / npm / yarn

### 安装与启动

```bash
# 安装依赖
npm install

# 启动开发服务器（默认端口 7321）
npm run dev

# 构建生产版本
npm run build

# 运行测试
npm test
```

### 开发代理配置

开发模式下，API 请求会代理到后端服务。修改 `vite.config.ts` 中的 `proxy.target` 指向你的后端地址：

```ts
proxy: {
  '/api': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
  }
}
```

---

## 赞助与支持

ZHIYIN Music 是一个发展中项目，完全免费使用。如果它对你有帮助，可以通过以下方式支持开发：

- ⭐ 给项目一个 Star
- 🐛 提交 Issue 或 PR
- ☕ 请作者喝杯咖啡

<div align="center">
  <img src="docs/donate/alipay.jpg" alt="支付宝" width="200" />
</div>

---

## 许可证

MIT
