# 1. 项目是什么

项目名为“游浪游戏资源发布网站”（包名 `youlun-game-resource`），是面向 PC 游戏资源浏览与下载的响应式网站。用户可以搜索、分类/标签筛选游戏，注册登录后获取免费资源，会员可访问会员资源；还支持会员付款工单、问题反馈、密码修改和历史记录。管理员后台可维护游戏、下载链接、分类标签、用户权限、会员工单和反馈。当前前后端、D1 数据库、权限校验及桌面/手机版均已实现，采用单个 Cloudflare Worker 统一部署。

# 2. 技术栈

- Vue 3、TypeScript、Vite：前端 SPA 与构建。
- Vue Router、Pinia：路由权限和登录会话状态。
- Element Plus、Lucide Vue：表单、弹窗、分页和图标。
- Hono、Zod：Cloudflare Worker API、路由和输入校验。
- Cloudflare Workers、D1、Wrangler：运行时、SQLite 数据库、迁移和部署。
- Cloudinary：管理员浏览器端无签名上传游戏封面。
- Playwright：Edge 桌面和手机视口端到端测试。

# 3. 核心目录

- `src/`：Vue 前端；`views/` 是页面，`components/` 是共享组件，`api/` 是请求层，`stores/` 是状态管理。
- `worker/src/`：Hono 后端、认证、管理员 API 和 Worker 类型。
- `worker/migrations/`：D1 数据库结构迁移；`worker/seeds/` 仅用于本地开发数据。
- `public/assets/`：品牌图、首页背景和付款码等静态资源。
- `tests/e2e/`：核心用户流程和响应式冒烟测试。

# 4. 核心文件

- `src/App.vue`：全站页面过渡；通过以 `route.path` 为键的单元素容器兼容多根节点页面，离场页面暂停交互，避免切换时叠高。
- `src/router/index.ts`：全部页面路由及登录/管理员守卫；公开页后台恢复会话，不等待会话接口；登录页和受保护页面仍等待身份确认；导出导航进度和失败提示状态。
- `src/api/client.ts`：前端所有 API 类型与调用入口；接口契约变化需同步修改。
- `src/stores/auth.ts`：会话恢复、登录、注册、退出及会员/管理员派生状态。
- `src/stores/theme.ts`：日间/夜间主题，默认跟随系统，手动选择以 `youlun-theme` 保存并同步其他标签页；`index.html` 的首屏脚本提前应用主题，避免夜间刷新闪白。
- `src/views/HomeView.vue`、`GamesView.vue`、`ProfileView.vue`：首页轮播、游戏分页筛选、个人中心与会员工单的主要实现。
- `src/views/GameDetailView.vue`：封面摘要、介绍、最低配置与下载卡片；封面不显示硬编码的平台标识；桌面下载区吸顶，手机按介绍、下载、配置排列；包含骨架屏、加载重试、封面回退和资源维护状态。
- `src/views/AdminView.vue`：完整管理后台；概览卡片可跳转到对应模块，游戏最低配置在界面中使用固定字段，保存时仍序列化为字符串数组；游戏、工单、反馈和用户列表支持搜索/删除。
- `src/styles.css`：基础样式、动画和响应式规则；`src/styles/theme.css`：夜间语义颜色、Element Plus 变量、导航提示及主题按钮的手机适配。
- `worker/src/index.ts`：公开 API、认证入口、反馈、会员工单、下载权限和全局中间件。
- `worker/src/admin.ts`：管理员专用 API；涉及后台 CRUD、审核或用户权限时优先查看。
- 后台用户列表与登录、下载鉴权共用 `serializeUser` 判断会员有效性：到期月度会员返回 `none`，保留原数据库会员记录和到期时间；保存用户后刷新列表，展示当前有效身份。
- `worker/src/auth.ts`：PBKDF2 密码哈希、HttpOnly Cookie、会话读取与会员有效期计算。
- `wrangler.toml`：生产 Worker、静态资源、D1 绑定、允许来源和日志配置。

# 5. 数据 / API

业务数据存于 Cloudflare D1。完整表结构在 `worker/migrations/0001_initial.sql`，登录限流表在 `0002_auth_attempts.sql`；主要表包括用户、会话、游戏、下载链接、分类、标签、反馈和会员工单。API 均位于 `/api`，由 `worker/src/index.ts` 和 `admin.ts` 提供；管理员列表接口使用 `q` 参数搜索，提供游戏、工单、反馈和用户删除接口。前端通过 `src/api/client.ts` 使用 Cookie 同域通信。公开游戏接口不会返回真实下载 URL，下载地址只能通过鉴权接口取得。

重要配置包括 Worker 的 `DB`、`ASSETS`、`APP_ENV`、`ALLOWED_ORIGIN`，以及前端可选的 `VITE_API_BASE_URL`、`VITE_SUPPORT_EMAIL`。不得在文档或代码中记录真实密钥。

# 6. 功能之间的关系

```mermaid
flowchart LR
  U[用户操作] --> V[Vue 页面/组件]
  V --> S[Pinia / API Client]
  S --> H[Hono Worker /api]
  H --> D[(Cloudflare D1)]
  V --> C[Cloudinary 封面上传]
  H --> A[认证与角色/会员校验]
```

公开页面在后台恢复会话，登录页及受保护页面等待会话确认（请求超时 8 秒，网络失败可重试）；Worker 从 Cookie 查询会话并把用户放入请求上下文。游戏列表经 API 分页（桌面 20、手机 8，后端上限 20）。首页、顶部搜索栏与游戏库共用公开游戏列表接口，`q` 只匹配游戏名称，不搜索游戏介绍，并可叠加分类与标签筛选。游戏库列表和筛选项请求支持取消及 15 秒超时，只接收当前请求结果；离开路由时立即清理搜索防抖和请求，导航失败时恢复加载。下载、反馈、工单要求登录，会员下载和 `/admin/*` 还会进行服务端权限校验。

# 7. 怎么运行

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev:api
npm run dev
```

API 默认是 `127.0.0.1:8787`，Vite 是 `127.0.0.1:5173`。检查与发布命令：

```bash
npm run typecheck
npm run typecheck:api
npm run test:e2e
npm run build
npm run db:migrate:remote
npm run deploy
```

# 8. 修改时注意什么

- 页面内容先改对应 `views/*.vue`；共享导航/卡片看 `components/`，全局和移动端表现看 `styles.css`。
- API 字段变化必须同步后端路由、`src/api/client.ts` 和使用该数据的页面；数据库变化必须新增迁移，不要直接改已执行的迁移。
- 不要把下载 URL 放入公开游戏响应，也不要只依赖前端判断会员或管理员权限。
- 认证使用 PBKDF2、哈希会话令牌和 HttpOnly Cookie；当前迭代次数兼顾 Worker CPU 限制，不要随意提高或改成不兼容算法。
- 首页背景会随机开始、预加载后线性缩放并交叉淡入；修改时要保持无灰屏并兼容 `prefers-reduced-motion`。
- 页面过渡为短暂淡入和轻微位移，兼容 `prefers-reduced-motion`；仅路径变化重建页面，筛选和个人中心标签变化保持滚动位置。详情页在挂载时按当前 slug 加载，依赖 `App.vue` 的路径键，不能直接改回只按路由名称复用。
- 管理后台最低配置固定字段最终仍保存为 `minConfig: string[]`，不要误改为新数据库对象结构。
- `wrangler.toml` 中 Worker 名称、D1 ID、资源绑定、生产来源和 SPA 静态资源策略相互关联，不要随意替换。生产库不要重复执行开发 seed。
- 修改后至少运行类型检查和构建；按用户最新偏好，非重要样式和交互修改无需默认运行端到端测试，由用户手动体验；重要业务或权限变更再选择必要测试。

# 9. 后续优化方向（2026-10-04 代码检查）

- 已处理游戏库旧响应覆盖、延迟搜索打断导航和会话恢复阻塞公开页面的问题；会话网络失败不再标记为初始化成功，过时恢复结果不会覆盖后续登录/退出状态。
- `src/main.ts` 全量导入 Element Plus CSS；本次构建入口样式约 403 kB（gzip 约 57 kB）。可评估按组件加载样式，并拆分全局文件中的页面专属样式。
- 当前 `tests/e2e/` 共 16 个测试实例，覆盖基本业务流程、仅按名称搜索与组合筛选、路由过渡、筛选位置、详情异常状态、减少动态效果及后台会员到期和分类标签操作；后台测试以隔离数据执行真实用户列表处理函数，不改开发库中的管理员身份。完整鉴权矩阵与慢网络返回位置仍可补充验证。

# AI 快速上手

这是一个 Vue 3 + TypeScript 前端、Hono + Cloudflare Workers 后端、D1 数据库组成的 PC 游戏资源网站，前端静态资源和 `/api` 由同一 Worker 托管。页面在 `src/views/`，请求统一在 `src/api/client.ts`，登录状态在 `src/stores/auth.ts`，路由权限在 `src/router/index.ts`；公开及用户 API 看 `worker/src/index.ts`，后台 API 看 `worker/src/admin.ts`，认证看 `worker/src/auth.ts`，数据库结构看 `worker/migrations/`。本地先迁移并 seed D1，再分别运行 `npm run dev:api` 和 `npm run dev`。修改接口要同步前后端类型，修改布局要检查 `src/styles.css` 的手机媒体查询，并始终保留服务端下载、会员和管理员权限校验。
