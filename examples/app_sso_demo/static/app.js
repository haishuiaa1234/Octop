"use strict";

let bootstrap = null;
let trustedSource = window.parent !== window ? window.parent : null;
let redirecting = false;
const $ = (id) => document.getElementById(id);

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  if (!response.ok) throw new Error(`请求失败 (${response.status})`);
  return response.json();
}

function ready() {
  if (!bootstrap?.pending || !trustedSource || redirecting) return;
  trustedSource.postMessage(
    { type: "octop.sso.ready", ...bootstrap.pending },
    bootstrap.octop_origin,
  );
}

window.addEventListener("message", (event) => {
  if (!bootstrap || event.origin !== bootstrap.octop_origin || !event.source) return;
  if (!event.data || typeof event.data !== "object") return;
  if (event.data.type === "octop.sso.hello") {
    if (trustedSource && event.source !== trustedSource) return;
    trustedSource = event.source;
    ready();
    return;
  }
  if (
    event.data.type !== "octop.sso.code" ||
    event.source !== trustedSource ||
    !bootstrap.pending ||
    redirecting ||
    event.data.state !== bootstrap.pending.state ||
    typeof event.data.code !== "string" ||
    !event.data.code ||
    event.data.code.length > 512 ||
    event.data.callback_url !== bootstrap.callback_url
  ) return;
  const callback = new URL(bootstrap.callback_url);
  if (callback.origin !== window.location.origin) return;
  callback.searchParams.set("code", event.data.code);
  callback.searchParams.set("state", bootstrap.pending.state);
  redirecting = true;
  window.location.assign(callback.href);
});

async function render() {
  $("logout").hidden = !bootstrap.authenticated;
  $("login").hidden = bootstrap.authenticated;
  $("workspace").hidden = !bootstrap.authenticated;
  $("status").textContent = bootstrap.authenticated ? "已登录" : "未登录";
  $("status").className = bootstrap.authenticated ? "status" : "status pending";
  if (!bootstrap.authenticated) {
    $("display-name").textContent = "企业报表";
    $("account").textContent = "";
    ready();
    return;
  }
  const identity = await request("/api/me");
  $("display-name").textContent = identity.user.display_name || identity.user.username;
  $("account").textContent = identity.user.username;
  $("subject").textContent = identity.application.subject;
  $("permissions").textContent = identity.application.permissions.join(", ");
  const reports = await request("/api/reports");
  $("reports").replaceChildren();
  for (const report of reports.items) {
    const row = document.createElement("tr");
    for (const value of [report.id, report.name, report.status === "ready" ? "已就绪" : report.status, "无导出权限"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }
    $("reports").appendChild(row);
  }
}

$("login").addEventListener("click", async () => {
  $("login").disabled = true;
  $("error").hidden = true;
  try {
    bootstrap = await request("/auth/start", {
      method: "POST",
      headers: { "X-CSRF-Token": bootstrap.csrf_token },
    });
    await render();
  } catch (error) {
    showError(error.message);
  } finally {
    $("login").disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  $("logout").disabled = true;
  try {
    await request("/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": bootstrap.csrf_token },
    });
    bootstrap = await request("/api/sso/bootstrap");
    await render();
  } catch (error) {
    showError(error.message);
  } finally {
    $("logout").disabled = false;
  }
});

request("/api/sso/bootstrap").then(async (value) => {
  bootstrap = value;
  await render();
}).catch((error) => showError(error.message));
