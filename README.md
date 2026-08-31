# 游浪游戏资源发布网站

基于 Vue 3、TypeScript、Element Plus、Cloudflare Workers、Hono 和 D1 的游戏资源发布平台。

## 本地开发

```bash
npm install
npm run dev
```

前端默认运行在 `http://127.0.0.1:5173`。

API 和本地 D1：

```bash
npx wrangler d1 migrations apply youlun-db --local --config wrangler.toml
npx wrangler d1 execute youlun-db --local --file worker/seeds/development.sql --config wrangler.toml
npm run dev:api
```

API 默认运行在 `http://127.0.0.1:8787`，Vite 会将 `/api` 请求代理至该端口。

## 当前阶段

- 已完成 Vue 前台纵切和主要交互原型。
- 已建立 D1 完整数据模型、开发种子和公开游戏查询 API。
- 登录、反馈、会员工单目前使用前端演示状态，下一迭代接入 Workers 会话和持久化 API。

## 安全说明

- 不要提交 `.env`、`.dev.vars`、Cloudflare 凭据或 Cloudinary API Secret。
- 真实下载地址只能由鉴权后的独立 API 返回，不得加入公开游戏详情响应。
- `wrangler.toml` 配置单个 Worker 同时托管 Vue 静态资源和 `/api` 接口。
