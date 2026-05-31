# 媒体 Provider API 验证报告

验证日期：2026-05-31

## 结论

Vidking 可以作为视频 iframe provider 集成，但它不是完整搜索 API。它的公开入口是基于 TMDB ID 的嵌入播放器，搜索层需要由应用侧单独完成。

Lidarr 可以作为本地音乐库管理 API 集成，但它不是公共音频流媒体 API。它需要用户本机运行 Lidarr，并配置 Lidarr API Key；要在卡片里播放音频，还需要把 Lidarr 返回的本地音频文件安全地暴露给前端播放器。

## Vidking 验证

官方页面提供的嵌入路由：

- 电影：`https://www.vidking.net/embed/movie/{tmdbId}`
- 剧集：`https://www.vidking.net/embed/tv/{tmdbId}/{season}/{episode}`

可用 URL 参数：

- `color`：播放器主题色，十六进制颜色值，不带 `#`
- `autoPlay`：是否自动播放
- `nextEpisode`：剧集下一集按钮
- `episodeSelector`：剧集选集菜单
- `progress`：起播秒数

实测结果：

- `https://www.vidking.net/embed/movie/550` 返回 `HTTP 200`。
- `https://www.vidking.net/embed/tv/1399/1/1` 返回 `HTTP 200`。
- 响应头没有 `X-Frame-Options`，可以作为 iframe 嵌入。
- 元数据搜索接口 `https://db.videasy.net/3/search/movie?query=Fight%20Club&language=en-US` 返回 JSON，并带 `access-control-allow-origin: *`。
- 元数据搜索接口 `https://db.videasy.net/3/search/tv?query=Game%20of%20Thrones&language=en-US` 返回 JSON，并能拿到 TMDB 风格的 `id`、标题、海报和简介。

项目影响：

- 当前 `media-player` surface 已支持 `embedUrl`，前端也已经用 iframe 渲染，因此 UI 层基本可复用。
- 当前 `videoEmbedUrl()` 只识别 YouTube 和 Bilibili，需要增加 Vidking embed URL 识别。
- 当前 Tauri CSP 没有 `frame-src`，打包后的桌面 App 会拦截外部 iframe；需要显式放行 `https://www.vidking.net`。
- 如果要做“搜索后播放”，后端需要增加视频搜索解析：用户输入片名 -> 查询元数据 -> 选择 TMDB ID -> 生成 Vidking embed URL -> 返回 `media-player` 卡片。

合规约束：

- 只能用于用户有权访问或已获授权的内容。
- 不建议在本地解密或代理 Vidking iframe 内部的实际媒体源；应用侧只应集成公开 iframe。

## Lidarr 验证

官方 OpenAPI 文档入口：

- `https://lidarr.audio/docs/api/`
- OpenAPI JSON：`https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json`

默认服务：

- `http://localhost:8686`

关键 endpoint：

- `GET /api/v1/artist/lookup?term=...`
- `GET /api/v1/album/lookup?term=...`
- `GET /api/v1/search?term=...`
- `GET /api/v1/track?artistId=...`
- `GET /api/v1/trackfile?artistId=...`
- `GET /api/v1/system/status`

实测结果：

- 本机 `http://localhost:8686/api/v1/system/status` 连接失败，说明当前没有运行可测试的 Lidarr 实例。
- 官方 OpenAPI 可访问，确认上述 endpoint 存在。

项目影响：

- Lidarr 可以负责“搜索本地音乐库/艺人/专辑/曲目”和返回已导入曲目的文件信息。
- Lidarr 不直接返回公网可播放音频流；它通常返回本地路径和媒体库元数据。
- 前端 `<audio>` 不能直接安全播放任意本地文件路径。需要新增一个本地文件桥接层，只允许代理 Lidarr 已返回且通过校验的媒体文件。
- 需要新增配置项：`PET_LIDARR_BASE_URL`、`PET_LIDARR_API_KEY`，或在 App 设置页增加 Lidarr 配置。

## 推荐集成方案

第一阶段先做 provider 抽象，不直接耦合到播放器：

1. `VideoProvider`：输入搜索词和类型，输出 `{ title, subtitle, embedUrl, thumbnailUrl, provider }`。
2. `MusicProvider`：输入搜索词，输出 `{ title, artist, album, localPath?, src? }`。
3. `MediaResolver`：由用户意图决定调用视频或音乐 provider，再生成 `media-player` surface。

第二阶段实现 Vidking 视频搜索：

1. 解析“电影/剧集/第几季第几集”等意图。
2. 查询元数据搜索接口拿 TMDB ID。
3. 生成 Vidking iframe embed URL。
4. 返回视频卡片。
5. 更新 Tauri CSP 放行 Vidking iframe。

第三阶段实现 Lidarr 本地音乐：

1. 增加 Lidarr 配置和连接检测。
2. 调用 Lidarr 搜索曲目/专辑/艺人。
3. 对已存在的本地曲目建立受限媒体文件代理。
4. 返回音频卡片，`src` 指向本机代理 URL。

## 当前可行性判断

- 视频卡片播放：可行，但需要补搜索解析和 CSP。
- 音频卡片播放：可行，但前提是用户本机有 Lidarr 实例和已导入音乐文件；还需要本地文件代理。
- 两者都不能直接当成“输入关键词 -> 返回通用公网可播放音视频直链”的 API。
