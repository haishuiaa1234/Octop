# 第三方网站集成验证记录

日期：2026-09-18。环境：Windows、Python 3.12.13；基于 `ae65fe4e26854d2eaf751cee89341ec5d71569f0`，工作分支 `main_gys`。

## 已通过

| 检查 | 结果 |
| --- | --- |
| `uv run --no-sync pytest tests/unit/api/test_websites.py tests/integration/test_websites.py tests/unit/i18n -q` | 79 passed |
| `vitest run src/pages/Websites/websites.test.tsx src/routes/controlAdminPath.test.ts src/pages/Chat/components/TrajectoryInspector.test.tsx --maxWorkers=2` | 25 passed |
| `uv run --no-sync ruff check src tests` | 通过 |
| `uv run --no-sync ruff format --check src tests` | 993 files already formatted |
| `uv run --no-sync mypy --strict src/octop` | 493 source files，无错误 |
| `npx tsc --noEmit` 及 `tsc -b` | 通过 |
| 变更前端文件的 ESLint / Prettier | 通过 |
| `npm run build:prod` | 成功，输出到 `src/octop/dashboard/`；存在原有大体积 chunk 提示 |
| `git diff --check` | 通过 |

在独立临时数据目录启动完整 Octop 服务，实际 HTTP 验证了未登录 401、普通用户可用目录和详情、管理接口 403、Scalar 文档及 OpenAPI 网站路径。该临时服务已关闭，没有修改或部署到 `172.16.18.93:8088`。

专项测试覆盖 CRUD、启停、排序、指定用户授权、隐藏授权名单、管理权限、用户详情不可绕过、非法协议/凭据/畸形网址、同源目标拒绝、独立打开模式、撤权后移除 iframe，以及文档响应类型。

## 全量检查的限制

本机没有 `make`，因此逐项执行了对应检查，未执行 `make all` 本身。

后端命令 `uv run --no-sync pytest -m "not live" -n 4 --maxfail=5 -q`：**1698 passed、50 skipped、5 failed**，达到失败阈值后终止，并非所有测试都已执行。五项失败都是现有测试用默认 GBK 解码 UTF-8 `001_initial.sql`：

- `test_system_archive.py::test_restore_repairs_old_physical_schema_with_current_watermark`
- `test_agent_profile_columns.py::test_migration_007_backfills_profile_columns`
- `test_agent_profile_columns.py::test_legacy_zh_en_welcome_collapses_to_single_column`
- `test_clip_thread_title.py::test_migration_003_repairs_stored_hard_cuts`
- `test_db_pool.py::test_repair_legacy_schema_ensures_columns`

上述五项均已在 HEAD 原始代码快照、默认 Windows 环境中复现，排除本次变更导致。随后在当前代码的单次 PowerShell 测试进程设置 `$env:PYTHONUTF8='1'`，仅复跑上述五项：**5 passed**。没有为解决该环境问题修改上游文件，也未重新运行完整后端套件。

前端全量：**161 文件通过、5 文件失败；852 用例通过、2 用例失败，另有 1 个未处理错误**。在 HEAD 原始快照、相同依赖下复现了以下既有问题：

- `DocumentPreviewCore.docxSanitize`、`skillMarkdown`、`SkillDrawer` 三个套件缺少 `DOMMatrix`。
- `publishedExperts` 发布生命周期请求断言不一致。

`TrajectoryInspector` 的预览文本断言在全量时失败，在原始 HEAD 与当前代码的独立复跑均通过，因此该项只能记为全量运行时未稳定复现，不能断言已修复或已确认属于基线。

## 部署后仍需验证

浏览器自动化访问本地隔离服务时，Chrome 和内置浏览器均返回 `net::ERR_BLOCKED_BY_CLIENT`，所以未完成真实浏览器视觉验收。组件测试和 HTTP 检查不能替代真实第三方 Cookie、登录跳转和表单操作验证。

部署后按 [使用与上游同步说明](external-websites.md) 添加“项目进度”，在实际普通用户账号下检查菜单、嵌入、登录及操作。原站禁止嵌入或跨站 Cookie 不兼容时使用「新标签页打开」。代码未提交、未推送，未调整现有生产服务。
