# 第三方网站集成（fork 定制）

本功能管理已经部署的网站入口，不托管网站、不代理其请求，也不提供第三方单点登录。

## 使用

1. 部署本 fork 的后端并构建前端，重启 Octop。
2. 管理员进入左侧「业务网站 → 网站管理」（`/admin/websites`）。极简布局中该分组位于「设置」面板。
3. 点击「新增网站」，填写下列首个网站配置。实际地址只保存在数据库配置中，不硬编码在程序里。

| 字段 | 示例 |
| --- | --- |
| 网站名称 | 项目进度 |
| 网站地址 | `http://172.16.18.6:5184/` |
| 打开方式 | 系统内嵌入 |
| 访问范围 | 所有登录用户，或选择指定用户 |
| 排序 | 0（数字较小的在前） |
| 启用 | 开启 |

4. 普通用户登录后，可点击「业务网站 → 项目进度」。新标签页模式显示独立打开按钮，需用户点击，避免浏览器拦截异步弹窗。

保存后当前页面立即刷新菜单；其他已打开的 Octop 页面会在重新聚焦或约 30 秒内重新获取权限。浏览器后台标签页节流可能使间隔延长。停用、删除、撤权后，后端详情立即拒绝访问，已打开的嵌入页在下次检查时移除。

## 权限与兼容性

- 管理入口和所有管理 API 仅管理员可访问，不能通过普通模块权限授予。
- 用户入口只返回已启用且被授权的网站；管理员可访问所有已启用的网站。停用网站仍能在管理页编辑。
- 未授权、已停用和不存在的用户详情统一返回 404，避免泄露目录信息；用户响应不包含授权名单。
- 网站权限只约束 Octop 入口，无法撤销第三方会话，也不能阻止直接访问原始网址。第三方应自行实施认证和操作权限。
- iframe 保留脚本、表单、下载及弹窗能力，禁止顶层页面跳转；不会拼接 Octop Token，独立打开使用 `noopener noreferrer`。
- **第三方网站必须与 Octop 使用不同 origin（协议、主机、端口组合）**。配置页面和查看页面拒绝同源目标，避免共享 Octop 的浏览器存储。第三方也不应通过重定向或反向代理与 Octop 共用 origin。
- HTTP Octop 可以嵌入 HTTP 网站；HTTPS Octop 不嵌入 HTTP 网站，页面会提示独立打开。
- 第三方的 `X-Frame-Options` / CSP、浏览器跨站 Cookie 规则、第三方登录跳转可能使内嵌失败。使用「新标签页打开」，或由第三方调整其部署；不要关闭浏览器安全限制。
- 示例网站与 Octop 是跨站 HTTP 地址，其会话 Cookie 是否能在 iframe 内工作必须在部署浏览器中验证。首页可展示不代表所有表单操作和登录已验证。

## 后端接口

| 方法与路径 | 权限与用途 |
| --- | --- |
| `GET /api/websites` | 当前用户可用目录 |
| `GET /api/websites/{website_id}` | 再次校验权限后返回入口 |
| `GET /api/admin/websites` | 管理员查看全部配置 |
| `GET /api/admin/websites/users` | 管理员获取授权用户选项 |
| `POST /api/admin/websites` | 创建 |
| `PUT /api/admin/websites/{website_id}` | 完整替换配置 |
| `DELETE /api/admin/websites/{website_id}` | 删除入口，不影响原网站 |

创建请求示例（应通过正常管理员登录后调用）：

```json
{
  "name": "项目进度",
  "url": "http://172.16.18.6:5184/",
  "open_mode": "embed",
  "sort_order": 0,
  "enabled": true,
  "visibility": "all",
  "user_ids": []
}
```

`visibility=selected` 时，`user_ids` 至少包含一个现有用户 ID。配置使用独立的 `custom.websites.v1.<uuid>` settings 项，兼容 SQLite 和 PostgreSQL 的现有适配层，不修改 `_schema_version` 或上游 SQL 迁移。每项保存不会覆盖其他网站；同一网站同时编辑采用最后一次成功保存的内容。CRUD 写入现有审计日志。正常数据库备份包含这些配置。

## 持续同步上游

本功能使用现有依赖，没有新增依赖、修改锁文件、修改上游表结构或接管启动流程。核心实现集中在：

- `src/octop/infra/websites/`：模型、业务规则、访问控制。
- `src/octop/infra/db/repos/websites.py`：namespaced settings 读写。
- `src/octop/api/routers/websites.py`：HTTP 适配。
- `dashboard/src/pages/Websites/`：管理、展示、菜单、校验和独立文案。
- `dashboard/src/api/modules/websites.ts`：类型化请求。

合并上游冲突时，需要保留并根据上游新接口调整以下小接入点，而不是用整个旧文件覆盖上游：

| 接入文件 | 需保留的内容 |
| --- | --- |
| `infra/db/services.py` | `website_repo` 属性及导入 |
| `api/app.py` | 网站 router 注册 |
| `api/openapi_meta.py` | websites 文档标签 |
| `i18n/en.json`、`i18n/zh.json` | websites 校验文案 |
| `dashboard/src/routes/index.tsx` | 两个页面路由、选中项和全屏路径 |
| `dashboard/src/layouts/Sidebar.tsx` | 动态目录 hook、网站分组、literal label |
| `dashboard/src/layouts/sidebarNav.tsx` | 可选 literal label 类型 |
| `dashboard/src/layouts/SidebarCollapsedIconNav.tsx` | 折叠菜单 literal label |
| `dashboard/src/i18n.ts` | 合并独立 websites 语言资源 |

建议为定制功能保留独立提交，定期在合并分支合入上游，再通过检查后发布。不要从上游安装包自动更新覆盖本 fork 的构建产物；上游更新应先合并到本 fork 再构建部署。不需要冻结上游版本。

同步后至少检查：

```text
uv run pytest tests/unit/api/test_websites.py tests/unit/i18n -q
cd dashboard
npx vitest run src/pages/Websites/websites.test.tsx src/routes/controlAdminPath.test.ts
npx tsc --noEmit
npm run build:prod
```

发布仍遵循项目完整检查 `make all`。Windows 没有 make 时分别执行 Ruff check/format check、mypy、pytest，以及前端检查。浏览器回归应覆盖管理员增删改、普通用户授权/未授权、启停、折叠菜单、极简布局、手机布局及真实第三方登录/表单操作。
