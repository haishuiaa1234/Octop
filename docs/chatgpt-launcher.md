# 从 Octop 打开本机 ChatGPT

侧边栏“打开 ChatGPT”使用 `octop-chatgpt://open` 唤起当前浏览器所在电脑上的客户端，保留 Octop 当前页面。展开、折叠、精简和移动端菜单使用同一启动处理。弹窗提供重试和网页版入口，不将浏览器失焦或等待超时当作启动成功。

## Windows 安装

先安装官方 ChatGPT 客户端，然后在**运行浏览器的电脑**执行仓库中的脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-chatgpt-launcher.ps1
```

脚本从开始菜单识别唯一的官方 ChatGPT 应用，只写入当前用户的 `HKCU\Software\Classes\octop-chatgpt`，不需要管理员权限。启动命令使用 Windows AppsFolder 应用 ID，不依赖随升级变化的安装目录。重复安装相同目标是幂等的；遇到不同的已有协议命令时停止，不覆盖。

协议只启动固定客户端，不转发 URI 参数，不接受任意命令，也不在 Octop 服务器执行程序。每台电脑、每个 Windows 用户需要分别安装；非 Windows 系统本次使用网页版。

点击菜单后，在浏览器的外部应用提示中允许打开。若未弹出，检查协议是否安装、浏览器是否禁止外部应用，并点击“再次打开客户端”。Octop 无法检测客户端是否已经安装或成功启动。

本次检测到的客户端显示名为 ChatGPT，应用 ID 为 `OpenAI.Codex_2p2nqsd0c76g0!App`。启动后由客户端恢复自己的窗口和登录状态；本功能不会切换 Chat/Work/Codex 页面，不自动输入问题或读取回答。

## 移除启动入口

只删除此功能的当前用户协议键（不卸载 ChatGPT）：

```powershell
Remove-Item -LiteralPath 'HKCU:\Software\Classes\octop-chatgpt' -Recurse
```

## 验证

- 前端：`npx vitest run src/layouts/openChatGPT.test.tsx src/layouts/sidebarNav.test.ts`、`npx tsc --noEmit`，并执行生产构建。
- 本机：安装脚本校验注册命令后，可运行 `Start-Process 'octop-chatgpt://open'` 检查 Windows 协议解析；最后从浏览器点击菜单，确认外部应用提示和客户端窗口。

### 本次验证结果（2026-09-20）

- 启动行为与侧边栏定向测试：4 passed；后端 i18n 测试：66 passed。
- `tsc --noEmit`、`tsc -b`、本次涉及文件的 ESLint 和新增/变更文件的 Prettier 检查通过。
- Windows 下设置 `NODE_ENV=production` 后执行 `npx vite build` 成功，产物更新到 `src/octop/dashboard/`；存在 chunk 体积及混合静态/动态导入警告。
- 安装脚本连续执行两次成功，注册值核对一致；Windows 接受协议启动请求。客户端原本已运行，不能仅凭进程存在认定窗口已经切到前台。
- Chrome 临时验证页调用正式启动函数及中文文案：点击后页面 URL 保持不变，帮助弹窗、重试按钮、网页版链接显示正常，已做截图视觉检查。原生外部应用确认框和客户端前台状态未完成自动化验证。
- 当前环境缺少 `make`，`make all` 未能执行；未声称全量检查通过。
- 临时验证页已移除；没有提交、推送或部署到远程 Octop 服务。
