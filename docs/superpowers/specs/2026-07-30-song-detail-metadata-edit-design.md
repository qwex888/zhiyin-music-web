# 歌曲详情与元数据编辑设计

日期：2026-07-30  
状态：待实现  
范围：`zhiyin-web` + `rust-mucis-service`

## 1. 目标

提供统一的歌曲详情弹窗：查看全部元数据；管理员可进入编辑态，修改文本元数据、封面、歌词，保存后写入数据库，并按来源写回文件（本地标签 / strm 侧车）。

## 2. 决策摘要

| 项 | 决策 |
|----|------|
| 数据加载 | 打开时 `GET /api/songs/{id}` |
| 列表入口 | 仅「更多菜单」；`VirtualSongList` 内置处理 |
| 布局 | 封面头图 + 分区键值列表 |
| 空值 | 显示 `—` |
| 可编辑文本 | `title` / `artist` / `album` / `year` / `track_no` / `genre`（与刮削写回对齐） |
| 封面 | 本地上传 + 刮削源搜索暂存，随主保存提交 |
| 歌词 | 搜索弹窗暂存（编辑态）或立即替换（播放器菜单） |
| 权限 | 编辑相关入口与写 API 仅管理员 |
| 弹层 | PC 居中；移动端底部抽屉（对齐 `AddToPlaylistModal`） |

## 3. 前端架构

### 3.1 组件

| 组件 | 职责 |
|------|------|
| `SongDetailModal.vue` | 详情查看 / 编辑；暂存封面与歌词；主保存 |
| `CoverSearchModal.vue` | 按刮削源搜索封面；选中后 `emit` 暂存数据给父组件 |
| `LyricsSearchModal.vue`（扩展） | 新增 `applyMode: 'immediate' \| 'defer'`；`defer` 时 emit 歌词文本，不调用 replace |
| （无独立壳组件） | 各弹窗复用 `AddToPlaylistModal` 的 Teleport + 响应式 class；详情弹窗移动端改为全屏 |

### 3.2 `SongDetailModal` 行为

**Props**

- `modelValue: boolean`
- `songId: number \| null`
- `mode: 'view' \| 'edit'`

**View**

- 顶部封面 + 标题 / 艺人 / 专辑
- 分区只读：基本信息、音频技术、文件信息
- 展示 `Song`（及 API 附加字段）全部字段；空为 `—`

**Edit**

- 可改：title、artist、album、year、track_no、genre
- 封面区：当前/暂存预览 + 上传 + 搜索
- 歌词区：展示「已有 / 已暂存」摘要 +「搜索/更换」按钮
- 底部：取消、保存
- 保存成功：toast → 重新拉取详情 → 切回 `view` 并清空暂存；触发 `songEvents.emitSongUpdated`

**暂存状态**

- `pendingCover: { kind: 'file', file: File } \| { kind: 'url', url: string, source?: string } \| null`
- `pendingLyrics: string \| null`
- 关闭弹窗时清空暂存

### 3.3 入口

| 入口 | 行为 |
|------|------|
| `VirtualSongList` → `viewDetails` | 内置打开，`mode=view`（所有用户） |
| `VirtualSongList` → `editMetadata` | 新菜单项，admin only，`mode=edit` |
| `FullScreenPlayer` → 详情 | `mode=view` |
| `FullScreenPlayer` → 编辑元数据 | admin，`mode=edit` |
| `FullScreenPlayer` / 列表 → 搜歌词 | 现有 `LyricsSearchModal`，`applyMode=immediate` |

父页中空的 / 错误的 `viewDetails`（如 `router.push('/songs/:id')`）改为依赖列表内置，可删除无效分支。

### 3.4 弹层适配

| 弹窗 | PC | 移动 |
|------|-----|------|
| `SongDetailModal` | 居中大半屏（约 `max-w-3xl`，`max-h-[85vh]`） | **全屏** |
| `CoverSearchModal` / 编辑态 `LyricsSearchModal` | 居中卡片 `max-h-[80vh]` | **底部抽屉**约 `85vh`，顶部拖拽条 |

- 子弹窗 `z-index` 高于详情弹窗；关闭子弹窗不关闭父编辑弹窗
- 参考：`AddToPlaylistModal.vue` 的 Teleport + transition 结构

### 3.5 API 客户端（`music.ts`）

- `updateSongTags(id, body)` → `PUT /api/songs/{id}/tags`（文本 + 可选 `lyrics` + 可选 `cover_url`）
- `uploadSongCover(id, file)` → `POST /api/songs/{id}/cover`（multipart）
- `searchCovers(id, params)` → `POST /api/songs/{id}/covers/search`
- 歌词搜索/立即替换继续用 `searchLyrics` / `replaceLyrics` / `getLyrics`

**编辑弹窗主保存顺序（固定）：**

1. 若 `pendingCover.kind === 'file'`：先 `uploadSongCover`
2. 再 `updateSongTags`：文本字段 +（若有）`lyrics` +（若 `pendingCover.kind === 'url'`）`cover_url`
3. 编辑态**不**再调用 `replaceLyrics`（歌词只走 tags，避免双写）
4. 播放器/列表「搜歌词」菜单仍走 `replaceLyrics`（`applyMode=immediate`）

## 4. 后端架构（`rust-mucis-service`）

### 4.1 `PUT /api/songs/{id}/tags`

- 鉴权：登录 + **admin**
- Body（字段均可选；未传不改）：

```json
{
  "title": "string",
  "artist": "string",
  "album": "string",
  "year": 2005,
  "track_no": 1,
  "genre": "Pop; Rock",
  "lyrics": "optional lrc text",
  "cover_url": "optional https://... from covers/search"
}
```

- 流程：
  1. 查歌曲；不存在 404
  2. 若有 `cover_url`：服务端下载图片，走与 `POST /cover` 相同的写回路径（cover-store / 嵌入 / 旁路 / 侧车）
  3. DB 更新：对齐刮削 `update_song_metadata_text`（title、artist/album resolve、year、track_no、genre）
  4. `genre`：经 `GenreService` 同步多对多，手动源 + lock（与手改风格一致）
  5. **local**：`TagWriter::write_metadata`；若有 lyrics 则按现有 `lyrics_replace` 规则写嵌入或 `.lrc`
  6. **strm**：merge 现有侧车后 `write_sidecar`（`scrape.metadata_format`）；lyrics 仅 `.lrc`
  7. 返回更新后的 `SongWithDetails` + `fields_updated` / `lyrics_method` / `cover_updated` 等

### 4.2 `POST /api/songs/{id}/cover`

- 鉴权：admin；`multipart/form-data`，字段名 `file`
- 流程对齐刮削 `apply_cover_bytes`：
  - cover-store 持久化并更新 `songs.cover_id`（及专辑封面策略与刮削一致）
  - local：尝试 `TagWriter::write_cover`；失败仍保留 DB 封面
  - 旁路文件 `cover-{stem}.{ext}`（strm 必写；local 按现有 scrape 规则）
  - strm：更新侧车 `cover_file` 字段

### 4.3 `POST /api/songs/{id}/covers/search`

- 鉴权：登录（与 `lyrics/search` 同级即可；写回仍需 admin）
- Body：`{ title?, artist?, album? }`
- 行为：聚合启用且具备 cover/search 能力的刮削源，返回候选列表：

```json
{
  "results": [
    {
      "source": "netease",
      "song_id": "...",
      "title": "...",
      "artist": "...",
      "album": "...",
      "cover_url": "https://..."
    }
  ]
}
```

- 前端选中后暂存 `cover_url`；主保存时随 `PUT /tags.cover_url` 由服务端下载并写回（避免浏览器 CORS）。本地上传文件仍走 `POST /cover`。

### 4.4 不改动

- 不改音频技术探测上报接口语义（`POST /metadata` 仍为 strm 技术字段）
- 本期不做 disc_no、album_artist、批量编辑

## 5. i18n

新增键（中英）：

- `songs.actions.edit_metadata`
- `songs.detail.*`（分区标题、字段标签、空值、保存成功/失败）
- `songs.cover_search.*`
- 复用既有 `lyrics.*` 文案

## 6. 错误处理

- 详情加载失败：弹窗内错误态 + 重试
- 保存部分成功（如标签已写、封面失败）：toast 明确失败项；尽量返回已成功字段
- 文件不可写 / 路径不存在：400/500 + 可读 message
- 刮削功能关闭时：封面/歌词搜索提示并引导设置页（对齐现有 scrape disabled toast）

## 7. 测试要点

**后端**

- local：更新 DB + 标签写入（可用测试夹具音频）
- strm：DB + 侧车 + `.lrc` / cover 旁路文件
- 非 admin：403
- covers/search：无源/空结果

**前端**

- view/edit 切换与暂存清空
- VirtualSongList / FullScreenPlayer 入口与 admin 可见性
- 移动抽屉 / PC 居中；嵌套弹窗层级
- defer 歌词不立即 replace；immediate 保持原行为

## 8. 实现顺序建议

1. 后端 `PUT /tags` + `POST /cover` + `POST /covers/search`
2. 前端 `SongDetailModal`（view）
3. 编辑文本 + 保存
4. 封面上传与 `CoverSearchModal`
5. `LyricsSearchModal` defer 模式
6. 接入 VirtualSongList / FullScreenPlayer + 清理父页无效分支
7. i18n 与手动/单测验证

## 9. 非目标

- 普通用户编辑
- 独立歌曲详情路由页
- 在详情内跳转艺人/专辑（可后续加）
- 封面 URL 手填（仅上传 + 搜索）
