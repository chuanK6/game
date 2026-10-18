# 1. 项目是什么

项目名为“游浪游戏资源发布网站”（包名 `youlun-game-resource`），是面向 PC 游戏资源浏览与下载的响应式网站。用户可以搜索、分类/标签筛选游戏，注册登录后获取免费资源，会员可访问会员资源；还支持会员付款工单、问题反馈、密码修改和历史记录。管理员后台可维护游戏、下载链接、分类标签、用户权限、会员工单和反馈。当前前后端、D1 数据库、权限校验及桌面/手机版均已实现，采用单个 Cloudflare Worker 统一部署。

# 2. 技术栈

- Vue 3、TypeScript、Vite：前端 SPA 与构建。
- Vue Router、Pinia：路由权限和登录会话状态。
- Element Plus、Lucide Vue：表单、弹窗、分页和图标。
- Hono、Zod：Cloudflare Worker API、路由和输入校验。
- Cloudflare Workers、D1、Wrangler：运行时、SQLite 数据库、迁移和部署。
- Cloudflare R2：管理员通过 Worker 上传封面和正文图片，旧 Cloudinary 图片地址继续兼容；`markdown-it` + DOMPurify 渲染 Markdown 介绍。
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
- `src/views/HomeView.vue`、`GamesView.vue`、`ProfileView.vue`：首页轮播、游戏分页筛选、个人中心与会员工单的主要实现。游戏库采用顶部横向筛选（发布年份、免费/会员、分类、标签多选），已选条件支持单项移除；样式位于 `src/styles/catalog.css`。
- `src/utils/catalogQuery.ts`、`catalogCache.ts`、`catalogNavigation.ts`：公开游戏库查询归一化、六页/120 条以内的 30 秒 LRU 缓存、最多 12 个列表滚动位置和内容渲染完成信号。缓存键含全部条件及每页数量；成功后台写操作清缓存，刷新强制重新获取，过期/失败/取消请求不写缓存。
- `src/views/GameDetailView.vue`：封面摘要、介绍、最低配置与下载卡片；封面不显示硬编码的平台标识；桌面下载区吸顶，手机按介绍、下载、配置排列；包含骨架屏、加载重试、封面回退和资源维护状态。
- `src/views/AdminView.vue`：独立侧栏、顶栏和主题切换的管理后台；“回到网站”位于顶部栏最右侧。概览展示真实统计与待办，游戏列表使用分类/权限/发布状态下拉筛选；分类与标签通过顶部两个按钮切换，每次进入该模块默认显示分类，单次只渲染一张表。
- `src/components/AdminGameEditor.vue`：游戏编辑弹窗的四个页签（基础信息、游戏介绍、配置要求、标签与下载）；`src/utils/adminGameForm.ts` 负责旧数据载入、配置序列化、跨页签校验和提交载荷；`src/styles/admin.css` 为后台独立样式。
- `src/composables/useAdminGames.ts`：后台列表请求取消、15 秒超时和过期响应隔离；组件内 LRU 最多缓存 6 页/60 条，30 秒过期，写入/删除/手动刷新使缓存失效，离开后台时释放。
- `src/styles.css`：基础样式、动画和响应式规则；`src/styles/theme.css`：夜间语义颜色、Element Plus 变量、导航提示及主题按钮的手机适配。
- `worker/src/index.ts`：公开 API、认证入口、反馈、会员工单、下载权限和全局中间件。
- `worker/src/admin.ts`：管理员专用 API；涉及后台 CRUD、审核或用户权限时优先查看。
- `worker/src/media.ts`：管理员图片上传、文件大小/签名校验及公开图片读取；`MEDIA` 为 R2 绑定，线上图片域名使用 `MEDIA_PUBLIC_URL`，本地使用 `/api/media/`。
- `src/components/MarkdownEditor.vue`、`MarkdownContent.vue`：介绍编辑、共享预览/详情渲染、图片上传与放大；`src/utils/markdown.ts` 处理安全渲染和旧文本转换，`imageUpload.ts` 处理浏览器压缩与上传，`src/styles/markdown.css` 适配手机和深色主题。
- 后台用户列表与登录、下载鉴权共用 `serializeUser` 判断会员有效性：到期月度会员返回 `none`，保留原数据库会员记录和到期时间；保存用户后刷新列表，展示当前有效身份。
- `worker/src/auth.ts`：PBKDF2 密码哈希、HttpOnly Cookie、会话读取与会员有效期计算。
- `wrangler.toml`：生产 Worker、静态资源、D1 绑定、允许来源和日志配置。

# 5. 数据 / API

业务数据存于 Cloudflare D1。完整表结构在 `worker/migrations/0001_initial.sql`，登录限流表在 `0002_auth_attempts.sql`；主要表包括用户、会话、游戏、下载链接、分类、标签、反馈和会员工单。API 均位于 `/api`，由 `worker/src/index.ts` 和 `admin.ts` 提供；管理员列表接口使用 `q` 参数搜索，提供游戏、工单、反馈和用户删除接口。前端通过 `src/api/client.ts` 使用 Cookie 同域通信。公开游戏接口不会返回真实下载 URL，下载地址只能通过鉴权接口取得。

重要配置包括 Worker 的 `DB`、`ASSETS`、`MEDIA`、`MEDIA_PUBLIC_URL`、`APP_ENV`、`ALLOWED_ORIGIN`，以及前端可选的 `VITE_API_BASE_URL`、`VITE_SUPPORT_EMAIL`。R2 桶为 `youlang`，图片域名为 `https://cdn.youlang.cc.cd`，Worker 使用绑定访问，无需 S3 密钥。不得在文档或代码中记录真实密钥。

`0003_game_description_format.sql` 新增 `games.description_format`（`plain` / `markdown`）。历史数据默认 `plain`，新后台创建默认 `markdown`，旧客户端更新省略格式时保留原值；正文仍存 `description`，上限 30000 字符。游戏列表只返回卡片字段（`GameSummary`），详情才返回正文和最低配置（`Game`）。`POST /api/admin/uploads/images` 接收 `file` 与 `purpose`，返回 `key/url`，仅管理员可调用；限制单张 5 MB、JPG/PNG/WebP。公开图片路由在会话中间件之前挂载，避免图片请求访问 D1。

# 6. 功能之间的关系

```mermaid
flowchart LR
  U[用户操作] --> V[Vue 页面/组件]
  V --> S[Pinia / API Client]
  S --> H[Hono Worker /api]
  H --> D[(Cloudflare D1)]
  V --> M[Markdown 编辑与预览]
  H --> R[R2 封面与正文图片]
  H --> A[认证与角色/会员校验]
```

公开页面在后台恢复会话，登录页及受保护页面等待会话确认（请求超时 8 秒，网络失败可重试）；Worker 从 Cookie 查询会话并把用户放入请求上下文。游戏列表经 API 分页（桌面 20、手机 8，后端上限 20），越界页码自动回退至最后有效页。首页、顶部搜索栏与游戏库共用公开游戏列表接口，`q` 只匹配游戏名称，不搜索游戏介绍；支持叠加 `year`（当前发布日期的年份）、`resourceType`、分类及最多 20 个有效标签（交集匹配）。`/api/game-filters` 返回公开分类/标签和有已发布游戏的年份，不包含草稿年份。游戏库列表和筛选项请求支持取消及 15 秒超时，只接收当前请求结果；离开路由时清理搜索防抖和请求，导航失败时恢复加载。下载、反馈、工单要求登录，会员下载和 `/admin/*` 还会进行服务端权限校验。

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
- 游戏库翻页使用 `router.push`，筛选使用 `router.replace`；详情卡片通过 history state 保存完整来源路径，返回链接需拆分 path/query，恢复条件、页码和滚动。列表内容及筛选就绪后才恢复滚动，避免慢请求下页面高度不足；快速导航撤销旧滚动等待。手机/桌面切换每页数量时回第一页并使用独立缓存键。
- 管理后台最低配置固定字段最终仍保存为 `minConfig: string[]`，不要误改为新数据库对象结构。
- 后台游戏编辑页签使用 `v-show` 保持输入和上传状态；提交时切换至第一个错误所在页签并聚焦字段。空白下载行不入库，填写部分内容时要求补全；标签最多 20 个，下载来源最多 20 行。封面支持拖拽和地址输入，保持已有 Cloudinary/R2 地址兼容。
- 后台 `/api/admin/games` 支持 `q`、`categoryId`、`resourceType`、`status`、`page` 的组合筛选；计数和列表必须共用条件，固定每页 10 条，越界页码回退至最后有效页，前端采用服务器返回的页码。筛选变更回第一页，禁止无限积累分页缓存。
- Markdown 关闭原始 HTML，并清理生成结果；预览和详情使用同一组件。旧纯文本不得未经转换直接按 Markdown 解释；转换与图片上传结果随保存游戏生效。上传进行中禁用保存，关闭编辑器取消上传。正文是公开内容，不能承载需要鉴权的下载地址。
- R2 图片使用随机对象 key 和长期缓存，旧图地址保留；暂不自动删除未引用图片，清理前检查封面、正文和草稿引用。生产发布新代码前须执行 `0003` 迁移；本地 R2 数据不会上传到线上。
- `wrangler.toml` 中 Worker 名称、D1 ID、资源绑定、生产来源和 SPA 静态资源策略相互关联，不要随意替换。生产库不要重复执行开发 seed。
- 修改后至少运行类型检查和构建；按用户最新偏好，非重要样式和交互修改无需默认运行端到端测试，由用户手动体验；重要业务或权限变更再选择必要测试。

# 9. 后续优化方向（2026-10-04 代码检查）

- 已处理游戏库旧响应覆盖、延迟搜索打断导航和会话恢复阻塞公开页面的问题；会话网络失败不再标记为初始化成功，过时恢复结果不会覆盖后续登录/退出状态。
- `src/main.ts` 全量导入 Element Plus CSS；本次构建入口样式约 403 kB（gzip 约 57 kB）。可评估按组件加载样式，并拆分全局文件中的页面专属样式。
- 当前 `tests/e2e/` 共 16 个测试实例，覆盖基本业务流程、仅按名称搜索与组合筛选、路由过渡、筛选位置、详情异常状态、减少动态效果及后台会员到期和分类标签操作；后台测试以隔离数据执行真实用户列表处理函数，不改开发库中的管理员身份。完整鉴权矩阵与慢网络返回位置仍可补充验证。

# AI 快速上手

2026-10-18 游戏介绍的 Markdown 编辑器扩展标题级别、斜体、删除线、有序列表、行内代码、代码块、表格、分隔线、撤销/重做与 Ctrl/⌘ 快捷键；标题、列表和引用支持多行选区。编辑与预览区使用固定高度并各自滚动，工具栏及模式栏吸顶；全屏保留原布局占位。格式插入与图片上传采用 `focus({ preventScroll: true })` 并恢复滚动位置，避免工具点击导致页面跳动；编辑历史最多 60 项，关闭编辑器继续取消上传。修改位于 `MarkdownEditor.vue`、`markdown.css` 和 `admin.css`，按用户要求仅执行构建，交互由用户手动测试。

2026-10-18 游戏新建/编辑表单进一步调整视觉层级：基础信息按游戏信息、封面、资源与发布分组，四页签统一使用有边框和轻阴影的卡片；字段标签为 600 字重，输入框使用白底、深色文字和清晰边框，聚焦带主色光圈，夜间主题也保留白色输入区域。前三步突出“下一步”，最后一步突出“保存游戏”，取消为文字按钮；移动端使用单列布局。改动位于 `AdminGameEditor.vue` 和 `admin.css`，上传、跨页签校验和提交接口保持现有逻辑。按用户要求仅运行 `npm run build`（含前后端类型检查），构建通过，界面与交互由用户手动测试。

2026-10-18 前端游戏库筛选改至顶部，新增发布日期年份和资源权限组合筛选；公开分页增加有界缓存、越界回退、详情来源恢复、慢加载后滚动恢复、快速请求取消。卡片支持坏图占位与日期截短，首页去掉自动聚焦以减少手机键盘弹出，首页/详情加请求超时与取消。详情下载结果在身份变化时清除。本次使用现有数据库字段，不需新增迁移；`tests/e2e/catalog.spec.ts` 使用内存库覆盖组合筛选、缓存淘汰/过期、返回恢复、响应式分页与异常情况，目前共 48 项桌面/手机测试。

2026-10-18 已按参考页重做现代简约管理后台及四页签游戏编辑器。`App.vue` 在 `/admin` 使用后台自身导航；游戏分类、权限、发布状态采用服务端组合筛选，分页有缓存上限和请求竞态保护。校验定位仅滚动表单内部，保留页签和底部操作可见。新增组合筛选/越界分页、跨页签校验、缓存淘汰与过期响应测试，当前共 36 项桌面/手机测试。本次不涉及新数据库字段；配置页当前编辑最低配置，后续可按配置分组扩展推荐配置。

2026-10-17 已接入 R2 与 Markdown 介绍。新增 `tests/e2e/markdown.spec.ts`，覆盖上传权限、实际文件大小与签名、公开读取缓存、迁移兼容、旧文本转换、新游戏封面/粘贴/拖拽/重试、关闭表单取消上传、安全渲染与手机布局；测试总数为 30 个（桌面/手机各 15）。生产发布前执行 `npm run db:migrate:remote`，再部署 Worker。

这是一个 Vue 3 + TypeScript 前端、Hono + Cloudflare Workers 后端、D1 数据库组成的 PC 游戏资源网站，前端静态资源和 `/api` 由同一 Worker 托管。页面在 `src/views/`，请求统一在 `src/api/client.ts`，登录状态在 `src/stores/auth.ts`，路由权限在 `src/router/index.ts`；公开及用户 API 看 `worker/src/index.ts`，后台 API 看 `worker/src/admin.ts`，认证看 `worker/src/auth.ts`，数据库结构看 `worker/migrations/`。本地先迁移并 seed D1，再分别运行 `npm run dev:api` 和 `npm run dev`。修改接口要同步前后端类型，修改布局要检查 `src/styles.css` 的手机媒体查询，并始终保留服务端下载、会员和管理员权限校验。
