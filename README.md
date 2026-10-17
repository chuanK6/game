# 游浪游戏资源发布网站

基于 Vue 3、TypeScript、Element Plus、Cloudflare Workers、Hono 和 D1 的游戏资源发布平台。前端静态资源和 `/api` 由同一个 Worker 托管。

## 已实现能力

- D1 游戏、分类和标签查询，支持搜索、组合筛选与分页。
- 用户注册、登录、退出、会话恢复和密码修改。
- PBKDF2-SHA256 密码哈希、HttpOnly 会话 Cookie、登录失败限流和服务端权限校验。
- 免费/会员下载地址按身份授权，公开响应不包含真实 URL。
- 用户反馈、资源失效提醒、会员付款工单和进度查询。
- 管理后台的游戏/下载地址、分类/标签、用户会员、工单审核和反馈处理。
- R2 游戏封面和正文图片上传，兼容已有 Cloudinary 图片地址。
- Markdown 游戏介绍、实时预览、截图粘贴/拖拽上传、图片放大，以及旧纯文本介绍的转换预览。

## 本地开发

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
```

种子命令只在空的本地数据库执行一次。分别启动 API 和前端：

```bash
npm run dev:api
npm run dev
```

前端运行于 `http://127.0.0.1:5173`，API 运行于 `http://127.0.0.1:8787`，Vite 将 `/api` 代理到 Wrangler。

## 管理员初始化

先通过网站注册一个账号，再通过 Wrangler 将该账号提升为管理员。用户名需要替换成实际值：

```bash
npx wrangler d1 execute youlun-db --remote --command "UPDATE users SET role = 'admin' WHERE username = 'your_username'"
```

退出并重新登录后，导航中会出现“管理后台”。不要在迁移或仓库中保存默认管理员密码。

## 测试

首次测试前准备本地 D1：

```bash
npm run db:migrate:local
npm run db:seed:local
npm run build
npm run test:e2e
```

Playwright 会自动启动 Wrangler 和 Vite。核心类型检查：

```bash
npm run typecheck
npm run typecheck:api
```

## 生产部署

先执行远程迁移（本次新增 `0003_game_description_format.sql`，已有介绍默认保留为纯文本）：

```bash
npm run db:migrate:remote
```

`main` 分支已连接 Cloudflare Workers Builds。每次推送后执行 `npm run build` 和 `npx wrangler deploy`。生产资源配置位于 `wrangler.toml`。

## 图片与 Markdown

- `wrangler.toml` 中的 `MEDIA` 绑定存储桶 `youlang`，`MEDIA_PUBLIC_URL` 为 `https://cdn.youlang.cc.cd`。部署账号需有该桶的访问权限；Worker 通过绑定上传，无需配置 S3 访问密钥。
- `POST /api/admin/uploads/images` 使用登录 Cookie 和管理员权限，接收 `multipart/form-data` 的 `file` 与 `purpose`（`cover` / `content`），返回 `{ ok: true, data: { key, url } }`。
- 支持 JPG、PNG、WebP，每张最多 5 MB。服务端限制实际请求大小并检查文件签名和 MIME；浏览器会按需缩小 JPEG/PNG 大图。
- `wrangler dev` 默认使用本地 R2，上传返回 `/api/media/images/...`；线上返回图片自定义域名。公开图片读取支持 HEAD、ETag 和长期缓存，并跳过会话/D1 查询。
- 图片按随机文件名保存到 `images/cover/` 和 `images/content/`。第一版保留上传后未使用的图片；清理前须检查游戏封面和正文（包括草稿）的引用。
- 正文保存在 D1 的 `description`，格式保存在 `description_format`。新建游戏默认 `markdown`，旧数据为 `plain`；旧客户端省略格式字段时，更新操作保留原格式。
- 后台支持编辑/预览、桌面双栏、全屏、上传失败重试；上传期间暂停正文编辑并禁用保存。关闭表单会取消上传，避免结果回填其他游戏。
- 旧介绍可继续直接编辑，或点击“转换为 Markdown”，预览后采用。转换及其他编辑仅在“保存游戏”后持久化。
- Markdown 最多 30000 字符，使用 `markdown-it`（关闭原始 HTML）与 DOMPurify。后台预览和详情共用渲染器、深色主题与手机样式。
- 游戏列表只返回卡片字段，完整介绍及最低配置通过详情接口获取。会员下载地址仍由鉴权接口提供。

相关测试：`npx playwright test tests/e2e/markdown.spec.ts`，建议使用 Node 24（测试使用内置 `node:sqlite`）。测试使用隔离的内存数据库与图片存储替身，覆盖迁移、权限、文件校验、缓存、旧数据编辑和 Markdown 安全渲染。

## 安全说明

- 不要提交 `.env`、`.dev.vars`、Cloudflare 凭据或 R2 S3 访问密钥。
- 下载地址只允许通过鉴权 API 返回，不得加入公开详情或前端源码。
- 新上传统一经过管理员接口；历史 Cloudinary 图片可继续显示，移除旧上传 preset 前应确认没有旧客户端使用。
- 月度会员到期、用户禁用和管理员权限均由 Worker 校验，前端状态不作为授权依据。
