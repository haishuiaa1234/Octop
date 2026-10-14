# 第三方应用免重复登录接入指南

本方案让用户完成企业微信或任意现有 Octop 登录后，打开独立应用时无需再次输入账号密码。Octop 只确认身份；应用建立自己的会话，管理自己的角色、权限和数据范围。

**这是 Octop 定制的授权码协议，不是 OAuth/OIDC Provider，不兼容通用 OIDC 客户端。** 它不提供 Octop API Token、统一退出或已建立应用会话的实时撤销。普通网站保持 `auth_mode=none`，只有明确配置的应用使用 `auth_mode=octop`。

## 1. 部署与配置

推荐部署成同站、不同 origin 的 HTTPS 子域，例如：

| 项目 | 示例 |
| --- | --- |
| Octop 浏览器地址 | `https://octop.corp.example` |
| 应用浏览器地址 | `https://reports.corp.example` |
| 应用回调 | `https://reports.corp.example/auth/octop/callback` |
| 应用后端访问 Octop 的地址 | `https://octop.corp.example`，或可信的内部 HTTPS 地址 |

origin 是协议、主机和有效端口的组合。两个应用不能通过反向代理、重定向或相同路径共享 origin，否则会共享浏览器存储安全边界。应用入口与回调必须同 origin。生产使用 HTTPS；默认仅 `localhost`、`127.0.0.1`、`[::1]` 等 loopback 开发地址允许 HTTP。受控内网临时测试可使用下述精确来源白名单，不能把内网 IP 的 HTTP 当生产例外。

### 临时内网 HTTP 测试

工作台服务器的 `config.json` 显式加入应用来源，重启工作台生效：

```json
{ "website_sso_http_origins": ["http://172.16.18.6:8089"] }
```

只合并该字段，不覆盖已有配置。也可用 `OCTOP_WEBSITE_SSO_HTTP_ORIGINS` 设置逗号分隔的来源列表，它优先于文件配置。列表默认空，不支持通配符；协议、主机、有效端口精确匹配。移除后重启会禁止继续签发和兑换该来源的授权码，但不会撤销应用已有会话。

独立 Demo 配置：

```text
OCTOP_BASE_URL=http://127.0.0.1:8088
OCTOP_ORIGIN=http://172.16.18.6:8088
DEMO_BASE_URL=http://172.16.18.6:8089
DEMO_SSO_HTTP_ORIGINS=http://172.16.18.6:8088,http://172.16.18.6:8089
```

其余网站 ID、应用密钥和会话密钥仍按下文配置。登记的应用回调为 `http://172.16.18.6:8089/auth/octop/callback`。Demo 的 HTTP 浏览器地址必须使用相同主机和不同端口；不同域名或混用 HTTP/HTTPS 无法依靠 HTTP `SameSite=Lax` Cookie 保证 iframe 会话。应用后端的 loopback 调用地址不受此浏览器同站要求影响。

HTTP 会明文传输凭据、授权码和 Cookie。只在受控内网使用虚构测试数据；正式接入应恢复 HTTPS、同步入口/回调/来源配置并清空 HTTP 白名单。白名单不替代网站访问授权、密钥或 PKCE 校验。

### 管理员配置

1. 用管理员账号进入「业务网站 → 网站管理」，创建或编辑网站。
2. 设置应用入口、嵌入或新标签页打开方式、启用状态和可访问用户；认证模式选 Octop，填入完整回调 URL。
3. 保存配置，取得 `website_id`。该 ID 同时是应用的客户端标识。
4. 生成应用密钥。明文 `client_secret` 只在这次生成响应中出现，把它存入应用后端的秘密管理系统，不放入前端、代码仓库、页面参数或 Octop 导出的配置。
5. 部署应用后端，配置密钥和应用会话密钥，再用被授权的 Octop 用户打开入口验证。

网站创建接口是 `POST /api/admin/websites`；修改是 `PUT /api/admin/websites/{website_id}`，修改会完整替换配置，请保留访问范围等字段。两者都需要正常 Octop 管理员 Bearer 登录。配置示例：

```json
{
  "name": "企业报表",
  "url": "https://reports.corp.example/",
  "open_mode": "embed",
  "auth_mode": "octop",
  "sso_callback_url": "https://reports.corp.example/auth/octop/callback",
  "sort_order": 0,
  "enabled": true,
  "visibility": "all",
  "user_ids": []
}
```

`open_mode` 可用 `embed` 或 `new_tab`。`visibility=selected` 时，`user_ids` 至少包含一个存在的 Octop 用户 ID。网站入口授权不是应用业务权限，管理员的入口访问资格也不会转成应用管理员角色。

### 密钥生成与轮换

```http
POST /api/admin/websites/{website_id}/sso-secret
Authorization: Bearer <Octop-admin-token>
```

本次响应：

```json
{ "client_secret": "<new-high-entropy-secret>" }
```

每次调用都会生成新密钥，不是读取原密钥。Octop 保存密钥散列；普通用户响应、网站列表和导出配置不返回明文密钥。轮换会立即使旧密钥及此前尚未兑换的授权码失效，因此要安排应用后端同步替换秘密，期间可能需要用户重新点击登录。轮换不会结束应用已有会话；泄露处置还需应用端撤销自身会话。

## 2. 运行独立 Demo

源代码位于 `examples/app_sso_demo/`，无需启动 Octop 的内部 Python 服务来运行应用。它使用 FastAPI、httpx、Starlette `SessionMiddleware`；`itsdangerous` 是 Demo 的独立依赖，不修改 Octop 主项目依赖。

### 本机联调

在 Octop 已运行且用户能正常登录的前提下，管理员添加：

- 应用入口：`http://127.0.0.1:5187/`。
- 认证模式：`octop`。
- 回调：`http://127.0.0.1:5187/auth/octop/callback`。
- 生成应用密钥并记录网站 ID。

下面假设 Octop 浏览器地址为 `http://127.0.0.1:8000`，请按实际地址改。不要混用 `localhost` 与 `127.0.0.1`，也不要把 Vite 端口当成后端端口：`OCTOP_ORIGIN` 必须是当前 Octop **浏览器页面**的 origin，`OCTOP_BASE_URL` 则是应用后端可调用的 API 地址。二者在开发代理或生产反向代理下可以不同。

PowerShell，在仓库根目录执行：

```powershell
$env:OCTOP_BASE_URL = 'http://127.0.0.1:8000'
$env:OCTOP_ORIGIN = 'http://127.0.0.1:8000'
$env:OCTOP_WEBSITE_ID = '<保存后返回的 website_id>'
$env:OCTOP_CLIENT_SECRET = '<本次生成的 client_secret>'
$env:DEMO_BASE_URL = 'http://127.0.0.1:5187'
$env:DEMO_SESSION_SECRET = (uv run python -c 'import secrets; print(secrets.token_urlsafe(48))')
uv run --with itsdangerous uvicorn examples.app_sso_demo.app:create_app --factory --host 127.0.0.1 --port 5187 --no-access-log
```

Linux/macOS 的等价配置：

```bash
export OCTOP_BASE_URL='http://127.0.0.1:8000'
export OCTOP_ORIGIN='http://127.0.0.1:8000'
export OCTOP_WEBSITE_ID='<保存后返回的 website_id>'
export OCTOP_CLIENT_SECRET='<本次生成的 client_secret>'
export DEMO_BASE_URL='http://127.0.0.1:5187'
export DEMO_SESSION_SECRET="$(uv run python -c 'import secrets; print(secrets.token_urlsafe(48))')"
uv run --with itsdangerous uvicorn examples.app_sso_demo.app:create_app --factory --host 127.0.0.1 --port 5187 --no-access-log
```

不要把真实密钥写进共享脚本或提交到仓库。正式部署应由秘密管理系统注入；`DEMO_SESSION_SECRET` 至少 32 个随机字符，不应每次应用重启随机改变。示例缺少上述任一配置时会拒绝启动。回调 URL 从 `DEMO_BASE_URL` 固定派生为 `/auth/octop/callback`，须与登记字符串精确一致。

应用可以完全独立安装运行：

```text
uv run --with-requirements examples/app_sso_demo/requirements.txt uvicorn examples.app_sso_demo.app:create_app --factory --host 127.0.0.1 --port 5187 --no-access-log
```

### 验证应用边界

1. 新浏览器会话直接请求 `http://127.0.0.1:5187/api/me`，得到 `401`，不能凭知道网址访问报表。
2. 在 Octop 中用有入口权限的账号打开「企业报表」。无需输入应用密码，页面显示该用户的名字和账号。
3. 在应用自己的浏览器上下文请求 `/api/me` 和 `/api/reports`，得到 `200`。`/api/reports/export` 返回 `403`，即使 Octop 用户是管理员也如此。
4. 点「退出应用」，`/api/me` 再次返回 `401`。应用不会因父页面继续发握手消息而立即自动重登；点击「使用 Octop 登录」才重新登录。
5. 把网站打开方式改成 `new_tab`，在 Octop 页面点击打开，重复验证。不要直接打开应用来期望产生 Octop 授权；首次登录要由 Octop 已登记入口建立握手。

Demo 将每个已认证账号赋予应用本地 `viewer` / `reports:read`，这是应用示例规则，不来自 Octop。应用 Cookie 只携带签名的不透明会话标识；state、PKCE verifier 和身份会话存于应用服务端。预登录记录最长 5 分钟，应用会话最长 8 小时。

**Demo 使用单进程内存存储，请以单 worker 启动。** 重启会结束 Demo 会话；多 worker 会使回调找不到其他进程中的 state。生产应用应使用已有共享会话存储/数据库，记录过期时间并原子消费预登录记录，支持服务端撤销。`SessionMiddleware` 的签名不等于加密，不能把 client secret 或 verifier 放进可解码的 Cookie 负载。

### 172.16.18.6 示例配置

此环境暂时使用同一内网 IP 的两个独立 HTTP origin 演示免重复登录，保留原来的 `8088` 服务，无需安装证书：

| 项目 | 地址或配置 |
| --- | --- |
| 工作台入口 | `http://172.16.18.6:8088` |
| 业务网站名称 | `SSO 免登录示例` |
| 应用入口 | `http://172.16.18.6:8089/` |
| 应用回调 | `http://172.16.18.6:8089/auth/octop/callback` |
| 应用后端调用地址 | `http://127.0.0.1:8088`，仅服务器本机 loopback |
| 打开方式 / 认证模式 | `embed` / `octop` |
| HTTP 反向代理 | 现有 systemd 用户服务 `octop-sso-https.service` 增加 `8089` 监听 |
| Demo 服务 | systemd 用户服务 `octop-sso-demo.service`，监听 `127.0.0.1:5187` |

原有 `8443` / `8444` HTTPS 监听保留，但当前 Demo 只接受登记的 HTTP 工作台 origin，请勿混用 HTTPS 工作台与 HTTP Demo。正式恢复 HTTPS 时同步网站 URL、回调、Demo 的 `OCTOP_ORIGIN` / `DEMO_BASE_URL` 并移除两侧 HTTP 白名单；客户端需信任内部 CA 或企业证书，不以关闭 TLS 验证替代证书信任。

登录 **8088 的工作台入口**，然后打开「业务网站 → SSO 免登录示例」。Demo 显示同一账号，并建立自己的应用会话；新标签页打开、应用内退出和重新登录也使用相同的票据交换。直接打开应用而没有已登记的工作台父窗口或 opener 时，不会凭网址自动获得身份。

密钥文件为服务器上的 `~/.octop/website-sso-demo/demo.env`，仅服务用户可读，不进入代码仓库。Demo 只包含虚构的报表示例，并为已认证用户赋予应用本地 `viewer` 权限，不自动赋予工作台管理员业务权限。真实企业微信扫码仍需企业后台配置正确的工作台回调地址；模拟身份测试不能替代该企业配置验证。

## 3. 精确协议

### 应用准备预登录状态

应用后端生成至少 32 字节随机 `state` 和符合 PKCE 规则的随机 `code_verifier`（43～128 个 URL-safe 字符），绑定当前浏览器的应用预登录会话并记录创建时间。

```text
code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
```

Base64URL 不含末尾 `=`，只支持 S256。前端只获取 `state`、`code_challenge`、登记的回调和 Octop origin，不获得 verifier 或 client secret。待登录未过期时，多次初始化/hello 必须返回同一组 state/challenge，不可每次消息重新生成，否则先前 code 的绑定会失效。

### 双向浏览器握手

Octop 向已登记 iframe 或已跟踪的新窗口发送：

```json
{ "type": "octop.sso.hello" }
```

应用回复：

```json
{
  "type": "octop.sso.ready",
  "state": "<application-generated-state>",
  "code_challenge": "<S256-base64url-challenge>"
}
```

双方 `postMessage` 的第二个参数都必须是精确目标 origin，不能使用 `*`。

- 应用接收 hello 时，检查 `event.origin === OCTOP_ORIGIN` 和 `event.source`。iframe 只接受父窗口；新窗口绑定首次合法 hello 的发送窗口，之后只接受该窗口。
- iframe 可主动给自己的父窗口发送 ready。
- 新标签页由 Octop 在用户点击时同步打开空窗口、清除 `opener` 再导航。应用不能依赖 `window.opener`；应回复 hello 的 `event.source`。Octop 保留窗口引用并向它发送 hello。
- Octop 只接受当前网站的 iframe `contentWindow` 或该入口已跟踪的 popup，不能只看 origin 就信任任意窗口。
- 消息类型、state/challenge 格式、窗口来源和当前请求均须验证；切换网站、关闭窗口或组件卸载时取消握手和过期请求。

### 当前 Octop 用户申请授权码

这个接口由 **Octop 页面** 调用，使用该页面已有的登录，不由应用带用户 ID 调用：

```http
POST /api/websites/{website_id}/sso/code
Authorization: Bearer <current-Octop-user-token>
Content-Type: application/json
```

```json
{
  "state": "<application-generated-state>",
  "code_challenge": "<S256-base64url-challenge>"
}
```

响应：

```json
{
  "code": "<random-single-use-code>",
  "state": "<same-state>",
  "expires_in": 60,
  "callback_url": "https://reports.corp.example/auth/octop/callback"
}
```

用户身份只能来自 Octop 当前登录。Octop 检查用户活动状态、网站启用和入口授权、SSO 配置、回调与密钥初始化情况；授权码绑定应用、用户、state、challenge、回调和密钥版本，60 秒有效，只保存散列并只能消费一次。

Octop 将结果发给同一个已验证窗口：

```json
{
  "type": "octop.sso.code",
  "code": "<random-single-use-code>",
  "state": "<same-state>",
  "callback_url": "https://reports.corp.example/auth/octop/callback"
}
```

应用必须复核 **origin、绑定的 source、当前预登录 state、非空 code 和精确登记回调**。不能跟随消息中任意 URL。`callback_url` 不包含授权码；应用验证通过后用 URL API 添加 `code` 和 `state` 查询参数，再跳转到自身回调。

实现可直接参考 `examples/app_sso_demo/static/app.js`，其关键校验是：

```javascript
if (event.origin !== bootstrap.octop_origin) return;
if (event.source !== trustedSource) return;
if (!bootstrap.pending || event.data.state !== bootstrap.pending.state) return;
if (event.data.callback_url !== bootstrap.callback_url) return;
const callback = new URL(bootstrap.callback_url);
if (callback.origin !== window.location.origin) return;
callback.searchParams.set("code", event.data.code);
callback.searchParams.set("state", bootstrap.pending.state);
window.location.assign(callback.href);
```

这是代码消息分支的摘录，完整示例另检查消息类型、code 类型/长度、重复导航，并处理 hello。不要把摘录单独当成完整监听器。

### 应用后端兑换身份

回调从当前浏览器的应用会话读取待登录记录，恒定时间比较 state，检查创建时间并原子消费预登录记录；没有匹配的浏览器会话时必须拒绝。然后通过应用后端发送：

```http
POST /api/app-sso/exchange
Content-Type: application/json
```

```json
{
  "website_id": "<registered-website-id>",
  "client_secret": "<backend-only-client-secret>",
  "code": "<received-single-use-code>",
  "state": "<state-validated-against-current-browser-session>",
  "code_verifier": "<verifier-from-application-server-session>"
}
```

**不添加 Octop Bearer Token，不在前端 fetch 兑换，不向浏览器透露密钥或 verifier。** Octop 原子消费 code，验证凭据、应用绑定、PKCE、state、有效期、回调配置、密钥版本、用户活动状态及入口资格。

成功响应只有身份：

```json
{
  "user": {
    "id": 12,
    "username": "enterprise-user",
    "display_name": "张三",
    "locale": "zh"
  }
}
```

其中 `id` 是 Octop 用户整数 ID，`display_name` 可以为 `null`。没有角色、业务权限、密码、企业微信 token、签名密钥或 Octop JWT。校验 HTTP 状态和响应结构成功后，应用才建立新会话；超时、拒绝、重放或结构错误都不能退回匿名成功。

Demo 后端的实际调用方式如下，完整 state 校验、消费和错误分支见 `examples/app_sso_demo/app.py`：

```python
async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
    response = await client.post(
        settings.octop_base_url + "/api/app-sso/exchange",
        json={
            "website_id": settings.website_id,
            "client_secret": settings.client_secret,
            "code": code,
            "state": state,
            "code_verifier": pending.verifier,
        },
    )
    response.raise_for_status()
    identity = ExchangeResponse.model_validate(response.json()).user
# 此后生成新的应用 session ID，清除预登录数据，跳转不带 code 的业务地址。
```

## 4. 应用会话与本地账号

应用必须保护自己所有业务 API，不只是隐藏前端按钮。Demo 的 FastAPI 依赖边界：

```python
def require_session(request: Request) -> ApplicationSession:
    session = current_session(request)
    if session is None:
        raise HTTPException(401, "Application login required")
    return session

@app.get("/api/reports")
async def reports(session: ApplicationSession = Depends(require_session)):
    # 应用在这里根据自己的账号/角色/数据范围授权。
    return {"items": [...]}
```

账号关联使用 **稳定 Octop 实例标识 + `user.id`** 作为唯一键，不用可修改的用户名/显示名，也不能把不同 Octop 实例相同整数 ID 当作同一个人。Demo 使用已配置的 `OCTOP_ORIGIN + "|" + id`；企业应用可登记自己的不可变实例标识，域名变更时应明确迁移映射。

首次登录可按企业规则自动建档，但默认权限必须来自应用自己的策略；如果没有建档资格，应用可以拒绝登录。不把 Octop 管理员、入口授权名单或前端传入的角色用作应用管理员权限。身份属性更新、账号合并、离职数据转移由应用负责。

本版本的边界：

- Octop 账号停用、入口撤权或网站关闭会阻止新的授权/兑换，不会主动踢掉已有应用会话。
- Octop 登录过期或退出，不会同步结束应用会话。
- 应用「退出」只撤销该应用自己的会话，不能清除 Octop Cookie/Token。
- 需要统一退出或实时撤销时，应另外设计应用会话撤销机制；不要把这期免重复登录宣传成已经具备这些能力。

## 5. Cookie、嵌入与传输安全

| 位置 | 必须落实的措施 |
| --- | --- |
| 应用会话 Cookie | `HttpOnly`、生产 `Secure`、尽量 host-only、合理过期；登录更换 session ID，应用退出服务端撤销 |
| 跨站 iframe Cookie | 需要 `SameSite=None; Secure`，但浏览器/企业策略仍可能全面禁止第三方 Cookie |
| 同站不同 HTTPS 子域 | 推荐部署；`SameSite=Lax` 通常可支持同站请求，但仍要在目标浏览器验证，不设置共享父域 Cookie |
| 应用写操作 | Origin/CSRF 校验；SameSite 不是唯一 CSRF 防线，尤其使用 `None` 时 |
| 应用 CSP | 精确 `frame-ancestors https://octop.corp.example`，Demo 还包含 `'self'`；禁止任意站点嵌入 |
| X-Frame-Options | 嵌入场景不要设置会挡住 Octop 的 `DENY`/`SAMEORIGIN`；跨 origin 授权使用 CSP，不用废弃的 `ALLOW-FROM` |
| 回调 | state/预登录时间/PKCE 校验，精确回调白名单；不加载第三方脚本或分析追踪，成功立即去掉查询参数 |
| URL 与日志 | `Referrer-Policy: no-referrer`；反向代理、APM 与访问日志不得记录 code、state、Cookie、client secret、verifier |
| 应用访问 Octop | HTTPS 并验证证书，不关闭 TLS 校验；可信 loopback 开发例外不用于外网或跨机器 |
| iframe | 保留 Octop 的隔离策略，不关闭 sandbox，不给第三方读取 Octop localStorage/Token 的通道 |

Demo 的 HTTPS 配置使用 `SameSite=None; Secure` 以支持跨站嵌入；loopback 或显式白名单内的同主机 HTTP 使用 `Lax`。同一主机的不同端口是不同 origin、同站，可以进行本机或受控内网联调。Cookie 不按端口隔离，Demo 使用专用 Cookie 名以避免与 Octop 冲突。HTTP 使用 `octop_demo_http_session`，HTTPS 保留 `octop_demo_session`，避免浏览器已有的 Secure Cookie 阻止 HTTP 模式保存会话。

如果浏览器阻止第三方 Cookie，单纯设置 `SameSite=None` 不能强制解除限制。优先改同站不同 origin 的 HTTPS 部署；也可在 Octop 选择新标签页，应用在顶层上下文使用自己的 Cookie。不要让用户关闭全局浏览器安全策略。

## 6. 故障排查

先看浏览器的握手/请求，再看应用回调与后端兑换响应；排错日志只记录错误类别和请求关联 ID，不记录凭据。

| 现象 | 优先检查 |
| --- | --- |
| 应用无法启动 | 六个环境变量是否齐全；会话密钥是否足够长；`itsdangerous` 是否装入独立运行环境；HTTP 是否为 loopback |
| 一直未登录，无授权码请求 | `OCTOP_ORIGIN` 是否和浏览器页面精确一致；iframe source 是否为父窗口；是否从 Octop 登记入口打开 |
| 新标签页未登录 | 是否由用户点击打开；hello 回复到 `event.source` 而不是已清除的 opener；应用是否错误地依赖 opener |
| 签发拒绝/入口 404 | 用户是否已登录且活动、网站启用、当前用户被授权、auth_mode 正确，应用密钥是否初始化 |
| callback_url 被忽略 | 登记值、Demo 派生值和消息值是否完全一致；不要手改消息中的回调或允许任意重定向 |
| 回调 400，state 不存在/不匹配 | 应用 Cookie 是否被阻止、跨浏览器回调、hostname 混用、重复创建 pending、Demo 多 worker/重启、预登录是否超过 5 分钟 |
| 兑换拒绝 | code 是否超过 60 秒或已消费；网站 ID、最新 secret、state、S256 verifier 是否正确；用户资格/配置是否变化 |
| Demo 回调 502 | 应用后端是否可达 `OCTOP_BASE_URL`；TLS/代理是否正确；Octop 兑换是否拒绝或返回不符合结构；失败后需显式重新登录 |
| iframe 登录后仍 401 | Cookie 的 Secure/SameSite/Domain/Path、浏览器第三方 Cookie 政策；用新标签页对比，检查是否确实保存了应用会话 |
| 报表导出 403 | Demo 的应用本地 viewer 不具有导出权限，这是正确授权结果，不能改成继承 Octop 管理员 |
| 应用退出后还看到 Octop 已登录 | 这是会话隔离的预期结果；点击应用登录会重新使用仍有效的 Octop 身份 |

不要对失败 code 无限重试，不要缓存身份兑换结果充当成功回调，也不要在失败时继续按匿名身份开放业务接口。密钥轮换、code 过期或被消费后，清理待登录状态，让用户显式开始一次新的登录。

## 7. 自动化验证

独立 Demo 测试使用真实 ASGI 路由、应用 session Cookie 与本地权限检查，仅模拟跨进程 Octop HTTP 兑换边界：

```text
uv run --with itsdangerous pytest tests/unit/api/test_app_sso_demo.py -q
uv run --with itsdangerous ruff check examples/app_sso_demo tests/unit/api/test_app_sso_demo.py
node --check examples/app_sso_demo/static/app.js
```

不安装独立依赖时，主项目测试会明确跳过这个 Demo 测试模块；因此 Demo 验收必须执行带 `--with itsdangerous` 的命令，不能只用 skip 数量宣称验证通过。

真实联调还应覆盖：已登录 Octop 的 iframe 和新标签页登录、未登录应用的 `401`、非来源窗口/错误 origin 拒绝、state/PKCE 错误、code 过期/重放/并发、密钥轮换、用户停用/入口撤权、应用本地退出与重新登录，以及目标企业浏览器的第三方 Cookie 策略。仓库整体交付检查仍是 `make all` 和前端类型检查/构建，不能用 Demo 单测替代。
