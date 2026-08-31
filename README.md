# 游浪游戏资源发布网站

基于 Vue 3、TypeScript、Element Plus、Cloudflare Workers、Hono 和 D1 的游戏资源发布平台。前端静态资源和 `/api` 由同一个 Worker 托管。

## 已实现能力

- D1 游戏、分类和标签查询，支持搜索、组合筛选与分页。
- 用户注册、登录、退出、会话恢复和密码修改。
- PBKDF2-SHA256 密码哈希、HttpOnly 会话 Cookie、登录失败限流和服务端权限校验。
- 免费/会员下载地址按身份授权，公开响应不包含真实 URL。
- 用户反馈、资源失效提醒、会员付款工单和进度查询。
- 管理后台的游戏/下载地址、分类/标签、用户会员、工单审核和反馈处理。
- Cloudinary 游戏封面上传。

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

先执行远程迁移：

```bash
npm run db:migrate:remote
```

`main` 分支已连接 Cloudflare Workers Builds。每次推送后执行 `npm run build` 和 `npx wrangler deploy`。生产资源配置位于 `wrangler.toml`。

## 安全说明

- 不要提交 `.env`、`.dev.vars`、Cloudflare 凭据或 Cloudinary API Secret。
- 下载地址只允许通过鉴权 API 返回，不得加入公开详情或前端源码。
- Cloudinary unsigned preset 应在控制台限制图片格式、大小、目录和来源。
- 月度会员到期、用户禁用和管理员权限均由 Worker 校验，前端状态不作为授权依据。
