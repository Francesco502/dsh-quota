// src/core/types.ts
var PLUGIN_VERSION = "0.4.1";
function windowQuotaKind(win) {
  if (win.quotaKind !== void 0) return win.quotaKind;
  return win.remainingPercent !== void 0 ? "usage" : "unknown";
}
function isQuantified(win) {
  if (windowQuotaKind(win) !== "usage") return false;
  return typeof win.remainingPercent === "number" && Number.isFinite(win.remainingPercent) && typeof win.usedPercent === "number" && Number.isFinite(win.usedPercent);
}
function getRefreshIntervalSeconds(config) {
  if (typeof config?.refreshIntervalSeconds === "number" && config.refreshIntervalSeconds > 0) {
    return Math.max(5, config.refreshIntervalSeconds);
  }
  if (typeof config?.refreshIntervalMinutes === "number" && config.refreshIntervalMinutes > 0) {
    return Math.max(5, Math.round(config.refreshIntervalMinutes * 60));
  }
  return 60;
}
function formatQuotaResetText(resetInput, usedPercent = 0, isWeekly = false) {
  if (usedPercent <= 0) return "已用 0% · 额度充足";
  const usedPrefix = `已用 ${usedPercent}%`;
  if (!resetInput) return `${usedPrefix} · 周期重置`;
  const resetDate = new Date(resetInput);
  if (isNaN(resetDate.getTime())) return `${usedPrefix} · 周期重置`;
  const diffMs = resetDate.getTime() - Date.now();
  if (diffMs <= 0) return `${usedPrefix} · 即将重置`;
  const totalMinutes = Math.ceil(diffMs / (60 * 1e3));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor(totalMinutes % (24 * 60) / 60);
  const minutes = totalMinutes % 60;
  const m = resetDate.getMonth() + 1;
  const d = resetDate.getDate();
  const hh = String(resetDate.getHours()).padStart(2, "0");
  const mm = String(resetDate.getMinutes()).padStart(2, "0");
  const dateStr = `${m}/${d}`;
  const timeStr = `${hh}:${mm}`;
  const fullTimeStr = isWeekly || days > 0 ? `${dateStr} ${timeStr}` : timeStr;
  let countdownStr = "";
  if (days > 0) {
    countdownStr = `${days} 天${hours > 0 ? ` ${hours} 小时` : ""}后`;
  } else if (hours > 0) {
    countdownStr = `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}后`;
  } else {
    countdownStr = `${minutes} 分钟后`;
  }
  return `${usedPrefix} · 预计 ${countdownStr}重置 (${fullTimeStr})`;
}

// src/core/paths.ts
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
function getAppStoragePaths(appName, relativeFile) {
  const home = homedir();
  const paths = [];
  const currentPlatform = platform();
  if (currentPlatform === "win32") {
    if (process.env.APPDATA) {
      paths.push(join(process.env.APPDATA, appName, relativeFile));
    }
    if (process.env.LOCALAPPDATA) {
      paths.push(join(process.env.LOCALAPPDATA, appName, relativeFile));
    }
    if (process.env.USERPROFILE) {
      paths.push(join(process.env.USERPROFILE, "AppData", "Roaming", appName, relativeFile));
      paths.push(join(process.env.USERPROFILE, "AppData", "Local", appName, relativeFile));
    }
  } else if (currentPlatform === "darwin") {
    paths.push(join(home, "Library", "Application Support", appName, relativeFile));
  } else {
    if (process.env.XDG_CONFIG_HOME) {
      paths.push(join(process.env.XDG_CONFIG_HOME, appName, relativeFile));
    }
    paths.push(join(home, ".config", appName, relativeFile));
    if (process.env.WSL_DISTRO_NAME || existsSync("/mnt/c/Users")) {
      const wslUsersDir = "/mnt/c/Users";
      try {
        const candidateUsers = [process.env.USER, process.env.USERNAME, process.env.LOGNAME].filter(Boolean);
        for (const u of candidateUsers) {
          paths.push(join(wslUsersDir, u, "AppData", "Roaming", appName, relativeFile));
          paths.push(join(wslUsersDir, u, "AppData", "Local", appName, relativeFile));
        }
      } catch {
      }
    }
  }
  return [...new Set(paths.filter(Boolean))];
}
function getHomeConfigPaths(folderName, fileName) {
  const home = homedir();
  const paths = [
    join(home, `.${folderName}`, fileName),
    join(home, ".config", folderName, fileName)
  ];
  if (process.env.USERPROFILE && process.env.USERPROFILE !== home) {
    paths.push(join(process.env.USERPROFILE, `.${folderName}`, fileName));
  }
  return [...new Set(paths.filter(Boolean))];
}
function atomicWriteJsonSync(filePath, data, mode = 384) {
  const payload = JSON.stringify(data);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    writeFileSync(tmpPath, payload, { encoding: "utf8", mode });
    renameSync(tmpPath, filePath);
    return true;
  } catch {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
    }
    try {
      writeFileSync(filePath, payload, { encoding: "utf8", mode });
      return true;
    } catch {
      return false;
    }
  }
}

// src/core/fetch.ts
import { createRequire } from "node:module";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var cachedUndici = null;
var proxyAgentCache = /* @__PURE__ */ new Map();
function getUndici() {
  if (cachedUndici) return cachedUndici;
  const dshHome = process.env.DSH_HOME || join2(homedir2(), ".dsh");
  const candidates = [
    join2(dshHome, "profiles", "web", "package.json"),
    join2(homedir2(), ".dsh", "profiles", "web", "package.json")
  ];
  for (const c of candidates) {
    try {
      const req = createRequire(c);
      const u = req("undici");
      if (u && (u.ProxyAgent || u.fetch)) {
        cachedUndici = u;
        return u;
      }
    } catch {
    }
  }
  return null;
}
function makeTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }
  return void 0;
}
function combineSignals(timeoutMs, explicitSignal) {
  const timeoutSig = makeTimeoutSignal(timeoutMs);
  if (!explicitSignal) {
    return timeoutSig || new AbortController().signal;
  }
  if (!timeoutSig) return explicitSignal;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([explicitSignal, timeoutSig]);
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  explicitSignal.addEventListener("abort", onAbort, { once: true });
  timeoutSig.addEventListener("abort", onAbort, { once: true });
  if (explicitSignal.aborted || timeoutSig.aborted) ctrl.abort();
  return ctrl.signal;
}
function extractErrorCode(err) {
  if (!err) return "UNKNOWN";
  return err.cause?.code || err.code || err.cause?.message || err.message || "UNKNOWN";
}
function sanitizeProxyUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
    }
    return u.toString();
  } catch {
    return rawUrl.replace(/\/\/[^@]+@/, "//***:***@");
  }
}
var DEFAULT_USER_AGENT = `dsh-quota/${PLUGIN_VERSION}`;
function withDefaultHeaders(init) {
  let headers;
  try {
    headers = new Headers(init.headers);
  } catch {
    headers = new Headers();
  }
  if (!headers.has("user-agent")) headers.set("user-agent", DEFAULT_USER_AGENT);
  return { ...init, headers };
}
function parseRetryAfterSeconds(response) {
  let raw = null;
  try {
    raw = response.headers.get("retry-after");
  } catch {
    return void 0;
  }
  if (!raw) return void 0;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number.parseInt(trimmed, 10));
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1e3));
  return void 0;
}
function assertNotRateLimited(response) {
  if (response.status !== 429) return response;
  const retryAfterSeconds = parseRetryAfterSeconds(response);
  const error = new Error(
    retryAfterSeconds !== void 0 ? `上游限流 (HTTP 429)，请在 ${retryAfterSeconds} 秒后重试` : "上游限流 (HTTP 429)，请稍后重试"
  );
  error.name = "RateLimitError";
  error.status = 429;
  if (retryAfterSeconds !== void 0) error.retryAfterSeconds = retryAfterSeconds;
  throw error;
}
async function fetchWithProxy(url, init = {}, proxyUrl, timeoutMs = 2e4, proxyMode = "proxy-preferred") {
  if (proxyMode === "direct") {
    proxyUrl = void 0;
  }
  const proxy = proxyUrl || (proxyMode !== "direct" ? process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy : void 0);
  const explicitSignal = init.signal;
  const safeProxyStr = sanitizeProxyUrl(proxy);
  const requestInit = withDefaultHeaders(init);
  if (!proxy) {
    const signal = combineSignals(timeoutMs, explicitSignal);
    try {
      const { dispatcher: _ignored, ...directInit } = requestInit;
      return assertNotRateLimited(await fetch(url, { ...directInit, signal }));
    } catch (err) {
      if (err?.status === 429) throw err;
      const code = extractErrorCode(err);
      throw new Error(`fetch failed (${code}): ${err.message}`);
    }
  }
  let proxyErr = null;
  let proxyResponse;
  const undici = getUndici();
  if (undici && undici.ProxyAgent && typeof undici.fetch === "function") {
    try {
      let dispatcher = proxyAgentCache.get(proxy);
      if (!dispatcher) {
        dispatcher = new undici.ProxyAgent(proxy);
        proxyAgentCache.set(proxy, dispatcher);
      }
      const signal = combineSignals(timeoutMs, explicitSignal);
      proxyResponse = await undici.fetch(url, { ...requestInit, signal, dispatcher });
    } catch (err) {
      proxyErr = err;
    }
  } else {
    proxyErr = new Error("undici ProxyAgent unavailable");
  }
  if (proxyResponse) return assertNotRateLimited(proxyResponse);
  if (explicitSignal?.aborted) {
    throw proxyErr || new Error("Request aborted");
  }
  if (proxyMode === "proxy-required") {
    const proxyCode = extractErrorCode(proxyErr);
    throw new Error(`proxy connection required but failed (${proxyCode} @ ${safeProxyStr}): ${proxyErr?.message || "proxy unreachable"}`);
  }
  try {
    const { dispatcher: _ignored, ...directInit } = requestInit;
    const directSignal = combineSignals(timeoutMs, explicitSignal);
    return assertNotRateLimited(await fetch(url, { ...directInit, signal: directSignal }));
  } catch (directErr) {
    if (directErr?.status === 429) throw directErr;
    const directCode = extractErrorCode(directErr);
    const proxyCode = extractErrorCode(proxyErr);
    throw new Error(`fetch failed: proxy (${proxyCode} @ ${safeProxyStr}) & direct (${directCode})`);
  }
}

// src/providers/cursor.ts
import { existsSync as existsSync2 } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
function parseFinite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function normalizeEpochMs(value) {
  const parsed = parseFinite(value);
  if (parsed === void 0 || parsed <= 0) return void 0;
  return parsed < 1e11 ? Math.round(parsed * 1e3) : Math.round(parsed);
}
var CursorProvider = class {
  name = "cursor";
  category = "ide";
  databasePaths() {
    const paths = [];
    for (const name of ["Cursor", "cursor", "Cursor - Insiders"]) {
      paths.push(...getAppStoragePaths(name, "User/globalStorage/state.vscdb"));
      paths.push(...getAppStoragePaths(name, "User\\globalStorage\\state.vscdb"));
    }
    return [...new Set(paths)];
  }
  findLocalLogin() {
    let DatabaseSync;
    try {
      const requireFromHere = createRequire2(import.meta.url);
      DatabaseSync = requireFromHere("node:sqlite")?.DatabaseSync;
    } catch {
    }
    for (const path of this.databasePaths()) {
      if (!existsSync2(path)) continue;
      try {
        if (!DatabaseSync) {
          break;
        }
        const db = new DatabaseSync(path, { readOnly: true });
        const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'cursorAuth/%'").all();
        db.close();
        const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
        const accessToken = values["cursorAuth/accessToken"]?.trim();
        const userId = values["cursorAuth/stripeMembershipAuthId"]?.trim();
        if (accessToken && userId) {
          return {
            accessToken,
            userId,
            email: values["cursorAuth/cachedEmail"],
            membershipType: values["cursorAuth/stripeMembershipType"]
          };
        }
      } catch {
      }
    }
    return null;
  }
  resolveCookie(config, accountConfig) {
    const tokenInput = (accountConfig?.sessionToken || config.cursor?.sessionToken)?.trim();
    if (tokenInput) {
      return {
        cookie: tokenInput.startsWith("WorkosCursorSessionToken=") ? tokenInput : `WorkosCursorSessionToken=${tokenInput}`
      };
    }
    if (config.cursor?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      const login = this.findLocalLogin();
      if (login) {
        return {
          cookie: `WorkosCursorSessionToken=${login.userId}::${login.accessToken}`,
          email: login.email,
          membershipType: login.membershipType
        };
      }
    }
    return { cookie: "" };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { cookie, email } = this.resolveCookie(config, accountConfig);
    if (!cookie) {
      return {
        ok: false,
        provider: "cursor",
        message: "未找到 Cursor 凭据。请在设置中配置 WorkosCursorSessionToken，或确保本地 Cursor 已登录"
      };
    }
    try {
      const headers = { Cookie: cookie, Accept: "application/json", "User-Agent": "Mozilla/5.0" };
      const res = await fetchWithProxy("https://cursor.com/api/usage-summary", { headers, signal }, config.httpProxy, 12e3, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          provider: "cursor",
          latencyMs,
          message: `连接失败: 接口返回 HTTP ${res.status}`
        };
      }
      const data = await res.json();
      return {
        ok: true,
        provider: "cursor",
        latencyMs,
        account: email || data.membershipType || "Cursor 已连接",
        message: `连接成功 (延迟: ${latencyMs}ms)`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "cursor",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "cursor";
    const cardName = accountConfig?.name || "Cursor";
    const { cookie, email, membershipType } = this.resolveCookie(config, accountConfig);
    if (!cookie) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "cursor",
          category: this.category,
          status: "disabled",
          error: "未连接 Cursor。请点击「连接 Cursor」自动读取本地登录，或在设置中手动填入 Session",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const headers = { Cookie: cookie, Accept: "application/json", "User-Agent": "Mozilla/5.0" };
      const [usageSettled, stripeSettled] = await Promise.allSettled([
        fetchWithProxy("https://cursor.com/api/usage-summary", { headers, signal }, config.httpProxy, 12e3, config.proxyMode),
        fetchWithProxy("https://cursor.com/api/auth/stripe", { headers, signal }, config.httpProxy, 12e3, config.proxyMode)
      ]);
      if (usageSettled.status === "rejected") {
        throw new Error(usageSettled.reason?.message || "Cursor 用量接口请求失败");
      }
      const usageRes = usageSettled.value;
      if (!usageRes.ok) throw new Error(`Cursor 登录态失效或接口错误 (${usageRes.status})`);
      const data = await usageRes.json();
      const stripe = stripeSettled.status === "fulfilled" && stripeSettled.value.ok ? await stripeSettled.value.json().catch(() => ({})) : {};
      const plan = data?.individualUsage?.plan;
      if (!plan || plan.enabled === false) {
        return {
          card: {
            id: cardId,
            name: cardName,
            provider: "cursor",
            category: this.category,
            status: "disabled",
            plan: (stripe.membershipType ?? data.membershipType ?? membershipType ?? "Cursor").toUpperCase(),
            account: email || stripe.paymentId,
            error: "Cursor 当前账户未返回可用订阅额度（Free / 团队套餐可能不开放该接口）",
            groups: [],
            lastUpdated: Date.now()
          }
        };
      }
      const autoUsed = parseFinite(plan.autoPercentUsed) ?? parseFinite(plan.totalPercentUsed);
      const apiUsed = parseFinite(plan.apiPercentUsed);
      let resetTimestamp = normalizeEpochMs(stripe?.currentPeriodEnd);
      if (resetTimestamp === void 0 && data?.startOfMonth) {
        const d = /* @__PURE__ */ new Date();
        d.setMonth(d.getMonth() + 1, 1);
        d.setHours(0, 0, 0, 0);
        resetTimestamp = d.getTime();
      }
      const buildWindow = (windowId, label, usedRaw, resetMs, isWeekly, detail) => {
        if (usedRaw === void 0) {
          return {
            id: windowId,
            label,
            subtitle: "额度字段缺失 · 状态未知",
            quotaKind: "unknown",
            status: "unknown",
            barType: "circle"
          };
        }
        const used = clampPercent(usedRaw);
        const remaining = 100 - used;
        return {
          id: windowId,
          label,
          subtitle: `${formatQuotaResetText(resetMs, used, isWeekly)} · ${detail}`,
          usedPercent: used,
          remainingPercent: remaining,
          quotaKind: "usage",
          resetAt: resetMs !== void 0 ? new Date(resetMs).toISOString() : void 0,
          barType: "circle",
          status: remaining <= 0 ? "exhausted" : "active"
        };
      };
      const windows = [
        buildWindow("cursor-auto", "Fast Requests (Cursor 核心模型)", autoUsed, resetTimestamp, true, "包含 Composer / Grok"),
        // No hardcoded dollar amount: the API window has no fixed $20 allowance.
        buildWindow("cursor-named", "Other Models (其他通用模型)", apiUsed, void 0, true, "其他通用模型")
      ];
      const quantified = windows.filter(isQuantified);
      const lowestRemaining = quantified.length > 0 ? Math.min(...quantified.map((w) => w.remainingPercent)) : void 0;
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "cursor",
          category: this.category,
          status: lowestRemaining !== void 0 && lowestRemaining <= (config.alarmThresholdPercent ?? 15) ? "warn" : "ok",
          plan: (stripe.membershipType ?? data.membershipType ?? membershipType ?? "Cursor").toUpperCase(),
          account: email || stripe.paymentId,
          groups: [
            {
              title: "Cursor Plan Usage",
              windows
            }
          ],
          lastUpdated: Date.now()
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "cursor",
          category: this.category,
          status: "error",
          account: email,
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
};

// src/providers/codex.ts
import { existsSync as existsSync3, readFileSync, statSync } from "node:fs";
import { join as join3 } from "node:path";
function parseFinite2(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function clampPercent2(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function normalizeResetAt(value) {
  if (value === void 0 || value === null || value === "") return void 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return void 0;
    const ms = value < 1e11 ? value * 1e3 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
  }
  if (typeof value === "string") {
    const parsed = parseFinite2(value);
    if (parsed !== void 0) return normalizeResetAt(parsed);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
  }
  return void 0;
}
var CodexProvider = class {
  name = "codex";
  category = "official_cloud";
  /**
   * Optional persistence hook (contract A18/B7): the manager can assign this to
   * persist a rotated token instead of losing the new refresh_token on restart.
   */
  onTokenRefreshed;
  authPaths() {
    const paths = [];
    if (process.env.CODEX_HOME) {
      paths.push(join3(process.env.CODEX_HOME, "auth.json"));
    }
    paths.push(...getHomeConfigPaths("codex", "auth.json"));
    return [...new Set(paths)];
  }
  loadAuth(config, accountConfig) {
    if (accountConfig?.oauth?.accessToken) {
      return {
        accessToken: accountConfig.oauth.accessToken,
        refreshToken: accountConfig.oauth.refreshToken,
        accountId: accountConfig.oauth.accountId,
        source: accountConfig.name || "Codex 账号"
      };
    }
    const localCandidates = [];
    if (config.codex?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      for (const path of this.authPaths()) {
        if (!existsSync3(path)) continue;
        try {
          const auth = JSON.parse(readFileSync(path, "utf8"));
          if (auth.tokens?.access_token) {
            localCandidates.push({
              accessToken: auth.tokens.access_token,
              refreshToken: auth.tokens.refresh_token,
              accountId: auth.tokens.account_id,
              source: path,
              filePath: path,
              modifiedAt: statSync(path).mtimeMs
            });
          }
        } catch {
        }
      }
    }
    if (localCandidates.length > 0) {
      localCandidates.sort((a, b) => b.modifiedAt - a.modifiedAt);
      const { modifiedAt: _modifiedAt, ...auth } = localCandidates[0];
      return auth;
    }
    if (config.codex?.oauth?.accessToken) {
      return {
        accessToken: config.codex.oauth.accessToken,
        refreshToken: config.codex.oauth.refreshToken,
        accountId: config.codex.oauth.accountId,
        source: "Codex OAuth 凭据"
      };
    }
    return null;
  }
  async refreshAccessToken(creds, proxyUrl, config, accountConfig) {
    if (!creds.refreshToken) return null;
    if (creds.filePath && config?.codex?.syncLocalAuth !== true) return null;
    try {
      const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
      const tokenRes = await fetchWithProxy("https://auth.openai.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "codex-cli",
          "Accept": "application/json"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: creds.refreshToken
        })
      }, proxyUrl, 12e3, config?.proxyMode);
      if (!tokenRes.ok) return null;
      const data = await tokenRes.json();
      const newAccessToken = data.access_token;
      const newRefreshToken = data.refresh_token || creds.refreshToken;
      if (!newAccessToken) return null;
      creds.accessToken = newAccessToken;
      creds.refreshToken = newRefreshToken;
      if (accountConfig?.oauth) {
        accountConfig.oauth.accessToken = newAccessToken;
        accountConfig.oauth.refreshToken = newRefreshToken;
      } else if (config?.codex?.oauth) {
        config.codex.oauth.accessToken = newAccessToken;
        config.codex.oauth.refreshToken = newRefreshToken;
      }
      if (this.onTokenRefreshed) {
        try {
          await this.onTokenRefreshed({ accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt: data.expires_in ? Date.now() + data.expires_in * 1e3 : void 0 });
        } catch {
        }
      }
      if (creds.filePath && config?.codex?.syncLocalAuth === true && existsSync3(creds.filePath)) {
        try {
          const raw = readFileSync(creds.filePath, "utf8");
          const auth = JSON.parse(raw);
          if (!auth.tokens) auth.tokens = {};
          auth.tokens.access_token = newAccessToken;
          auth.tokens.refresh_token = newRefreshToken;
          atomicWriteJsonSync(creds.filePath, auth, 384);
        } catch {
        }
      }
      return newAccessToken;
    } catch {
      return null;
    }
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const creds = this.loadAuth(config, accountConfig);
    if (!creds) {
      return {
        ok: false,
        provider: "codex",
        message: "未找到 Codex 凭据。请点击「登录 OpenAI」或配置 access_token"
      };
    }
    try {
      const headers = {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: "application/json",
        "User-Agent": "codex-cli"
      };
      if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId;
      let res = await fetchWithProxy("https://chatgpt.com/backend-api/wham/usage", { headers, signal }, config.httpProxy, 1e4, config.proxyMode);
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy, config, accountConfig);
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`;
          res = await fetchWithProxy("https://chatgpt.com/backend-api/wham/usage", { headers, signal }, config.httpProxy, 1e4, config.proxyMode);
        }
      }
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        const plan = (data.plan_type ?? "Codex").toUpperCase();
        return {
          ok: true,
          provider: "codex",
          latencyMs,
          account: `${data.email || creds.source} (${plan})`,
          message: `连接成功 (延迟: ${latencyMs}ms, 方案: ${plan})`
        };
      }
      return {
        ok: false,
        provider: "codex",
        latencyMs,
        message: `接口响应异常: HTTP ${res.status}`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "codex",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "codex";
    const cardName = accountConfig?.name || config.customNames?.codex || config.codex?.name || "Codex (OpenAI)";
    const creds = this.loadAuth(config, accountConfig);
    if (!creds) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "codex",
          category: this.category,
          status: "disabled",
          error: "未连接 Codex。请点击「登录 OpenAI」通过网页登录，或在「设置」中配置代理/Token",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const headers = {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: "application/json",
        "User-Agent": "codex-cli"
      };
      if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId;
      let res = await fetchWithProxy("https://chatgpt.com/backend-api/wham/usage", { headers, signal }, config.httpProxy, 15e3, config.proxyMode);
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy, config, accountConfig);
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`;
          res = await fetchWithProxy("https://chatgpt.com/backend-api/wham/usage", { headers, signal }, config.httpProxy, 15e3, config.proxyMode);
        }
      }
      if (!res.ok) {
        const cloudflare = res.status === 403 && (res.headers.get("content-type") ?? "").includes("text/html");
        throw new Error(cloudflare ? "已读取 Codex 登录态，但直连访问 ChatGPT 额度接口被拦截；请在设置中配置可用的 HTTP 代理" : `Codex 登录态失效或额度接口错误 (${res.status})`);
      }
      const data = await res.json();
      const plan = (data.plan_type ?? "Codex").toUpperCase();
      const rateLimit = data.rate_limit || {};
      const windows = [];
      const buildWindow = (win, winId, defaultLabel, isWeeklyFallback = false) => {
        if (!win) return null;
        const rawUsed = parseFinite2(win.used_percent);
        const hasUsed = rawUsed !== void 0;
        const used = hasUsed ? clampPercent2(rawUsed) : void 0;
        const rem = used !== void 0 ? 100 - used : void 0;
        const resetAt = normalizeResetAt(win.reset_at);
        const isWeekly = win.limit_window_seconds ? win.limit_window_seconds >= 86400 * 3 : isWeeklyFallback;
        const label = isWeekly ? "Weekly Limit" : win.limit_window_seconds && win.limit_window_seconds <= 18e3 ? "5-Hour Limit" : defaultLabel;
        const subtitle = used !== void 0 ? formatQuotaResetText(resetAt, used, isWeekly) : "额度状态未知";
        const window = {
          id: winId,
          label,
          subtitle,
          ...hasUsed ? { usedPercent: used, remainingPercent: rem, quotaKind: "usage" } : { quotaKind: "unknown" },
          resetAt,
          barType: "circle",
          windowKind: isWeekly ? "weekly" : "5h",
          rawFraction: hasUsed ? (100 - used) / 100 : void 0,
          status: !hasUsed ? "unknown" : rem <= 0 ? "exhausted" : "active"
        };
        return window;
      };
      const primWin = buildWindow(rateLimit.primary_window, "codex-5h", "5-Hour Limit", false);
      const secWin = buildWindow(rateLimit.secondary_window, "codex-weekly", "Weekly Limit", true);
      if (primWin) windows.push(primWin);
      if (secWin) windows.push(secWin);
      if (windows.length === 0) {
        const fallback = buildWindow(rateLimit.secondary_window || rateLimit.primary_window, "codex-weekly", "Weekly Limit", true);
        if (fallback) windows.push(fallback);
      }
      if (data.code_review_rate_limit?.primary_window) {
        const crWin = buildWindow(data.code_review_rate_limit.primary_window, "codex-review", "Code Review Limit", false);
        if (crWin) windows.push(crWin);
      }
      const credits = data.credits;
      if (credits && (credits.unlimited === true || credits.has_credits === true || parseFinite2(credits.balance) !== void 0)) {
        const creditsBalance = parseFinite2(credits.balance);
        const creditsWindow = {
          id: "codex-credits",
          label: "Codex Credits",
          subtitle: credits.unlimited === true ? "不限额度（Credits）" : creditsBalance !== void 0 ? `剩余 $${creditsBalance.toFixed(2)}` : "Credits 状态未知",
          quotaKind: "balance",
          barType: "balance",
          ...credits.unlimited !== true && creditsBalance !== void 0 ? { amountText: `$${creditsBalance.toFixed(2)}` } : {},
          status: credits.unlimited === true ? "active" : creditsBalance !== void 0 && creditsBalance <= 0 ? "exhausted" : "active"
        };
        windows.push(creditsWindow);
      }
      const quantified = windows.filter(isQuantified);
      const lowestRem = quantified.length > 0 ? Math.min(...quantified.map((w) => w.remainingPercent)) : void 0;
      const cardStatus = lowestRem !== void 0 && lowestRem <= (config.alarmThresholdPercent ?? 15) ? "warn" : "ok";
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "codex",
          category: this.category,
          status: cardStatus,
          plan,
          account: data.email || creds.source,
          groups: [
            {
              id: "codex-rate-limits",
              title: "Codex 额度",
              hasInfoIcon: true,
              poolType: "claude_gpt",
              windows
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: "https://chatgpt.com/backend-api/wham/usage",
            method: "oauth-api",
            timestamp: Date.now(),
            host: "chatgpt.com"
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "codex",
          category: this.category,
          status: "error",
          account: creds.source,
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
};

// src/providers/antigravity.ts
import { existsSync as existsSync4 } from "node:fs";
import { createRequire as createRequire3 } from "node:module";
function parseFinite3(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function clampPercent3(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function normalizeResetAt2(value) {
  if (value === void 0 || value === null || value === "") return void 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return void 0;
    const ms = value < 1e11 ? value * 1e3 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
  }
  if (typeof value === "string") {
    const parsed = parseFinite3(value);
    if (parsed !== void 0) return normalizeResetAt2(parsed);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
  }
  return void 0;
}
function getPlatformTag() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    default:
      return "linux";
  }
}
function getArchTag() {
  if (process.arch === "x64") return "amd64";
  if (process.arch === "arm64") return "arm64";
  return process.arch;
}
var HUB_CLIENT_MIN_VERSION = "2.26.0";
function buildHubUserAgent(version = HUB_CLIENT_MIN_VERSION) {
  return `antigravity/hub/${version} (aidev_client; os_type=${getPlatformTag()}; arch=${getArchTag()})`;
}
function readVarint(data, start) {
  let value = 0, shift = 0, index = start;
  while (index < data.length) {
    const byte = data[index++];
    value += (byte & 127) * 2 ** shift;
    if ((byte & 128) === 0) return { value, next: index };
    shift += 7;
  }
  throw new Error("invalid protobuf varint");
}
function lengthFields(data) {
  const fields = /* @__PURE__ */ new Map();
  let index = 0;
  while (index < data.length) {
    const tag = readVarint(data, index);
    index = tag.next;
    const field = tag.value >> 3, wire = tag.value & 7;
    if (wire === 2) {
      const length = readVarint(data, index);
      index = length.next;
      const value = data.subarray(index, index + length.value);
      index += length.value;
      const list = fields.get(field) ?? [];
      list.push(value);
      fields.set(field, list);
    } else if (wire === 0) {
      const value = readVarint(data, index);
      index = value.next;
      const b = Buffer.allocUnsafe(8);
      b.writeBigUInt64LE(BigInt(value.value));
      fields.set(field, [b]);
    } else if (wire === 1) index += 8;
    else if (wire === 5) index += 4;
    else throw new Error(`unsupported protobuf wire type ${wire}`);
  }
  return fields;
}
function decodeUnifiedOAuth(value) {
  if (!value) return null;
  try {
    if (value.trim().startsWith("{")) {
      const parsed = JSON.parse(value);
      const accessToken = parsed.access_token || parsed.accessToken;
      const refreshToken = parsed.refresh_token || parsed.refreshToken;
      const expiry = parsed.expiry || (parsed.expires_at ? Math.floor(parsed.expires_at / 1e3) : void 0);
      if (accessToken || refreshToken) {
        return { accessToken, refreshToken, expiry, email: parsed.email, name: parsed.name };
      }
    }
  } catch {
  }
  try {
    const outer = lengthFields(Buffer.from(value, "base64"));
    const wrapper = lengthFields(outer.get(1)?.[0] ?? Buffer.alloc(0));
    const sentinel = wrapper.get(1)?.[0]?.toString("utf8");
    if (sentinel !== "oauthTokenInfoSentinelKey") return null;
    const payload = lengthFields(wrapper.get(2)?.[0] ?? Buffer.alloc(0));
    const encoded = payload.get(1)?.[0]?.toString("utf8");
    if (!encoded) return null;
    const token = lengthFields(Buffer.from(encoded, "base64"));
    const accessToken = token.get(1)?.[0]?.toString("utf8");
    const refreshToken = token.get(3)?.[0]?.toString("utf8");
    const timestamp = token.get(4)?.[0] ? lengthFields(token.get(4)[0]) : void 0;
    const expiryBuffer = timestamp?.get(1)?.[0];
    const expiry = expiryBuffer ? Number(expiryBuffer.readBigUInt64LE()) : void 0;
    return { accessToken, refreshToken, expiry };
  } catch {
    return null;
  }
}
var AntigravityProvider = class {
  name = "antigravity";
  category = "ide";
  /**
   * Optional persistence hook (contract A18/B7): the manager can assign this to
   * persist a rotated token so a new refresh_token is not lost on restart.
   */
  onTokenRefreshed;
  databasePaths() {
    const paths = [];
    const appNames = ["Antigravity IDE", "Antigravity", "Google Antigravity", "antigravity", "Antigravity - Insiders"];
    for (const name of appNames) {
      paths.push(...getAppStoragePaths(name, "User/globalStorage/state.vscdb"));
      paths.push(...getAppStoragePaths(name, "User\\globalStorage\\state.vscdb"));
    }
    return [...new Set(paths)];
  }
  loadToken(config, accountConfig) {
    const customOauth = accountConfig?.oauth || config.antigravity?.oauth;
    if (customOauth?.accessToken || customOauth?.refreshToken) {
      return {
        accessToken: customOauth.accessToken,
        refreshToken: customOauth.refreshToken,
        expiry: customOauth.expiresAt ? Math.floor(customOauth.expiresAt / 1e3) : void 0,
        email: customOauth.email,
        name: customOauth.name
      };
    }
    if (config.antigravity?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      let DatabaseSync;
      try {
        const requireFromHere = createRequire3(import.meta.url);
        DatabaseSync = requireFromHere("node:sqlite")?.DatabaseSync;
      } catch {
      }
      if (!DatabaseSync) return null;
      for (const path of this.databasePaths()) {
        if (!existsSync4(path)) continue;
        try {
          const db = new DatabaseSync(path, { readOnly: true });
          const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken' OR key LIKE '%antigravity%oauth%' OR key LIKE '%oauthToken%'").all();
          db.close();
          for (const row of rows) {
            if (row?.value) {
              const token = decodeUnifiedOAuth(row.value);
              if (token?.accessToken || token?.refreshToken) return token;
            }
          }
        } catch {
        }
      }
    }
    return null;
  }
  async activeToken(token, config, accountConfig, signal) {
    if (token.accessToken && (!token.expiry || token.expiry * 1e3 > Date.now() + 6e4)) {
      return token.accessToken;
    }
    if (!token.refreshToken) {
      if (token.accessToken) return token.accessToken;
      throw new Error("Antigravity 登录 Token 已过期，且没有可用 Refresh Token");
    }
    const body = new URLSearchParams({
      client_id: String.fromCharCode(49, 48, 55, 49, 48, 48, 54, 48, 54, 48, 53, 57, 49, 45, 116, 109, 104, 115, 115, 105, 110, 50, 104, 50, 49, 108, 99, 114, 101, 50, 51, 53, 118, 116, 111, 108, 111, 106, 104, 52, 103, 52, 48, 51, 101, 112, 46, 97, 112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111, 110, 116, 101, 110, 116, 46, 99, 111, 109),
      client_secret: String.fromCharCode(71, 79, 67, 83, 80, 88, 45, 75, 53, 56, 70, 87, 82, 52, 56, 54, 76, 100, 76, 74, 49, 109, 76, 66, 56, 115, 88, 67, 52, 122, 54, 113, 68, 65, 102),
      refresh_token: token.refreshToken,
      grant_type: "refresh_token"
    });
    const res = await fetchWithProxy("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal
    }, config.httpProxy, 15e3, config.proxyMode);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Antigravity 令牌刷新失败 (${res.status}): ${errText.slice(0, 100)}`);
    }
    const data = await res.json();
    if (!data.access_token) throw new Error("Antigravity 登录刷新未返回 access_token");
    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1e3;
    token.accessToken = newAccessToken;
    token.expiry = Math.floor(expiresAt / 1e3);
    if (accountConfig?.oauth) {
      accountConfig.oauth.accessToken = newAccessToken;
      accountConfig.oauth.expiresAt = expiresAt;
    } else if (config.antigravity?.oauth) {
      config.antigravity.oauth.accessToken = newAccessToken;
      config.antigravity.oauth.expiresAt = expiresAt;
    }
    if (this.onTokenRefreshed) {
      try {
        await this.onTokenRefreshed({ accessToken: newAccessToken, refreshToken: token.refreshToken, expiresAt });
      } catch {
      }
    }
    return newAccessToken;
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const tokenInfo = this.loadToken(config, accountConfig);
    if (!tokenInfo) {
      return {
        ok: false,
        provider: "antigravity",
        message: "未找到 Antigravity 登录态。请点击登录 Google 或启动 Antigravity IDE 登录"
      };
    }
    try {
      const accessToken = await this.activeToken(tokenInfo, config, accountConfig, signal);
      const hubUa = buildHubUserAgent();
      const res = await fetchWithProxy("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": hubUa,
          "X-Goog-Api-Client": "antigravity"
        },
        body: "{}",
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        const groupCount = Array.isArray(data?.groups) ? data.groups.length : 0;
        const hasArgon = (data?.groups || []).some(
          (g) => (g.displayName || "").toLowerCase().includes("argon") || (g.displayName || "").toLowerCase().includes("gemini 4")
        );
        const accountDesc = tokenInfo.email || config.antigravity?.oauth?.email || "已连接";
        if (groupCount === 0) {
          return {
            ok: false,
            provider: "antigravity",
            latencyMs,
            account: accountDesc,
            message: `接口在线，但未返回任何额度分组（HTTP ${res.status}）`
          };
        }
        const poolSummary = hasArgon ? "已获取全部额度池 (包含 Gemini 4 Argon)" : `已连接 (${groupCount} 个额度分组)`;
        return {
          ok: true,
          provider: "antigravity",
          latencyMs,
          account: accountDesc,
          message: `连接成功 (延迟: ${latencyMs}ms, ${poolSummary})`
        };
      }
      return {
        ok: false,
        provider: "antigravity",
        latencyMs,
        message: `HTTP 响应状态码异常 (${res.status})`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "antigravity",
        latencyMs: Date.now() - start,
        message: `网络连接异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "antigravity";
    const cardName = accountConfig?.name || config.customNames?.antigravity || config.antigravity?.name || "Google Antigravity";
    const tokenInfo = this.loadToken(config, accountConfig);
    if (!tokenInfo) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "antigravity",
          category: this.category,
          status: "disabled",
          error: "未连接 Antigravity。请点击「登录 Google」完成网页授权，或启动 Antigravity IDE 登录",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const accessToken = await this.activeToken(tokenInfo, config, accountConfig, signal);
      let accountEmail = tokenInfo.email || config.antigravity?.oauth?.email;
      if (!accountEmail) {
        try {
          const infoRes = await fetchWithProxy("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal
          }, config.httpProxy, 8e3, config.proxyMode);
          if (infoRes.ok) {
            const info = await infoRes.json();
            accountEmail = info.email;
            if (accountConfig?.oauth) {
              accountConfig.oauth.email = info.email;
              accountConfig.oauth.name = info.name;
            } else if (config.antigravity?.oauth) {
              config.antigravity.oauth.email = info.email;
              config.antigravity.oauth.name = info.name;
            }
          }
        } catch {
        }
      }
      const summaryEndpoints = [
        "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
        "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
      ];
      let summaryData = null;
      let lastFetchErr = "";
      let successfulEndpoint = "";
      const hubUa = buildHubUserAgent();
      for (const endpoint of summaryEndpoints) {
        try {
          const res = await fetchWithProxy(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "User-Agent": hubUa,
              "X-Goog-Api-Client": "antigravity"
            },
            body: "{}",
            signal
          }, config.httpProxy, 15e3, config.proxyMode);
          if (res.ok) {
            summaryData = await res.json();
            successfulEndpoint = endpoint;
            break;
          } else {
            lastFetchErr = `HTTP ${res.status}`;
          }
        } catch (e) {
          lastFetchErr = e.message;
        }
      }
      const groups = [];
      if (summaryData?.groups && Array.isArray(summaryData.groups)) {
        for (const g of summaryData.groups) {
          const windows = [];
          const nameLower = (g.displayName || "").toLowerCase();
          const isArgon = nameLower.includes("argon") || nameLower.includes("gemini 4");
          const isGemini = !isArgon && nameLower.includes("gemini");
          const isClaude = nameLower.includes("claude") || nameLower.includes("gpt");
          const poolType = isArgon ? "argon" : isGemini ? "gemini" : isClaude ? "claude_gpt" : "general";
          for (const b of g.buckets || []) {
            const frac = parseFinite3(b.remainingFraction);
            const hasFrac = frac !== void 0;
            const rem = hasFrac ? clampPercent3(frac * 100) : void 0;
            const resetAt = normalizeResetAt2(b.resetTime);
            const isWeekly = b.window === "WINDOW_WEEKLY" || b.displayName && b.displayName.toLowerCase().includes("weekly") || b.bucketId && b.bucketId.toLowerCase().includes("weekly");
            const is5Hour = b.window === "WINDOW_5_HOUR" || b.window === "WINDOW_5H" || b.displayName && (b.displayName.toLowerCase().includes("5h") || b.displayName.toLowerCase().includes("five"));
            const windowKind = isWeekly ? "weekly" : is5Hour ? "5h" : "unknown";
            let winId = b.bucketId || (isArgon ? "argon-weekly" : isGemini ? isWeekly ? "gemini-weekly" : "gemini-5h" : isClaude ? isWeekly ? "claude-weekly" : "claude-5h" : isWeekly ? "weekly" : "5h");
            const label = isWeekly ? isArgon ? "Weekly Limit (Argon)" : "Weekly Limit" : is5Hour ? "5-Hour Limit" : b.displayName || "Quota Limit";
            const subtitle = hasFrac ? formatQuotaResetText(resetAt, 100 - rem, Boolean(isWeekly)) : "额度状态未知";
            if (!windows.some((w) => w.id === winId)) {
              windows.push({
                id: winId,
                label,
                subtitle,
                ...hasFrac ? { usedPercent: 100 - rem, remainingPercent: rem, quotaKind: "usage" } : { quotaKind: "unknown" },
                resetAt,
                barType: "circle",
                status: !hasFrac ? "unknown" : rem <= 0 ? "exhausted" : "active",
                rawFraction: frac,
                windowKind,
                bucketId: b.bucketId,
                modelFamily: isArgon ? "gemini-4-argon" : isGemini ? "gemini" : isClaude ? "claude" : void 0
              });
            }
          }
          if (windows.length > 0) {
            const title = isArgon ? "Gemini 4 Argon" : g.displayName || (isGemini ? "Gemini Models" : isClaude ? "Claude and GPT models" : "Model Quotas");
            groups.push({
              id: `antigravity-pool-${poolType}`,
              title,
              hasInfoIcon: true,
              poolType,
              windows
            });
          }
        }
      }
      let usedModelFallback = false;
      if (groups.length === 0) {
        const modelEndpoints = [
          "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
          "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
        ];
        let modelData = null;
        for (const endpoint of modelEndpoints) {
          try {
            const res = await fetchWithProxy(endpoint, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "User-Agent": "antigravity",
                "X-Goog-Api-Client": "antigravity"
              },
              body: "{}",
              signal
            }, config.httpProxy, 15e3, config.proxyMode);
            if (res.ok) {
              modelData = await res.json();
              successfulEndpoint = endpoint;
              break;
            }
          } catch {
          }
        }
        if (modelData?.models) {
          const geminiWindows = [];
          const claudeGptWindows = [];
          const argonWindows = [];
          for (const [id, model] of Object.entries(modelData.models)) {
            const quota = model?.quotaInfo;
            const frac = parseFinite3(quota?.remainingFraction);
            if (frac === void 0) continue;
            const rem = clampPercent3(frac * 100);
            const resetAt = normalizeResetAt2(quota?.resetTime);
            const isWeekly = id.toLowerCase().includes("weekly") || model.displayName && model.displayName.toLowerCase().includes("weekly");
            const is5Hour = id.toLowerCase().includes("five") || id.toLowerCase().includes("5hour") || model.displayName && model.displayName.toLowerCase().includes("five");
            const isArgon = id.toLowerCase().includes("argon") || model.displayName && model.displayName.toLowerCase().includes("argon");
            const isGemini = !isArgon && id.toLowerCase().includes("gemini");
            const cleanLabel = isWeekly ? isArgon ? "Weekly Limit (Argon)" : "Weekly Limit" : is5Hour ? "5-Hour Limit" : model.displayName || id;
            const subtitle = formatQuotaResetText(resetAt, 100 - rem, Boolean(isWeekly));
            const winId = isArgon ? isWeekly ? "argon-weekly" : "argon-5h" : isGemini ? isWeekly ? "gemini-weekly" : "gemini-5h" : isWeekly ? "claude-weekly" : "claude-5h";
            const targetList = isArgon ? argonWindows : isGemini ? geminiWindows : claudeGptWindows;
            if (!targetList.some((w) => w.id === winId)) {
              targetList.push({
                id: winId,
                label: cleanLabel,
                subtitle,
                usedPercent: 100 - rem,
                remainingPercent: rem,
                quotaKind: "usage",
                resetAt,
                barType: "circle",
                status: rem <= 0 ? "exhausted" : "active",
                rawFraction: frac,
                windowKind: isWeekly ? "weekly" : is5Hour ? "5h" : "unknown",
                bucketId: id,
                modelFamily: isArgon ? "gemini-4-argon" : isGemini ? "gemini" : "claude"
              });
            }
          }
          if (geminiWindows.length > 0) groups.push({ id: "antigravity-pool-gemini", title: "Gemini Models", poolType: "gemini", hasInfoIcon: true, windows: geminiWindows });
          if (claudeGptWindows.length > 0) groups.push({ id: "antigravity-pool-claude", title: "Claude and GPT models", poolType: "claude_gpt", hasInfoIcon: true, windows: claudeGptWindows });
          if (argonWindows.length > 0) {
            groups.push({ id: "antigravity-pool-argon", title: "Gemini 4 Argon", poolType: "argon", hasInfoIcon: true, windows: argonWindows });
          }
        }
        usedModelFallback = groups.length > 0;
      }
      const endpointForProvenance = successfulEndpoint || summaryEndpoints[0];
      let provenanceHost;
      try {
        provenanceHost = new URL(endpointForProvenance).hostname;
      } catch {
      }
      if (groups.length === 0 && lastFetchErr) {
        throw new Error(`无法获取额度明细 (${lastFetchErr})。若处于受限网络，请在设置中配置 HTTP 代理。`);
      }
      if (groups.length === 0) {
        return {
          card: {
            id: cardId,
            name: cardName,
            provider: "antigravity",
            category: this.category,
            status: "ok",
            plan: summaryData?.plan || void 0,
            account: accountEmail,
            groups: [
              {
                id: "antigravity-no-data",
                title: "额度数据不可用",
                hasInfoIcon: true,
                poolType: "general",
                windows: [
                  {
                    id: "antigravity-unknown",
                    label: "额度数据",
                    subtitle: "上游未返回任何额度分组，无法量化",
                    quotaKind: "unknown",
                    status: "unknown",
                    barType: "circle"
                  }
                ]
              }
            ],
            lastUpdated: Date.now(),
            sourceProvenance: {
              endpoint: endpointForProvenance,
              method: Array.isArray(summaryData?.groups) ? "official-summary" : "model-fallback",
              timestamp: Date.now(),
              partial: true,
              host: provenanceHost
            }
          }
        };
      }
      const quantified = groups.flatMap((g) => g.windows).filter(isQuantified);
      const isAnyLow = quantified.some((w) => w.remainingPercent <= (config.alarmThresholdPercent ?? 15));
      const cardStatus = isAnyLow ? "warn" : "ok";
      const planName = summaryData?.plan || void 0;
      const usedFallback = usedModelFallback;
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "antigravity",
          category: this.category,
          status: cardStatus,
          plan: planName,
          account: accountEmail,
          groups,
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: endpointForProvenance,
            method: usedFallback ? "model-fallback" : "official-summary",
            timestamp: Date.now(),
            partial: usedFallback,
            host: provenanceHost
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "antigravity",
          category: this.category,
          status: "error",
          account: tokenInfo.email || config.antigravity?.oauth?.email,
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
};

// src/providers/opencode-go.ts
function parseFinite4(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function clampPercent4(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function normalizeResetAt3(value) {
  if (value === void 0 || value === null || value === "") return void 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return void 0;
    const ms = value < 1e11 ? value * 1e3 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
  }
  if (typeof value === "string") {
    const parsed = parseFinite4(value);
    if (parsed !== void 0) return normalizeResetAt3(parsed);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
  }
  return void 0;
}
var OpenCodeGoProvider = class {
  name = "opencode_go";
  category = "official_cloud";
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const apiKey = (accountConfig?.apiKey || config.opencode_go?.apiKey)?.trim();
    const baseUrl = (accountConfig?.baseUrl || config.opencode_go?.baseUrl?.trim() || "https://opencode.ai").replace(/\/+$/, "");
    if (!apiKey) {
      return {
        ok: false,
        provider: "opencode_go",
        message: "未配置 API Key。请在「设置」中填入 OpenCode Go Key"
      };
    }
    try {
      const url = `${baseUrl}/zen/go/v1/usage`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0"
        },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          ok: true,
          provider: "opencode_go",
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`
        };
      }
      return {
        ok: false,
        provider: "opencode_go",
        latencyMs,
        message: res.status === 429 ? "请求被限流 (HTTP 429)，请稍后重试" : `API 响应异常: HTTP ${res.status}`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "opencode_go",
        latencyMs: Date.now() - start,
        message: `连接失败: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "opencode_go";
    const cardName = accountConfig?.name || "OpenCode Go";
    if (config.opencode_go?.enabled === false && accountConfig?.enabled === false) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "opencode_go",
          category: this.category,
          status: "disabled",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    const apiKey = (accountConfig?.apiKey || config.opencode_go?.apiKey)?.trim();
    const baseUrl = (accountConfig?.baseUrl || config.opencode_go?.baseUrl?.trim() || "https://opencode.ai").replace(/\/+$/, "");
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "opencode_go",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在「设置」中填入 OpenCode Go Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/zen/go/v1/usage`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0"
        },
        signal
      }, config.httpProxy, 12e3, config.proxyMode);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(res.status === 429 ? "OpenCode Go 接口限流 (HTTP 429)，请稍后重试" : `API 错误 (${res.status}): ${text.slice(0, 80)}`);
      }
      const data = await res.json();
      const usage = data?.usage && typeof data.usage === "object" ? data.usage : void 0;
      const buildWindow = (key, label, win, windowKind, isWeekly) => {
        if (!win || typeof win !== "object") return null;
        const resetAt = normalizeResetAt3(win.resetsAt);
        const rawPercent = parseFinite4(win.percent);
        if (rawPercent === void 0) {
          return {
            id: `opencode-${key}`,
            label,
            subtitle: "额度字段缺失 · 状态未知",
            quotaKind: "unknown",
            status: "unknown",
            resetAt,
            barType: "circle",
            windowKind
          };
        }
        const used = clampPercent4(rawPercent);
        const remaining = 100 - used;
        return {
          id: `opencode-${key}`,
          label,
          subtitle: formatQuotaResetText(resetAt, used, isWeekly),
          usedPercent: used,
          remainingPercent: remaining,
          quotaKind: "usage",
          resetAt,
          barType: "circle",
          status: remaining <= 0 ? "exhausted" : "active",
          windowKind
        };
      };
      const windows = [];
      const rolling = buildWindow("rolling", "5-Hour Rolling Limit", usage?.rolling, "sliding", false);
      if (rolling) windows.push(rolling);
      const weekly = buildWindow("weekly", "Weekly Limit", usage?.weekly, "weekly", true);
      if (weekly) windows.push(weekly);
      const monthly = buildWindow("monthly", "Monthly Limit", usage?.monthly, "monthly", true);
      if (monthly) windows.push(monthly);
      if (windows.length === 0) {
        windows.push({
          id: "opencode-usage",
          label: "OpenCode Go 用量",
          subtitle: "上游未返回用量字段，无法量化",
          quotaKind: "unknown",
          status: "unknown",
          barType: "circle",
          windowKind: "unknown"
        });
      }
      const quantified = windows.filter(isQuantified);
      const lowestRemaining = quantified.length > 0 ? Math.min(...quantified.map((w) => w.remainingPercent)) : void 0;
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "opencode_go",
          category: this.category,
          status: lowestRemaining !== void 0 && lowestRemaining <= (config.alarmThresholdPercent ?? 15) ? "warn" : "ok",
          plan: "Go Plan",
          groups: [
            {
              title: "OpenCode Go Plan Limits",
              hasInfoIcon: true,
              windows
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "official-summary",
            timestamp: Date.now(),
            partial: quantified.length < windows.length
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "opencode_go",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
};

// src/providers/deepseek.ts
var USER_AGENT = `dsh-quota/${PLUGIN_VERSION}`;
function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function currencySymbol(currency) {
  if (currency === "USD") return "$";
  if (currency === "CNY") return "¥";
  return `${currency} `;
}
function retryAfterText(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限或 IP 受限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var DeepSeekProvider = class {
  name = "deepseek";
  category = "domestic_llm";
  resolveKey(config, accountConfig) {
    let apiKey = (accountConfig && accountConfig.apiKey !== void 0 ? accountConfig.apiKey : config.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || "").trim();
    apiKey = apiKey.replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.deepseek?.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  parseBalances(data) {
    const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
    const parsed = [];
    for (const info of infos) {
      const amount = parseAmount(info?.total_balance);
      if (amount === null) continue;
      const currency = (info?.currency || "CNY").toUpperCase();
      parsed.push({
        currency,
        amount,
        granted: parseAmount(info?.granted_balance),
        toppedUp: parseAmount(info?.topped_up_balance)
      });
    }
    return parsed;
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "deepseek",
        message: "未配置 DeepSeek API Key。请在「设置」中填入 Key"
      };
    }
    try {
      const url = `${baseUrl}/user/balance`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT
        },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          provider: "deepseek",
          latencyMs,
          message: `验证失败: ${httpErrorText(res)}`
        };
      }
      const data = await res.json();
      const balances = this.parseBalances(data);
      const summary = balances.length > 0 ? balances.map((b) => `${currencySymbol(b.currency)}${b.amount.toFixed(2)} ${b.currency}`).join(" / ") : "余额字段缺失";
      return {
        ok: true,
        provider: "deepseek",
        latencyMs,
        account: `余额: ${summary}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ${summary})`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "deepseek",
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "deepseek";
    const cardName = accountConfig?.name || config.customNames?.deepseek || config.deepseek?.name || "DeepSeek";
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "deepseek",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在「设置」中填入 DeepSeek API Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/user/balance`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT
        },
        signal
      }, config.httpProxy, 15e3, config.proxyMode);
      if (!res.ok) {
        throw new Error(`DeepSeek 余额接口异常: ${httpErrorText(res)}`);
      }
      const data = await res.json();
      const balances = this.parseBalances(data);
      const primary = balances.find((b) => b.currency === "CNY") || balances[0];
      const windows = balances.length > 0 ? balances.map((b) => {
        const symbol = currencySymbol(b.currency);
        const subtitleParts = [];
        if (b.toppedUp !== null) subtitleParts.push(`充值: ${symbol}${b.toppedUp.toFixed(2)}`);
        if (b.granted !== null) subtitleParts.push(`赠送: ${symbol}${b.granted.toFixed(2)}`);
        return {
          id: `deepseek-balance-${b.currency.toLowerCase()}`,
          label: `可用余额 (${b.currency})`,
          subtitle: subtitleParts.join(" · "),
          quotaKind: "balance",
          barType: "balance",
          amountText: `${symbol}${b.amount.toFixed(2)}`,
          status: b.amount <= 0 ? "exhausted" : "active"
        };
      }) : [{
        id: "deepseek-balance",
        label: "可用余额",
        subtitle: "上游未返回可解析的余额条目",
        quotaKind: "unknown",
        barType: "balance",
        status: "unknown"
      }];
      let status = "ok";
      if (data.is_available === false) status = "warn";
      else if (!primary) status = "warn";
      else if (primary.amount <= 5) status = "warn";
      const accountSummary = balances.length > 0 ? balances.map((b) => `${currencySymbol(b.currency)}${b.amount.toFixed(2)} ${b.currency}`).join(" · ") : void 0;
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "deepseek",
          category: this.category,
          status,
          plan: balances.length > 1 ? "DeepSeek 官方平台 (多币种)" : "DeepSeek 官方平台",
          account: accountSummary,
          balance: primary ? {
            currency: primary.currency === "USD" ? "USD" : "CNY",
            total: primary.amount,
            remaining: primary.amount,
            grantedBalance: primary.granted ?? void 0,
            toppedUpBalance: primary.toppedUp ?? void 0
          } : void 0,
          groups: [
            {
              id: "deepseek-balance-group",
              title: "账户余额",
              hasInfoIcon: true,
              poolType: "general",
              windows
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "user-balance",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl)
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "deepseek",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "api.deepseek.com";
    }
  }
};

// src/providers/copilot.ts
import { existsSync as existsSync5, readFileSync as readFileSync2 } from "node:fs";
var USER_AGENT2 = `dsh-quota/${PLUGIN_VERSION}`;
var COPILOT_SKUS = /* @__PURE__ */ new Set([
  "free_plan",
  "individual",
  "business",
  "enterprise",
  "pro",
  "pro_plus",
  "copilot_free",
  "copilot_individual",
  "copilot_for_individual",
  "copilot_business",
  "copilot_enterprise"
]);
function isCopilotSku(sku) {
  if (typeof sku !== "string") return false;
  const normalized = sku.trim().toLowerCase();
  if (normalized === "") return false;
  return COPILOT_SKUS.has(normalized) || normalized.includes("copilot");
}
function retryAfterText2(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText2(res) {
  if (res.status === 429) return `GitHub 接口限流 (HTTP 429${retryAfterText2(res)})`;
  if (res.status === 401) return "GitHub Token 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var GitHubCopilotProvider = class {
  name = "github_copilot";
  category = "ide";
  findLocalToken() {
    const paths = getHomeConfigPaths("github-copilot", "hosts.json");
    for (const p of paths) {
      if (!existsSync5(p)) continue;
      try {
        const raw = readFileSync2(p, "utf8");
        const data = JSON.parse(raw);
        for (const val of Object.values(data)) {
          if (val?.oauth_token) return val.oauth_token;
        }
      } catch {
      }
    }
    return null;
  }
  resolveToken(config, accountConfig) {
    const direct = (accountConfig?.apiKey || accountConfig?.sessionToken || config.github_copilot?.token)?.trim();
    if (direct) return direct;
    if (config.github_copilot?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      return this.findLocalToken();
    }
    return null;
  }
  headers(token) {
    return {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": USER_AGENT2,
      "X-GitHub-Api-Version": "2022-11-28",
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot/1.155.0"
    };
  }
  livenessCard(cardId, cardName, status, message, account, plan, url) {
    return {
      id: cardId,
      name: cardName,
      provider: "github_copilot",
      category: this.category,
      status,
      plan,
      account,
      error: message,
      groups: [
        {
          title: "Copilot 订阅与连通性",
          windows: [
            {
              id: "copilot-status",
              label: "Copilot 订阅连通性",
              subtitle: `${message} · 仅连通性检查 (未提供额度接口)`,
              // No percentages until a Copilot entitlement is actually confirmed.
              quotaKind: "liveness",
              barType: "circle",
              status: "unknown"
            }
          ]
        }
      ],
      lastUpdated: Date.now(),
      sourceProvenance: {
        endpoint: url,
        method: "model-fallback",
        timestamp: Date.now(),
        host: "api.github.com",
        partial: true
      }
    };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const token = this.resolveToken(config, accountConfig);
    if (!token) {
      return {
        ok: false,
        provider: "github_copilot",
        message: "未找到 GitHub Copilot 凭据。请在设置中配置 Token 或确保本地 Copilot 已登录"
      };
    }
    try {
      const tokenUrl = "https://api.github.com/copilot_internal/v2/token";
      const res = await fetchWithProxy(tokenUrl, {
        headers: this.headers(token),
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          provider: "github_copilot",
          latencyMs,
          message: `验证失败: ${httpErrorText2(res)}`
        };
      }
      let info = {};
      try {
        info = await res.json();
      } catch {
        info = {};
      }
      if (!isCopilotSku(info?.sku)) {
        return {
          ok: false,
          provider: "github_copilot",
          latencyMs,
          message: `GitHub Token 有效，但未检测到 Copilot 订阅 (sku: ${info?.sku || "缺失"})`
        };
      }
      return {
        ok: true,
        provider: "github_copilot",
        latencyMs,
        account: `Copilot ${info.sku}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 订阅: ${info.sku}, 仅连通性检查 · 未提供额度接口)`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "github_copilot",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "github_copilot";
    const cardName = accountConfig?.name || "GitHub Copilot";
    const token = this.resolveToken(config, accountConfig);
    if (!token) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "github_copilot",
          category: this.category,
          status: "disabled",
          error: "未连接 Copilot。请在设置中配置 GitHub Token 或登录 Copilot 插件",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const headers = this.headers(token);
      const userUrl = "https://api.github.com/user";
      const tokenUrl = "https://api.github.com/copilot_internal/v2/token";
      const [userRes, copilotRes] = await Promise.all([
        fetchWithProxy(userUrl, { headers, signal }, config.httpProxy, 1e4, config.proxyMode),
        fetchWithProxy(tokenUrl, { headers, signal }, config.httpProxy, 1e4, config.proxyMode)
      ]);
      let user = {};
      if (userRes.ok) {
        try {
          user = await userRes.json();
        } catch {
          user = {};
        }
      }
      const account = user.login || user.email;
      if (!copilotRes.ok) {
        const message = `未检测到 Copilot 订阅 (${httpErrorText2(copilotRes)})`;
        if (copilotRes.status === 401 || copilotRes.status === 429) {
          throw new Error(httpErrorText2(copilotRes));
        }
        return {
          card: this.livenessCard(cardId, cardName, "warn", message, account, "Copilot 未确认", tokenUrl)
        };
      }
      let info = {};
      try {
        info = await copilotRes.json();
      } catch {
        info = {};
      }
      const sku = typeof info?.sku === "string" ? info.sku.trim() : "";
      if (!isCopilotSku(sku)) {
        const message = `已连接 GitHub，但未确认 Copilot 订阅 (sku: ${sku || "缺失"})`;
        return {
          card: this.livenessCard(cardId, cardName, "warn", message, account, "Copilot 未确认", tokenUrl)
        };
      }
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "github_copilot",
          category: this.category,
          status: "ok",
          plan: `Copilot ${sku}`,
          account,
          groups: [
            {
              title: "Copilot 订阅与连通性",
              windows: [
                {
                  id: "copilot-status",
                  label: "Copilot 订阅连通性",
                  subtitle: `已连接 Copilot (${sku}) · 仅连通性检查 (未提供额度接口)`,
                  // Copilot does not expose an account quota endpoint to this plugin:
                  // connectivity is the only fact we can report.
                  quotaKind: "liveness",
                  barType: "circle",
                  status: "unknown"
                }
              ]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: tokenUrl,
            method: "model-fallback",
            timestamp: Date.now(),
            host: "api.github.com",
            partial: true
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "github_copilot",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
};

// src/core/net-guard.ts
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
var BLOCKED_SUFFIXES = [".internal", ".local", ".localhost", ".home.arpa"];
var BLOCKED_HOSTS = /* @__PURE__ */ new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal"
]);
var UnsafeRemoteUrlError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeRemoteUrlError";
  }
};
function stripBrackets(host) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
function isLinkLocalV4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 169 && parts[1] === 254;
}
function isLoopbackV4(address) {
  return address.startsWith("127.");
}
function isLoopbackV6(address) {
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
}
function isLinkLocalV6(address) {
  const normalized = address.toLowerCase();
  return /^fe[89ab][0-9a-f]:/.test(normalized) || normalized === "fd00:ec2::254";
}
function isNeverUsable(address) {
  return address === "0.0.0.0" || address === "::" || address === "[::]";
}
async function assertAddressAllowed(address, options) {
  const clean = stripBrackets(address);
  if (isNeverUsable(clean)) throw new UnsafeRemoteUrlError(`拒绝不可用的地址: ${clean}`);
  if (isLinkLocalV4(clean) || isLinkLocalV6(clean)) {
    throw new UnsafeRemoteUrlError(`拒绝链路本地/云元数据地址: ${clean}`);
  }
  const allowLoopback = options.allowLoopback !== false;
  if (!allowLoopback && (isLoopbackV4(clean) || isLoopbackV6(clean))) {
    throw new UnsafeRemoteUrlError(`拒绝回环地址: ${clean}`);
  }
}
async function assertSafeRemoteUrl(raw, options = {}) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw new UnsafeRemoteUrlError("地址为空");
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeRemoteUrlError(`地址格式无效: ${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeRemoteUrlError(`只支持 http/https: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UnsafeRemoteUrlError("地址中不得内嵌用户名/密码");
  }
  const hostname = stripBrackets(url.hostname).toLowerCase();
  if (BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UnsafeRemoteUrlError(`拒绝该主机: ${hostname}`);
  }
  if (isIP(hostname)) {
    await assertAddressAllowed(hostname, options);
    return url;
  }
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (error) {
    throw new UnsafeRemoteUrlError(`无法解析主机 ${hostname}: ${error?.message ?? error}`);
  }
  if (addresses.length === 0) throw new UnsafeRemoteUrlError(`无法解析主机 ${hostname}`);
  for (const entry of addresses) {
    const address = entry.address;
    if (isNeverUsable(address)) throw new UnsafeRemoteUrlError(`拒绝不可用的地址: ${address}`);
    if (isLinkLocalV4(address) || isLinkLocalV6(address)) {
      throw new UnsafeRemoteUrlError(`主机 ${hostname} 解析到链路本地/云元数据地址 ${address}`);
    }
  }
  return url;
}

// src/providers/openai-billing.ts
function parseFinite5(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function clampPercent5(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function round2(value) {
  return Math.round(value * 100) / 100;
}
function money(value) {
  return `$${value.toFixed(2)}`;
}
function sumOrganizationCosts(payload) {
  if (!payload || !Array.isArray(payload.data)) return void 0;
  if (payload.has_more === true) return void 0;
  let total = 0;
  let sawAmount = false;
  for (const bucket of payload.data) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      const value = parseFinite5(result?.amount?.value);
      if (value !== void 0) {
        total += value;
        sawAmount = true;
      }
    }
  }
  return sawAmount ? round2(total) : void 0;
}
function dashboardUsageUsd(payload) {
  const cents = parseFinite5(payload?.total_usage);
  return cents !== void 0 ? round2(cents / 100) : void 0;
}
var OpenAIBillingProvider = class {
  name = "openai_billing";
  category = "official_cloud";
  resolveKey(config, accountConfig) {
    let apiKey = "";
    if (accountConfig && accountConfig.apiKey !== void 0) apiKey = accountConfig.apiKey;
    else if (config.openai_billing && config.openai_billing.apiKey !== void 0) apiKey = config.openai_billing.apiKey;
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.openai_billing?.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return void 0;
    }
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "openai_billing",
        message: "未配置 OpenAI API Key。请在「设置」中填入 Key"
      };
    }
    try {
      await assertSafeRemoteUrl(baseUrl);
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          ok: true,
          provider: "openai_billing",
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`
        };
      }
      return {
        ok: false,
        provider: "openai_billing",
        latencyMs,
        message: `验证失败: HTTP ${res.status}`
      };
    } catch (err) {
      const unsafe = err instanceof UnsafeRemoteUrlError;
      return {
        ok: false,
        provider: "openai_billing",
        latencyMs: Date.now() - start,
        message: unsafe ? `Base URL 校验失败: ${err.message}` : `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "openai_billing";
    const cardName = accountConfig?.name || "OpenAI Platform (API)";
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "openai_billing",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在设置中填入 OpenAI API Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      await assertSafeRemoteUrl(baseUrl);
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
      const now = Date.now();
      const startTime = Math.floor((now - 30 * 24 * 60 * 60 * 1e3) / 1e3);
      const endDate = new Date(now).toISOString().slice(0, 10);
      const startDate = new Date(now - 30 * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
      const modelsUrl = `${baseUrl}/v1/models`;
      const costsUrl = `${baseUrl}/v1/organization/costs?start_time=${startTime}&bucket_width=1d&limit=31`;
      const usageUrl = `${baseUrl}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`;
      const [modelsRes, subRes, costsRes, usageRes] = await Promise.allSettled([
        fetchWithProxy(modelsUrl, { headers, signal }, config.httpProxy, 1e4, config.proxyMode),
        fetchWithProxy(`${baseUrl}/v1/dashboard/billing/subscription`, { headers, signal }, config.httpProxy, 1e4, config.proxyMode),
        fetchWithProxy(costsUrl, { headers, signal }, config.httpProxy, 1e4, config.proxyMode),
        fetchWithProxy(usageUrl, { headers, signal }, config.httpProxy, 1e4, config.proxyMode)
      ]);
      if (modelsRes.status === "rejected" || modelsRes.status === "fulfilled" && !modelsRes.value.ok) {
        const err = modelsRes.status === "fulfilled" ? `HTTP ${modelsRes.value.status}` : modelsRes.reason?.message;
        throw new Error(`OpenAI Key 验证失败: ${err}`);
      }
      let hardLimit;
      if (subRes.status === "fulfilled" && subRes.value.ok) {
        try {
          const subData = await subRes.value.json();
          hardLimit = parseFinite5(subData.hard_limit_usd) ?? parseFinite5(subData.system_hard_limit_usd);
        } catch {
        }
      }
      let usedUsd;
      let usageSource;
      if (costsRes.status === "fulfilled" && costsRes.value.ok) {
        try {
          const costsData = await costsRes.value.json();
          usedUsd = sumOrganizationCosts(costsData);
          if (usedUsd !== void 0) usageSource = costsUrl;
        } catch {
        }
      }
      if (usedUsd === void 0 && usageRes.status === "fulfilled" && usageRes.value.ok) {
        try {
          const usageData = await usageRes.value.json();
          usedUsd = dashboardUsageUsd(usageData);
          if (usedUsd !== void 0) usageSource = usageUrl;
        } catch {
        }
      }
      const ratioKnown = hardLimit !== void 0 && hardLimit > 0 && usedUsd !== void 0;
      let usedPercent;
      let remainingPercent;
      let remainingUsd;
      if (ratioKnown) {
        remainingUsd = round2(Math.max(0, hardLimit - usedUsd));
        usedPercent = clampPercent5(usedUsd / hardLimit * 100);
        remainingPercent = 100 - usedPercent;
      }
      const threshold = config.alarmThresholdPercent ?? 15;
      let subtitle;
      if (ratioKnown) {
        subtitle = `总限额 ${money(hardLimit)} · 已用 ${money(usedUsd)} · 剩余 ${money(remainingUsd)}`;
      } else if (hardLimit !== void 0 && hardLimit > 0) {
        subtitle = `总限额 ${money(hardLimit)} · 无法获取用量（需 Admin Key 或计费权限）`;
      } else if (usedUsd !== void 0) {
        subtitle = `已用 ${money(usedUsd)} · 未获取到有效限额`;
      } else if (hardLimit !== void 0) {
        subtitle = "API Key 有效 · 上游返回的限额为 0，无法量化";
      } else {
        subtitle = "API Key 有效 · 官方未开放余额查询";
      }
      const window = ratioKnown ? {
        id: "openai-api-limit",
        label: "API Key 可用状态",
        subtitle,
        usedPercent,
        remainingPercent,
        quotaKind: "usage",
        barType: "circle",
        status: remainingPercent <= 0 ? "exhausted" : "active"
      } : {
        id: "openai-api-limit",
        label: "API Key 可用状态",
        subtitle,
        quotaKind: "unknown",
        barType: "circle",
        status: "unknown"
      };
      const balance = ratioKnown ? { currency: "USD", total: hardLimit, used: usedUsd, remaining: remainingUsd } : hardLimit !== void 0 ? { currency: "USD", total: hardLimit } : usedUsd !== void 0 ? { currency: "USD", used: usedUsd } : void 0;
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "openai_billing",
          category: this.category,
          status: ratioKnown && remainingPercent <= threshold ? "warn" : "ok",
          plan: "OpenAI API",
          balance,
          groups: [
            {
              id: "openai-billing-group",
              title: "OpenAI 额度监控",
              hasInfoIcon: true,
              poolType: "general",
              windows: [window]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: usageSource ?? modelsUrl,
            method: "oauth-api",
            timestamp: Date.now(),
            partial: !ratioKnown,
            host: this.hostOf(baseUrl)
          }
        }
      };
    } catch (err) {
      const unsafe = err instanceof UnsafeRemoteUrlError;
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "openai_billing",
          category: this.category,
          status: "error",
          error: unsafe ? `Base URL 被安全策略拒绝: ${err.message}` : err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
};

// src/providers/claude.ts
var USER_AGENT3 = `dsh-quota/${PLUGIN_VERSION}`;
function retryAfterText3(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText3(res) {
  if (res.status === 429) return `Anthropic 接口限流 (HTTP 429${retryAfterText3(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
function parseHeaderCount(raw) {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
var ClaudeProvider = class {
  name = "claude";
  category = "official_cloud";
  resolveTarget(config, accountConfig) {
    let apiKey = (accountConfig?.apiKey !== void 0 ? accountConfig.apiKey : config.claude?.apiKey || "").trim();
    const baseUrl = (accountConfig?.baseUrl || config.claude?.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "claude",
        message: "未配置 Anthropic API Key (sk-ant-...)"
      };
    }
    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          Accept: "application/json",
          "User-Agent": USER_AGENT3
        },
        redirect: "error",
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          ok: true,
          provider: "claude",
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms, 仅连通性检查 · 未提供额度接口)`
        };
      }
      return {
        ok: false,
        provider: "claude",
        latencyMs,
        message: `验证失败: ${httpErrorText3(res)}`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "claude",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "claude";
    const cardName = accountConfig?.name || "Anthropic Claude";
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "claude",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在设置中填入 Anthropic API Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/v1/models`;
      const res = await fetchWithProxy(url, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          Accept: "application/json",
          "User-Agent": USER_AGENT3
        },
        redirect: "error",
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      if (!res.ok) {
        throw new Error(`Claude API 验证失败: ${httpErrorText3(res)}`);
      }
      const reqRemaining = parseHeaderCount(res.headers.get("anthropic-ratelimit-requests-remaining"));
      const reqLimit = parseHeaderCount(res.headers.get("anthropic-ratelimit-requests-limit"));
      const hasRateHeaders = reqRemaining !== null && reqLimit !== null && reqLimit > 0;
      const window = hasRateHeaders ? {
        id: "claude-active",
        label: "速率余量 (非账户额度)",
        subtitle: `速率余量: ${reqRemaining}/${reqLimit} 请求 · 非账户额度 · 仅连通性检查`,
        quotaKind: "liveness",
        barType: "circle",
        status: "unknown",
        windowKind: "sliding"
      } : {
        id: "claude-active",
        label: "API Key 连通性",
        subtitle: "仅连通性检查 · 未提供额度接口",
        quotaKind: "liveness",
        barType: "circle",
        status: "unknown"
      };
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "claude",
          category: this.category,
          status: "ok",
          plan: "Anthropic Claude",
          groups: [
            {
              title: "Claude 账户连通性",
              hasInfoIcon: true,
              windows: [window]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "model-fallback",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl),
            partial: true
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "claude",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "api.anthropic.com";
    }
  }
};

// src/providers/kimi.ts
var USER_AGENT4 = `dsh-quota/${PLUGIN_VERSION}`;
function parseAmount2(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function retryAfterText4(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText4(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText4(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var KimiProvider = class {
  name = "kimi";
  category = "domestic_llm";
  resolveKey(config, accountConfig) {
    let apiKey = "";
    if (accountConfig && accountConfig.apiKey !== void 0) apiKey = accountConfig.apiKey;
    else if (config.kimi && config.kimi.apiKey !== void 0) apiKey = config.kimi.apiKey;
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.kimi?.baseUrl || "https://api.moonshot.cn").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "kimi",
        message: "未配置 Kimi / Moonshot API Key"
      };
    }
    try {
      const url = `${baseUrl}/v1/users/me/balance`;
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT4 },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          provider: "kimi",
          latencyMs,
          message: `验证失败: ${httpErrorText4(res)}`
        };
      }
      const json = await res.json();
      const available = parseAmount2(json?.data?.available_balance);
      const summary = available !== null ? `¥${available.toFixed(2)} CNY` : "余额字段缺失";
      return {
        ok: true,
        provider: "kimi",
        latencyMs,
        account: `可用余额: ${summary}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ${summary})`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "kimi",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "kimi";
    const cardName = accountConfig?.name || "Moonshot Kimi";
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "kimi",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在设置中填入 Kimi (Moonshot) Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/v1/users/me/balance`;
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT4 },
        signal
      }, config.httpProxy, 15e3, config.proxyMode);
      if (!res.ok) {
        throw new Error(`Kimi 余额接口异常: ${httpErrorText4(res)}`);
      }
      const json = await res.json();
      const data = json?.data || {};
      const available = parseAmount2(data.available_balance);
      const cash = parseAmount2(data.cash_balance);
      const voucher = parseAmount2(data.voucher_balance);
      const subtitleParts = [];
      if (cash !== null) subtitleParts.push(`充值: ¥${cash.toFixed(2)}`);
      if (voucher !== null) subtitleParts.push(`赠金: ¥${voucher.toFixed(2)}`);
      const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : "上游未返回余额明细";
      const window = available !== null ? {
        id: "kimi-balance",
        label: "账户总可用余额 (CNY)",
        subtitle,
        quotaKind: "balance",
        barType: "balance",
        amountText: `¥${available.toFixed(2)}`,
        status: available <= 0 ? "exhausted" : "active"
      } : {
        id: "kimi-balance",
        label: "账户总可用余额 (CNY)",
        subtitle: `余额字段缺失或无法解析${subtitleParts.length > 0 ? ` · ${subtitle}` : ""}`,
        quotaKind: "unknown",
        barType: "balance",
        status: "unknown"
      };
      let status = "ok";
      if (available === null) status = "warn";
      else if (available <= 0) status = "warn";
      else if (available <= 5) status = "warn";
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "kimi",
          category: this.category,
          status,
          plan: "Moonshot API",
          account: available !== null ? `¥${available.toFixed(2)} CNY` : void 0,
          balance: available !== null ? {
            currency: "CNY",
            total: available,
            remaining: available,
            grantedBalance: voucher ?? void 0,
            toppedUpBalance: cash ?? void 0
          } : void 0,
          groups: [
            {
              title: "Kimi 账户余额",
              windows: [window]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "user-balance",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl)
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "kimi",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "api.moonshot.cn";
    }
  }
};

// src/providers/glm.ts
var USER_AGENT5 = `dsh-quota/${PLUGIN_VERSION}`;
function retryAfterText5(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText5(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText5(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var GLMProvider = class {
  name = "glm";
  category = "domestic_llm";
  resolveKey(config, accountConfig) {
    let apiKey = "";
    if (accountConfig && accountConfig.apiKey !== void 0) apiKey = accountConfig.apiKey;
    else if (config.glm && config.glm.apiKey !== void 0) apiKey = config.glm.apiKey;
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.glm?.baseUrl || "https://open.bigmodel.cn").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "glm",
        message: "未配置智谱 GLM API Key"
      };
    }
    try {
      const res = await fetchWithProxy(`${baseUrl}/api/paas/v4/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT5 },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          ok: true,
          provider: "glm",
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms, 仅连通性检查 · 未提供额度接口)`
        };
      }
      return {
        ok: false,
        provider: "glm",
        latencyMs,
        message: `验证失败: ${httpErrorText5(res)}`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "glm",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "glm";
    const cardName = accountConfig?.name || "智谱清言 (GLM)";
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "glm",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在设置中填入智谱 GLM API Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/api/paas/v4/models`;
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT5 },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      if (!res.ok) {
        throw new Error(`智谱 API 验证失败: ${httpErrorText5(res)}`);
      }
      let modelCount = 0;
      try {
        const data = await res.json();
        modelCount = Array.isArray(data?.data) ? data.data.length : 0;
      } catch {
        modelCount = 0;
      }
      const connectivity = modelCount > 0 ? `智谱在线 · 已就绪 ${modelCount} 个模型` : "智谱在线";
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "glm",
          category: this.category,
          status: "ok",
          plan: "BigModel GLM",
          groups: [
            {
              title: "GLM 平台连通性",
              windows: [
                {
                  id: "glm-status",
                  label: "GLM API 连通性",
                  subtitle: `${connectivity} · 仅连通性检查 (未提供额度接口)`,
                  // No quota endpoint: never invent a 0%/100% ratio.
                  quotaKind: "liveness",
                  barType: "circle",
                  status: "unknown"
                }
              ]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "model-fallback",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl),
            partial: true
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "glm",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "open.bigmodel.cn";
    }
  }
};

// src/providers/minimax.ts
var USER_AGENT6 = `dsh-quota/${PLUGIN_VERSION}`;
function retryAfterText6(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText6(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText6(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var MiniMaxProvider = class {
  name = "minimax";
  category = "domestic_llm";
  resolveKey(config, accountConfig) {
    let apiKey = "";
    if (accountConfig && accountConfig.apiKey !== void 0) apiKey = accountConfig.apiKey;
    else if (config.minimax && config.minimax.apiKey !== void 0) apiKey = config.minimax.apiKey;
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.minimax?.baseUrl || "https://api.minimax.chat").replace(/\/+$/, "");
    const groupId = accountConfig?.extra?.groupId || config.minimax?.groupId;
    return { apiKey, baseUrl, groupId };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "minimax",
        message: "未配置 MiniMax API Key"
      };
    }
    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT6 },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          ok: true,
          provider: "minimax",
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms, 仅连通性检查 · 未提供额度接口)`
        };
      }
      return {
        ok: false,
        provider: "minimax",
        latencyMs,
        message: `验证失败: ${httpErrorText6(res)}`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "minimax",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "minimax";
    const cardName = accountConfig?.name || "MiniMax (海螺)";
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "minimax",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在设置中填入 MiniMax API Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/v1/models`;
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT6 },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      if (!res.ok) {
        throw new Error(`MiniMax API 验证失败: ${httpErrorText6(res)}`);
      }
      let modelCount = 0;
      try {
        const data = await res.json();
        modelCount = Array.isArray(data?.data) ? data.data.length : 0;
      } catch {
        modelCount = 0;
      }
      const connectivity = modelCount > 0 ? `MiniMax 在线 · 已就绪 ${modelCount} 个模型` : "MiniMax 在线";
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "minimax",
          category: this.category,
          status: "ok",
          plan: "MiniMax OpenPlatform",
          groups: [
            {
              title: "MiniMax 账户连通性",
              windows: [
                {
                  id: "minimax-active",
                  label: "API Key 连通性",
                  subtitle: `${connectivity} · 仅连通性检查 (未提供额度接口)`,
                  // No quota endpoint: never invent a 0%/100% ratio.
                  quotaKind: "liveness",
                  barType: "circle",
                  status: "unknown"
                }
              ]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "model-fallback",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl),
            partial: true
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "minimax",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "api.minimax.chat";
    }
  }
};

// src/providers/qwen.ts
var USER_AGENT7 = `dsh-quota/${PLUGIN_VERSION}`;
function retryAfterText7(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText7(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText7(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var QwenProvider = class {
  name = "qwen";
  category = "domestic_llm";
  resolveKey(config, accountConfig) {
    let apiKey = "";
    if (accountConfig && accountConfig.apiKey !== void 0) apiKey = accountConfig.apiKey;
    else if (config.qwen && config.qwen.apiKey !== void 0) apiKey = config.qwen.apiKey;
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.qwen?.baseUrl || "https://dashscope.aliyuncs.com").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "qwen",
        message: "未配置通义千问 (DashScope) API Key"
      };
    }
    try {
      const res = await fetchWithProxy(`${baseUrl}/compatible-mode/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT7 },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        let count = 0;
        try {
          const data = await res.json();
          count = Array.isArray(data?.data) ? data.data.length : 0;
        } catch {
          count = 0;
        }
        return {
          ok: true,
          provider: "qwen",
          latencyMs,
          account: `阿里云 DashScope (${count} 个模型在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 在线模型: ${count}, 仅连通性检查 · 未提供额度接口)`
        };
      }
      return {
        ok: false,
        provider: "qwen",
        latencyMs,
        message: `验证失败: ${httpErrorText7(res)}`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "qwen",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "qwen";
    const cardName = accountConfig?.name || "阿里通义千问 (百炼)";
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "qwen",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在设置中填入 DashScope API Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/compatible-mode/v1/models`;
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT7 },
        signal
      }, config.httpProxy, 12e3, config.proxyMode);
      if (!res.ok) {
        throw new Error(`百炼 API 验证失败: ${httpErrorText7(res)}`);
      }
      let modelList = [];
      try {
        const data = await res.json();
        modelList = Array.isArray(data?.data) ? data.data.map((m) => String(m?.id ?? "")) : [];
      } catch {
        modelList = [];
      }
      const hasQwenMax = modelList.some((m) => m.includes("qwen-max"));
      const hasQwenPlus = modelList.some((m) => m.includes("qwen-plus"));
      const hasQwenCoder = modelList.some((m) => m.includes("qwen-coder") || m.includes("qwen-2.5-coder"));
      const families = [hasQwenMax ? "Max" : "", hasQwenPlus ? "Plus" : "", hasQwenCoder ? "Coder" : ""].filter(Boolean);
      const connectivity = families.length > 0 ? `百炼在线 · 支持 ${families.join(" ")}` : `百炼在线 · 已就绪 ${modelList.length} 个模型`;
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "qwen",
          category: this.category,
          status: "ok",
          plan: "DashScope 百炼",
          account: "DashScope Active",
          groups: [
            {
              title: "通义千问服务连通性",
              hasInfoIcon: true,
              windows: [
                {
                  id: "qwen-active",
                  label: "Qwen 全系模型连通性",
                  subtitle: `${connectivity} · 仅连通性检查 (未提供额度接口)`,
                  // No quota endpoint: never invent a 0%/100% ratio.
                  quotaKind: "liveness",
                  barType: "circle",
                  status: "unknown"
                }
              ]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "model-fallback",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl),
            partial: true
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "qwen",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "dashscope.aliyuncs.com";
    }
  }
};

// src/providers/volcengine.ts
var USER_AGENT8 = `dsh-quota/${PLUGIN_VERSION}`;
function retryAfterText8(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText8(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText8(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var VolcengineProvider = class {
  name = "volcengine";
  category = "domestic_llm";
  resolveKey(config, accountConfig) {
    let apiKey = "";
    if (accountConfig && accountConfig.apiKey !== void 0) apiKey = accountConfig.apiKey;
    else if (config.volcengine && config.volcengine.apiKey !== void 0) apiKey = config.volcengine.apiKey;
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.volcengine?.baseUrl || "https://ark.cn-beijing.volces.com").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "volcengine",
        message: "未配置火山方舟 API Key"
      };
    }
    try {
      const res = await fetchWithProxy(`${baseUrl}/api/v3/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT8 },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        let count = 0;
        try {
          const data = await res.json();
          count = Array.isArray(data?.data) ? data.data.length : 0;
        } catch {
          count = 0;
        }
        return {
          ok: true,
          provider: "volcengine",
          latencyMs,
          account: `火山方舟 (${count} 个接入点在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 接入点: ${count}, 仅连通性检查 · 未提供额度接口)`
        };
      }
      return {
        ok: false,
        provider: "volcengine",
        latencyMs,
        message: `验证失败: ${httpErrorText8(res)}`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "volcengine",
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "volcengine";
    const cardName = accountConfig?.name || "火山方舟 (豆包)";
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "volcengine",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在设置中填入火山方舟 API Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/api/v3/models`;
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT8 },
        signal
      }, config.httpProxy, 12e3, config.proxyMode);
      if (!res.ok) {
        throw new Error(`火山方舟 API 验证失败: ${httpErrorText8(res)}`);
      }
      let endpoints = 0;
      try {
        const data = await res.json();
        endpoints = Array.isArray(data?.data) ? data.data.length : 0;
      } catch {
        endpoints = 0;
      }
      const connectivity = endpoints > 0 ? `方舟在线 · 已授权 ${endpoints} 个推理接入点 (Endpoint)` : "火山方舟在线";
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "volcengine",
          category: this.category,
          status: "ok",
          plan: "Volcengine Ark",
          account: `${endpoints} Endpoints Active`,
          groups: [
            {
              title: "火山方舟服务连通性",
              hasInfoIcon: true,
              windows: [
                {
                  id: "volc-active",
                  label: "豆包与方舟推理接入点",
                  subtitle: `${connectivity} · 仅连通性检查 (未提供额度接口)`,
                  // No quota endpoint: never invent a 0%/100% ratio.
                  quotaKind: "liveness",
                  barType: "circle",
                  status: "unknown"
                }
              ]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "model-fallback",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl),
            partial: true
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "volcengine",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "ark.cn-beijing.volces.com";
    }
  }
};

// src/providers/siliconflow.ts
var USER_AGENT9 = `dsh-quota/${PLUGIN_VERSION}`;
function parseAmount3(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function retryAfterText9(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText9(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText9(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
var SiliconFlowProvider = class {
  name = "siliconflow";
  category = "domestic_llm";
  resolveTarget(config, accountConfig) {
    let apiKey = (accountConfig?.apiKey !== void 0 ? accountConfig.apiKey : config.siliconflow?.apiKey || process.env.SILICONFLOW_API_KEY || "").trim();
    apiKey = apiKey.replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.siliconflow?.baseUrl || "https://api.siliconflow.cn").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "siliconflow",
        message: "未配置 SiliconFlow API Key。请在「设置」中填入 Key"
      };
    }
    try {
      const url = `${baseUrl}/v1/user/info`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT9
        },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          provider: "siliconflow",
          latencyMs,
          message: `验证失败: ${httpErrorText9(res)}`
        };
      }
      const json = await res.json();
      const data = json?.data || {};
      const bal = parseAmount3(data.balance);
      const name = data.name || data.email || "SiliconFlow User";
      const summary = bal !== null ? `¥${bal.toFixed(2)} CNY` : "余额字段缺失";
      return {
        ok: true,
        provider: "siliconflow",
        latencyMs,
        account: `余额: ${summary} (${name})`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ${summary})`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "siliconflow",
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "siliconflow";
    const cardName = accountConfig?.name || config.customNames?.siliconflow || config.siliconflow?.name || "硅基流动 (SiliconFlow)";
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "siliconflow",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在「设置」中填入 SiliconFlow Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/v1/user/info`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT9
        },
        signal
      }, config.httpProxy, 12e3, config.proxyMode);
      if (!res.ok) {
        throw new Error(`硅基流动接口异常: ${httpErrorText9(res)}`);
      }
      const json = await res.json();
      const data = json?.data || {};
      const available = parseAmount3(data.balance);
      const charge = parseAmount3(data.chargeBalance);
      const total = parseAmount3(data.totalBalance);
      const subtitleParts = [];
      if (available !== null) subtitleParts.push(`可用额度: ¥${available.toFixed(2)} CNY`);
      if (charge !== null) subtitleParts.push(`充值金: ¥${charge.toFixed(2)}`);
      const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : "上游未返回余额字段";
      const window = available !== null ? {
        id: "siliconflow-balance",
        label: "账户可用余额",
        subtitle,
        quotaKind: "balance",
        barType: "balance",
        amountText: `¥${available.toFixed(2)} CNY`,
        status: available <= 0 ? "exhausted" : "active"
      } : {
        id: "siliconflow-balance",
        label: "账户可用余额",
        subtitle: `余额字段缺失或无法解析${subtitleParts.length > 0 ? ` · ${subtitle}` : ""}`,
        quotaKind: "unknown",
        barType: "balance",
        status: "unknown"
      };
      let status = "ok";
      if (available === null) status = "warn";
      else if (available <= 2) status = "warn";
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "siliconflow",
          category: this.category,
          status,
          plan: "SiliconFlow Cloud",
          account: data.name || data.email || void 0,
          balance: available !== null ? {
            currency: "CNY",
            total: total ?? void 0,
            remaining: available,
            toppedUpBalance: charge ?? void 0
          } : void 0,
          groups: [
            {
              title: "硅基流动账户余额",
              windows: [window]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "user-balance",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl)
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "siliconflow",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "api.siliconflow.cn";
    }
  }
};

// src/providers/openrouter.ts
var USER_AGENT10 = `dsh-quota/${PLUGIN_VERSION}`;
function parseAmount4(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function retryAfterText10(res) {
  const retryAfter = res.headers.get("retry-after");
  return retryAfter ? `, Retry-After: ${retryAfter}` : "";
}
function httpErrorText10(res) {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText10(res)})`;
  if (res.status === 401) return "API Key 无效或未授权 (HTTP 401)";
  if (res.status === 403) return "无访问权限 (HTTP 403)";
  return `HTTP ${res.status}`;
}
function clampPercent6(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function parseReset(value) {
  if (typeof value !== "string" || value.trim() === "") return void 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? void 0 : date.toISOString();
}
var OpenRouterProvider = class {
  name = "openrouter";
  category = "official_cloud";
  resolveTarget(config, accountConfig) {
    let apiKey = (accountConfig?.apiKey !== void 0 ? accountConfig.apiKey : config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || "").trim();
    apiKey = apiKey.replace(/^Bearer\s+/i, "");
    const baseUrl = (accountConfig?.baseUrl || config.openrouter?.baseUrl || "https://openrouter.ai/api").replace(/\/+$/, "");
    return { apiKey, baseUrl };
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "openrouter",
        message: "未配置 OpenRouter API Key。请在「设置」中填入 Key"
      };
    }
    try {
      const url = `${baseUrl}/v1/auth/key`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT10
        },
        signal
      }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          provider: "openrouter",
          latencyMs,
          message: `验证失败: ${httpErrorText10(res)}`
        };
      }
      const json = await res.json();
      const data = json.data || {};
      const label = data.label || "OpenRouter Key";
      const usage = parseAmount4(data.usage);
      const limit = typeof data.limit === "number" && Number.isFinite(data.limit) ? data.limit : null;
      const limitRemaining = parseAmount4(data.limit_remaining);
      const remaining = limit === null ? null : limitRemaining !== null ? Math.max(0, Math.min(limit, limitRemaining)) : usage !== null ? Math.max(0, limit - usage) : null;
      const limitStr = limit === null ? `已用: ${usage !== null ? `$${usage.toFixed(2)}` : "未知"} (无硬限额)` : `限额: $${limit.toFixed(2)}${remaining !== null ? ` (剩余 $${remaining.toFixed(2)})` : " (余量未知)"}`;
      return {
        ok: true,
        provider: "openrouter",
        latencyMs,
        account: `${label} · ${limitStr}`,
        message: `连接成功 (延迟: ${latencyMs}ms, ${limitStr})`
      };
    } catch (err) {
      return {
        ok: false,
        provider: "openrouter",
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const cardId = accountConfig?.id || "openrouter";
    const cardName = accountConfig?.name || config.customNames?.openrouter || config.openrouter?.name || "OpenRouter";
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig);
    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "openrouter",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请在「设置」中填入 OpenRouter Key",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      const url = `${baseUrl}/v1/auth/key`;
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT10
        },
        signal
      }, config.httpProxy, 12e3, config.proxyMode);
      if (!res.ok) {
        throw new Error(`OpenRouter 鉴权接口异常: ${httpErrorText10(res)}`);
      }
      const json = await res.json();
      const data = json.data || {};
      const usage = parseAmount4(data.usage);
      const rawLimit = data.limit;
      const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : rawLimit === null ? null : void 0;
      const limitRemaining = parseAmount4(data.limit_remaining);
      const resetAt = parseReset(data.limit_reset);
      const usageText = usage !== null ? `$${usage.toFixed(2)}` : "未知";
      let window;
      let status = "ok";
      let balance;
      if (limit === null) {
        window = {
          id: "openrouter-limit",
          label: "API 用量 (无硬限额)",
          subtitle: `无硬限额 · 已消耗 ${usageText} USD`,
          quotaKind: "balance",
          barType: "balance",
          amountText: usage !== null ? `已用 $${usage.toFixed(2)} USD` : void 0,
          status: "active"
        };
        balance = { currency: "USD", used: usage ?? void 0 };
      } else if (limit === 0) {
        window = {
          id: "openrouter-limit",
          label: "API 额度状态",
          subtitle: `密钥限额为 $0 · 配额状态未知${resetAt ? ` · 重置 ${resetAt}` : ""}`,
          quotaKind: "unknown",
          barType: "balance",
          status: "unknown"
        };
        status = "warn";
        balance = { currency: "USD", total: 0, used: usage ?? void 0 };
      } else if (limit === void 0) {
        window = {
          id: "openrouter-limit",
          label: "API 额度状态",
          subtitle: `上游未返回 limit 字段 · 额度状态未知 (已消耗 ${usageText})`,
          quotaKind: "unknown",
          barType: "balance",
          status: "unknown"
        };
        balance = { currency: "USD", used: usage ?? void 0 };
      } else {
        const remainingAmount = limitRemaining !== null ? Math.max(0, Math.min(limit, limitRemaining)) : usage !== null ? Math.max(0, limit - usage) : null;
        if (remainingAmount === null) {
          window = {
            id: "openrouter-limit",
            label: "API 额度状态",
            subtitle: `限额 $${limit.toFixed(2)} 已确认，但用量/余量字段缺失`,
            quotaKind: "unknown",
            barType: "balance",
            status: "unknown"
          };
          balance = { currency: "USD", total: limit };
        } else {
          const remainingPercent = clampPercent6(remainingAmount / limit * 100);
          const usedPercent = 100 - remainingPercent;
          window = {
            id: "openrouter-limit",
            label: "API 额度限制",
            subtitle: `限额 $${limit.toFixed(2)} · 剩余 $${remainingAmount.toFixed(2)}`,
            quotaKind: "usage",
            usedPercent,
            remainingPercent,
            resetAt,
            barType: "circle",
            status: remainingAmount <= 0 ? "exhausted" : "active",
            amountText: `剩余 $${remainingAmount.toFixed(2)} / 限额 $${limit.toFixed(2)}`
          };
          balance = { currency: "USD", total: limit, used: usage ?? void 0, remaining: remainingAmount };
          if (remainingPercent <= 15) status = "warn";
        }
      }
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "openrouter",
          category: this.category,
          status,
          plan: data.is_free_tier ? "OpenRouter Free" : "OpenRouter Paid",
          account: data.label || void 0,
          balance,
          groups: [
            {
              title: "OpenRouter 配额状态",
              windows: [window]
            }
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: "user-balance",
            timestamp: Date.now(),
            host: this.hostOf(baseUrl)
          }
        }
      };
    } catch (err) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: "openrouter",
          category: this.category,
          status: "error",
          error: err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
  hostOf(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "openrouter.ai";
    }
  }
};

// src/providers/custom-api.ts
function parseFinite6(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function clampPercent7(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function round22(value) {
  return Math.round(value * 100) / 100;
}
function money2(value) {
  return `$${value.toFixed(2)}`;
}
var CustomApiProvider = class {
  name = "custom_api";
  category = "custom_api";
  resolveTarget(accountConfig) {
    const id = accountConfig?.id || "custom_api";
    const name = accountConfig?.name || "自定义 / OneAPI 中转";
    const apiKey = (accountConfig?.apiKey || "").trim();
    const baseUrl = (accountConfig?.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
    const balancePath = (accountConfig?.extra?.balancePath || accountConfig?.balancePath || "").trim();
    return { id, name, apiKey, baseUrl, balancePath };
  }
  /**
   * Interpret the balance/billing payloads that relays expose. Returns `null` when
   * the endpoint did not describe the account's quota at all.
   */
  parseBillingPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const total = parseFinite6(payload.hard_limit_usd) ?? parseFinite6(payload.system_hard_limit_usd) ?? parseFinite6(payload.total_granted);
    if (total !== void 0) {
      const directRemaining = parseFinite6(payload.total_available);
      const rawUsed = parseFinite6(payload.total_usage) ?? parseFinite6(payload.total_used);
      const remaining = directRemaining !== void 0 ? Math.max(0, round22(directRemaining)) : rawUsed !== void 0 ? Math.max(0, round22(total - rawUsed)) : void 0;
      const used = rawUsed ?? (remaining !== void 0 ? round22(total - remaining) : void 0);
      return { source: "billing", currency: "USD", total, used, remaining };
    }
    const data = payload.data;
    const rawRemainingQuota = parseFinite6(data?.quota);
    if (rawRemainingQuota !== void 0) {
      const remaining = round22(rawRemainingQuota / 5e5);
      const rawUsedQuota = parseFinite6(data?.used_quota);
      const used = rawUsedQuota !== void 0 ? round22(rawUsedQuota / 5e5) : void 0;
      const quotaTotal = used !== void 0 ? round22(remaining + used) : void 0;
      return { source: "oneapi-quota", currency: "USD", total: quotaTotal, used, remaining };
    }
    const balance = parseFinite6(data?.balance) ?? parseFinite6(data?.total_balance) ?? parseFinite6(payload.balance) ?? parseFinite6(payload.total_balance);
    if (balance !== void 0) {
      return { source: "balance", currency: "USD", remaining: balance };
    }
    return null;
  }
  async testConnection(config, accountConfig, signal) {
    const start = Date.now();
    const { apiKey, baseUrl, balancePath } = this.resolveTarget(accountConfig);
    if (!apiKey) {
      return {
        ok: false,
        provider: "custom_api",
        message: "未配置 API Key"
      };
    }
    try {
      await assertSafeRemoteUrl(baseUrl);
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
      const testUrl = balancePath ? `${baseUrl}${balancePath.startsWith("/") ? balancePath : "/" + balancePath}` : `${baseUrl}/v1/models`;
      const res = await fetchWithProxy(testUrl, { headers, signal }, config.httpProxy, 1e4, config.proxyMode);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          ok: true,
          provider: "custom_api",
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`
        };
      }
      return {
        ok: false,
        provider: "custom_api",
        latencyMs,
        message: `验证失败: HTTP ${res.status}`
      };
    } catch (err) {
      const unsafe = err instanceof UnsafeRemoteUrlError;
      return {
        ok: false,
        provider: "custom_api",
        latencyMs: Date.now() - start,
        message: unsafe ? `Base URL 校验失败: ${err.message}` : `请求异常: ${err.message}`
      };
    }
  }
  async fetchCard(config, accountConfig, signal) {
    const { id, name, apiKey, baseUrl, balancePath } = this.resolveTarget(accountConfig);
    if (!apiKey) {
      return {
        card: {
          id,
          name,
          provider: "custom_api",
          category: this.category,
          status: "disabled",
          error: "未配置 API Key。请填入中转站 Key 与 Base URL",
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
    try {
      await assertSafeRemoteUrl(baseUrl);
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
      const endpointsToFetch = [
        fetchWithProxy(`${baseUrl}/v1/models`, { headers, signal }, config.httpProxy, 1e4, config.proxyMode)
      ];
      if (balancePath) {
        endpointsToFetch.push(
          fetchWithProxy(`${baseUrl}${balancePath.startsWith("/") ? balancePath : "/" + balancePath}`, { headers, signal }, config.httpProxy, 8e3, config.proxyMode)
        );
      } else {
        endpointsToFetch.push(
          fetchWithProxy(`${baseUrl}/v1/dashboard/billing/subscription`, { headers, signal }, config.httpProxy, 8e3, config.proxyMode),
          fetchWithProxy(`${baseUrl}/api/user/self`, { headers, signal }, config.httpProxy, 8e3, config.proxyMode)
        );
      }
      const settled = await Promise.allSettled(endpointsToFetch);
      const modelsRes = settled[0];
      if (!modelsRes || modelsRes.status === "rejected" || modelsRes.status === "fulfilled" && !modelsRes.value.ok) {
        const err = modelsRes && modelsRes.status === "fulfilled" ? `HTTP ${modelsRes.value.status}` : modelsRes?.reason?.message || "网络异常";
        throw new Error(`API 验证失败: ${err}`);
      }
      let snapshot = null;
      for (let i = 1; i < settled.length; i++) {
        const subRes = settled[i];
        if (subRes && subRes.status === "fulfilled" && subRes.value.ok) {
          try {
            const subData = await subRes.value.json();
            const parsed = this.parseBillingPayload(subData);
            if (parsed) {
              snapshot = parsed;
              break;
            }
          } catch {
          }
        }
      }
      let ratio;
      if (snapshot?.total !== void 0 && snapshot.total > 0) {
        if (snapshot.used !== void 0) {
          const usedPercent = clampPercent7(snapshot.used / snapshot.total * 100);
          ratio = { usedPercent, remainingPercent: 100 - usedPercent };
        } else if (snapshot.remaining !== void 0) {
          const remainingPercent = clampPercent7(snapshot.remaining / snapshot.total * 100);
          ratio = { usedPercent: 100 - remainingPercent, remainingPercent };
        }
      }
      const windows = [];
      if (ratio && snapshot) {
        const parts = [`总额 ${money2(snapshot.total)}`];
        if (snapshot.used !== void 0) parts.push(`已用 ${money2(snapshot.used)}`);
        if (snapshot.remaining !== void 0) parts.push(`剩余 ${money2(snapshot.remaining)}`);
        windows.push({
          id: `${id}-quota`,
          label: "中转额度",
          subtitle: parts.join(" · "),
          usedPercent: ratio.usedPercent,
          remainingPercent: ratio.remainingPercent,
          quotaKind: "usage",
          barType: "circle",
          status: ratio.remainingPercent <= 0 ? "exhausted" : "active"
        });
      } else if (snapshot?.remaining !== void 0) {
        windows.push({
          id: `${id}-balance`,
          label: "中转余额",
          subtitle: snapshot.total !== void 0 ? `总额 ${money2(snapshot.total)} · 剩余 ${money2(snapshot.remaining)} · 用量未知` : `剩余 ${money2(snapshot.remaining)} · 总额未知`,
          quotaKind: "balance",
          amountText: money2(snapshot.remaining),
          barType: "balance",
          status: snapshot.remaining <= 0 ? "exhausted" : "active"
        });
      } else if (snapshot?.total !== void 0) {
        windows.push({
          id: `${id}-quota`,
          label: "中转额度",
          subtitle: `总限额 ${money2(snapshot.total)} · 用量未知`,
          quotaKind: "unknown",
          status: "unknown",
          barType: "circle"
        });
      } else {
        windows.push({
          id: `${id}-liveness`,
          label: "中转接口连通性",
          subtitle: "接口在线 · 未提供额度接口",
          quotaKind: "liveness",
          status: "unknown",
          barType: "circle"
        });
      }
      const threshold = config.alarmThresholdPercent ?? 15;
      const lowRatio = ratio !== void 0 && ratio.remainingPercent <= threshold;
      const emptyBalance = snapshot?.remaining !== void 0 && snapshot.remaining <= 0;
      const balance = snapshot ? { currency: snapshot.currency, total: snapshot.total, used: snapshot.used, remaining: snapshot.remaining } : void 0;
      return {
        card: {
          id,
          name,
          provider: "custom_api",
          category: this.category,
          status: lowRatio || emptyBalance ? "warn" : "ok",
          plan: "Custom / OneAPI",
          account: baseUrl.replace(/^https?:\/\//, ""),
          balance,
          groups: [
            {
              title: "API 中转站状态",
              windows
            }
          ],
          lastUpdated: Date.now()
        }
      };
    } catch (err) {
      const unsafe = err instanceof UnsafeRemoteUrlError;
      return {
        card: {
          id,
          name,
          provider: "custom_api",
          category: this.category,
          status: "error",
          error: unsafe ? `Base URL 被安全策略拒绝: ${err.message}` : err.message,
          groups: [],
          lastUpdated: Date.now()
        }
      };
    }
  }
};

// src/core/oauth.ts
import http from "node:http";
import net from "node:net";
import { randomBytes, createHash } from "node:crypto";
function base64UrlEncode(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sha256(str) {
  return createHash("sha256").update(str).digest();
}
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
async function findAvailablePort(preferredPorts, host = "127.0.0.1") {
  for (const port of preferredPorts) {
    if (port === 0) continue;
    const isAvailable = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => {
        probe.removeAllListeners();
        resolve(false);
      });
      probe.listen(port, host, () => {
        probe.removeAllListeners();
        probe.close(() => resolve(true));
      });
    });
    if (isAvailable) return port;
  }
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (err) => {
      probe.removeAllListeners();
      reject(err);
    });
    probe.listen(0, host, () => {
      const addr = probe.address();
      const port = addr.port;
      probe.removeAllListeners();
      probe.close(() => resolve(port));
    });
  });
}
var OAuthManager = class {
  activeCodexServer = null;
  activeAntigravityServer = null;
  codexAutoCloseTimer = null;
  antigravityAutoCloseTimer = null;
  codexVerifier = null;
  codexState = null;
  codexAuthUrl = null;
  antigravityState = null;
  antigravityAuthUrl = null;
  dispose() {
    if (this.codexAutoCloseTimer) {
      clearTimeout(this.codexAutoCloseTimer);
      this.codexAutoCloseTimer = null;
    }
    if (this.antigravityAutoCloseTimer) {
      clearTimeout(this.antigravityAutoCloseTimer);
      this.antigravityAutoCloseTimer = null;
    }
    if (this.activeCodexServer) {
      try {
        this.activeCodexServer.removeAllListeners();
        this.activeCodexServer.close();
      } catch {
      }
      this.activeCodexServer = null;
      this.codexAuthUrl = null;
    }
    if (this.activeAntigravityServer) {
      try {
        this.activeAntigravityServer.removeAllListeners();
        this.activeAntigravityServer.close();
      } catch {
      }
      this.activeAntigravityServer = null;
      this.antigravityAuthUrl = null;
    }
  }
  // --- CODEX (ChatGPT OAuth) ---
  async startCodexLogin(onSuccess, proxyUrl, proxyMode) {
    if (this.activeCodexServer !== null && this.codexAuthUrl !== null) {
      return { authUrl: this.codexAuthUrl };
    }
    if (this.codexAutoCloseTimer) {
      clearTimeout(this.codexAutoCloseTimer);
      this.codexAutoCloseTimer = null;
    }
    if (this.activeCodexServer) {
      try {
        this.activeCodexServer.removeAllListeners();
        this.activeCodexServer.close();
      } catch {
      }
      this.activeCodexServer = null;
    }
    this.codexVerifier = base64UrlEncode(randomBytes(32));
    this.codexState = base64UrlEncode(randomBytes(16));
    const codeChallenge = base64UrlEncode(sha256(this.codexVerifier));
    const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
    const codexPort = await findAvailablePort([1455], "127.0.0.1");
    if (codexPort !== 1455) {
      throw new Error("Codex 登录需要本机 1455 端口，当前已被其他进程占用。请释放该端口后重试。");
    }
    const redirectUri = `http://localhost:${codexPort}/auth/callback`;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      state: this.codexState,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });
    const authUrl = `https://auth.openai.com/oauth/authorize?${params.toString()}`;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${codexPort}`);
      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (code && state === this.codexState) {
          try {
            const tokenRes = await fetchWithProxy("https://auth.openai.com/oauth/token", {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
              },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                client_id: clientId,
                code,
                redirect_uri: redirectUri,
                code_verifier: this.codexVerifier
              })
            }, proxyUrl, 2e4, proxyMode);
            if (!tokenRes.ok) {
              const errBody = await tokenRes.text();
              let errMsg = `Token exchange failed (${tokenRes.status})`;
              try {
                const j = JSON.parse(errBody);
                if (j.error?.message) errMsg += `: ${j.error.message}`;
              } catch {
                errMsg += `: ${errBody.slice(0, 100)}`;
              }
              throw new Error(errMsg);
            }
            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;
            const refreshToken = tokenData.refresh_token;
            const expiresIn = tokenData.expires_in || 3600;
            const expiresAt = Date.now() + expiresIn * 1e3;
            let accountId;
            try {
              const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64").toString("utf8"));
              accountId = payload["https://api.openai.com/auth"]?.account_id || payload.account_id;
            } catch {
            }
            onSuccess({ accessToken, refreshToken, accountId, expiresAt });
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>✅ Codex 授权成功！</h2><p>凭据已自动同步至 DSH 额度监控，您可以关闭此网页并返回 DSH 页面。</p></body></html>');
          } catch (err) {
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;line-height:1.6;"><h2>❌ 授权换取令牌失败</h2><p style="color:#d32f2f;font-weight:600;">${escapeHtml(err.message)}</p><p style="font-size:13px;color:#666;">原因说明：OpenAI 官方授权接口严格检测 IP 地区。若当前宿主直连被拦截，请在「额度监控 -> 设置」中填写代理地址（如 http://127.0.0.1:7890），或直接粘贴 ~/.codex/auth.json 中的 access_token。</p></body></html>`);
          }
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h2>❌ 非法请求或 State 校验失败</h2>");
        }
        setTimeout(() => {
          if (this.activeCodexServer) {
            try {
              this.activeCodexServer.removeAllListeners();
              this.activeCodexServer.close();
            } catch {
            }
            this.activeCodexServer = null;
          }
        }, 2e3);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.on("error", (err) => {
      console.warn("[dsh-quota] Codex OAuth server error:", err?.message || err);
    });
    this.activeCodexServer = server;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(codexPort, "127.0.0.1", () => resolve());
    });
    this.codexAutoCloseTimer = setTimeout(() => {
      if (this.activeCodexServer) {
        try {
          this.activeCodexServer.removeAllListeners();
          this.activeCodexServer.close();
        } catch {
        }
        this.activeCodexServer = null;
      }
    }, 3e5);
    return { authUrl };
  }
  // --- ANTIGRAVITY (Google OAuth) ---
  async startAntigravityLogin(onSuccess, proxyUrl, proxyMode) {
    if (this.activeAntigravityServer !== null && this.antigravityAuthUrl !== null) {
      return { authUrl: this.antigravityAuthUrl };
    }
    if (this.antigravityAutoCloseTimer) {
      clearTimeout(this.antigravityAutoCloseTimer);
      this.antigravityAutoCloseTimer = null;
    }
    if (this.activeAntigravityServer) {
      try {
        this.activeAntigravityServer.removeAllListeners();
        this.activeAntigravityServer.close();
      } catch {
      }
      this.activeAntigravityServer = null;
    }
    this.antigravityState = base64UrlEncode(randomBytes(16));
    const clientId = String.fromCharCode(49, 48, 55, 49, 48, 48, 54, 48, 54, 48, 53, 57, 49, 45, 116, 109, 104, 115, 115, 105, 110, 50, 104, 50, 49, 108, 99, 114, 101, 50, 51, 53, 118, 116, 111, 108, 111, 106, 104, 52, 103, 52, 48, 51, 101, 112, 46, 97, 112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111, 110, 116, 101, 110, 116, 46, 99, 111, 109);
    const clientSecret = String.fromCharCode(71, 79, 67, 83, 80, 88, 45, 75, 53, 56, 70, 87, 82, 52, 56, 54, 76, 100, 76, 74, 49, 109, 76, 66, 56, 115, 88, 67, 52, 122, 54, 113, 68, 65, 102);
    const boundPort = await findAvailablePort([51121, 51122, 51123, 43110, 31280, 0], "127.0.0.1");
    const resolvedRedirectUri = `http://127.0.0.1:${boundPort}/oauthcallback`;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${boundPort}`);
      if (url.pathname === "/oauthcallback" || url.pathname === "/oauth2callback") {
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;text-align:center;"><h2>⚠️ 授权未完成</h2><p>Google 授权已被取消或返回错误: ${escapeHtml(error)}</p></body></html>`);
          return;
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (code && state === this.antigravityState) {
          try {
            const tokenRes = await fetchWithProxy("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: "authorization_code",
                redirect_uri: resolvedRedirectUri
              })
            }, proxyUrl, 2e4, proxyMode);
            if (!tokenRes.ok) {
              const errText = await tokenRes.text();
              throw new Error(`Google OAuth 令牌换取失败 (${tokenRes.status}): ${errText.slice(0, 150)}`);
            }
            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;
            const refreshToken = tokenData.refresh_token;
            const expiresIn = tokenData.expires_in || 3600;
            const expiresAt = Date.now() + expiresIn * 1e3;
            let userEmail;
            let userName;
            try {
              const infoRes = await fetchWithProxy("https://www.googleapis.com/oauth2/v2/userinfo", {
                headers: { Authorization: `Bearer ${accessToken}` }
              }, proxyUrl, 8e3, proxyMode);
              if (infoRes.ok) {
                const info = await infoRes.json();
                userEmail = info.email;
                userName = info.name;
              }
            } catch {
            }
            onSuccess({ accessToken, refreshToken, expiresAt, email: userEmail, name: userName });
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Google Antigravity 授权成功</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:40px;text-align:center;background:#f8f9fa;">
  <div style="max-width:480px;margin:0 auto;background:#fff;padding:32px 24px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <h2 style="color:#2e7d32;margin-top:0;">✅ Google Antigravity 登录成功！</h2>
    <p style="color:#444;font-size:15px;margin:16px 0;">${userEmail ? `已关联账号：<strong>${escapeHtml(userEmail)}</strong><br/>` : ""}凭据已自动同步至 DSH 额度监控。</p>
    <p style="color:#666;font-size:13px;">您可以安全地关闭当前网页，并返回 DSH 额度监控页面查看配额。</p>
  </div>
</body>
</html>`);
          } catch (err) {
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;"><h2>❌ Google 登录失败</h2><p style="color:#d32f2f;">${escapeHtml(err.message)}</p><p style="color:#666;font-size:13px;">提示：若网络处于受限地区，请在 DSH 额度监控「设置」中配置 HTTP 代理后重试。</p></body></html>`);
          }
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h2>❌ State 校验失败或缺少授权 Code</h2>");
        }
        setTimeout(() => {
          if (this.activeAntigravityServer) {
            try {
              this.activeAntigravityServer.removeAllListeners();
              this.activeAntigravityServer.close();
            } catch {
            }
            this.activeAntigravityServer = null;
          }
        }, 2e3);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.on("error", (err) => {
      console.warn("[dsh-quota] Antigravity OAuth server error:", err?.message || err);
    });
    this.activeAntigravityServer = server;
    await new Promise((resolve) => {
      server.listen(boundPort, "127.0.0.1", () => resolve());
    });
    this.antigravityAutoCloseTimer = setTimeout(() => {
      if (this.activeAntigravityServer) {
        try {
          this.activeAntigravityServer.removeAllListeners();
          this.activeAntigravityServer.close();
        } catch {
        }
        this.activeAntigravityServer = null;
        this.antigravityAuthUrl = null;
      }
    }, 3e5);
    const scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs"
    ];
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: resolvedRedirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state: this.antigravityState
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    this.antigravityAuthUrl = authUrl;
    return { authUrl };
  }
};

// src/core/history.ts
import { appendFileSync, createReadStream, existsSync as existsSync6, mkdirSync, readFileSync as readFileSync3 } from "node:fs";
import { appendFile, copyFile, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join as join4 } from "node:path";
import { homedir as homedir3 } from "node:os";
var MAX_POINTS_PER_KEY = 2e3;
var MAX_DAYS = 30;
var DAY_MS = 24 * 3600 * 1e3;
var DEDUPE_WINDOW_MS = 5 * 60 * 1e3;
var FLUSH_DELAY_MS = 200;
var FLUSH_EAGER_LINES = 1e3;
function cutoffFor(days = MAX_DAYS) {
  return Date.now() - days * DAY_MS;
}
function encodePoint(key, point) {
  const line = { k: key, ts: point.timestamp };
  if (point.remainingPercent !== void 0) line.r = point.remainingPercent;
  if (point.usedPercent !== void 0) line.u = point.usedPercent;
  if (point.remainingBalance !== void 0) line.balance = point.remainingBalance;
  if (point.resetAt !== void 0) line.resetAt = point.resetAt;
  if (point.kind !== void 0) line.kind = point.kind;
  return JSON.stringify(line);
}
function decodePoint(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return void 0;
  }
  if (!raw || typeof raw !== "object" || typeof raw.k !== "string" || raw.k.length === 0) return void 0;
  if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts)) return void 0;
  const point = { timestamp: raw.ts };
  if (typeof raw.r === "number" && Number.isFinite(raw.r)) point.remainingPercent = raw.r;
  if (typeof raw.u === "number" && Number.isFinite(raw.u)) point.usedPercent = raw.u;
  if (typeof raw.balance === "number" && Number.isFinite(raw.balance)) point.remainingBalance = raw.balance;
  if (typeof raw.resetAt === "string") point.resetAt = raw.resetAt;
  if (raw.kind === "usage" || raw.kind === "balance") point.kind = raw.kind;
  if (point.remainingPercent === void 0 && point.remainingBalance === void 0) return void 0;
  return { key: raw.k, point };
}
function normalizeLegacyPoint(raw, cutoff) {
  if (!raw || typeof raw !== "object") return void 0;
  const timestamp = typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp) ? raw.timestamp : void 0;
  if (timestamp === void 0 || timestamp < cutoff) return void 0;
  const point = { timestamp };
  if (typeof raw.remainingPercent === "number" && Number.isFinite(raw.remainingPercent)) {
    point.remainingPercent = raw.remainingPercent;
  }
  if (typeof raw.usedPercent === "number" && Number.isFinite(raw.usedPercent)) {
    point.usedPercent = raw.usedPercent;
  }
  if (typeof raw.remainingBalance === "number" && Number.isFinite(raw.remainingBalance)) {
    point.remainingBalance = raw.remainingBalance;
  }
  if (typeof raw.resetAt === "string") point.resetAt = raw.resetAt;
  if (point.remainingPercent === void 0 && point.remainingBalance === void 0) return void 0;
  point.kind = point.remainingBalance !== void 0 && point.remainingPercent !== void 0 ? "usage" : point.remainingPercent !== void 0 ? "usage" : "balance";
  return point;
}
var liveHistories = /* @__PURE__ */ new Set();
var exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const history of liveHistories) {
      try {
        history.flushSync();
      } catch {
      }
    }
  });
}
var QuotaHistoryManager = class {
  journalPath;
  legacyPath;
  points = /* @__PURE__ */ new Map();
  /** Resolves when the on-disk journal (and any legacy migration) has been read. */
  ready;
  pendingLines = [];
  flushTimer;
  flushPromise = null;
  compactPromise = null;
  compactTimer;
  lastSaveError;
  constructor() {
    const dshDir = process.env.DSH_HOME || join4(homedir3(), ".dsh");
    try {
      if (!existsSync6(dshDir)) mkdirSync(dshDir, { recursive: true });
    } catch {
    }
    this.journalPath = join4(dshDir, "quota-history.jsonl");
    this.legacyPath = join4(dshDir, "quota-history.json");
    liveHistories.add(this);
    installExitHook();
    this.ready = this.load();
    this.compactTimer = setInterval(() => {
      void this.compact().catch(() => {
      });
    }, DAY_MS);
    if (typeof this.compactTimer.unref === "function") this.compactTimer.unref();
    this.dispose = () => {
      liveHistories.delete(this);
      try {
        this.flushSync();
      } catch {
      }
    };
  }
  /** Detach timers and flush once; safe to call from tests. */
  dispose;
  close() {
    try {
      if (this.flushTimer !== void 0) clearTimeout(this.flushTimer);
      if (this.compactTimer !== void 0) clearInterval(this.compactTimer);
      this.flushTimer = void 0;
      this.compactTimer = void 0;
    } catch {
    }
    this.dispose();
  }
  // ---------------------------------------------------------------- loading
  load() {
    return this.loadFromDisk();
  }
  async loadFromDisk() {
    try {
      const migrated = await this.migrateLegacy();
      for (const [key, list] of migrated) this.mergePoints(key, list);
      const { entries, corrupt, trailingPartial } = await this.readJournal();
      if (corrupt) {
        const quarantine = `${this.journalPath}.corrupt-${Date.now()}`;
        try {
          await rename(this.journalPath, quarantine);
        } catch {
        }
        this.lastSaveError = "history journal corrupt; quarantined";
        this.scheduleCompactRebuild();
      } else {
        for (const [key, list] of entries) this.mergePoints(key, list);
        if (trailingPartial) this.scheduleCompactRebuild();
      }
      this.trimMemory(cutoffFor());
    } catch (err) {
      this.lastSaveError = err?.message ?? String(err);
    }
  }
  scheduleCompactRebuild() {
    const timer = setTimeout(() => {
      void this.compactNow().catch(() => {
      });
    }, 0);
    if (typeof timer.unref === "function") timer.unref();
  }
  /**
   * Stream the journal line by line. A single unparsable *last* line is treated as a
   * crash-truncated tail (dropped, journal rewritten); anything else quarantines the file.
   */
  async readJournal() {
    const entries = /* @__PURE__ */ new Map();
    if (!existsSync6(this.journalPath)) return { entries, corrupt: false, trailingPartial: false };
    const endedWithNewline = await this.fileEndsWithNewline();
    const failures = [];
    let lineIndex = 0;
    const reader = createInterface({
      input: createReadStream(this.journalPath, { encoding: "utf8" }),
      crlfDelay: Infinity
    });
    for await (const rawLine of reader) {
      const line = rawLine.trim();
      if (line.length > 0) {
        const decoded = decodePoint(line);
        if (!decoded) {
          failures.push(lineIndex);
        } else {
          const list = entries.get(decoded.key);
          if (list) list.push(decoded.point);
          else entries.set(decoded.key, [decoded.point]);
        }
      }
      lineIndex += 1;
    }
    const truncatedTail = !endedWithNewline && failures.length === 1 && failures[0] === lineIndex - 1;
    if (failures.length > 0 && !truncatedTail) {
      return { entries: /* @__PURE__ */ new Map(), corrupt: true, trailingPartial: false };
    }
    return { entries, corrupt: false, trailingPartial: truncatedTail || !endedWithNewline && lineIndex > 0 };
  }
  async fileEndsWithNewline() {
    let handle;
    try {
      handle = await open(this.journalPath, "r");
      const info = await handle.stat();
      if (info.size === 0) return true;
      const buf = Buffer.alloc(1);
      await handle.read(buf, 0, 1, info.size - 1);
      return buf[0] === 10;
    } catch {
      return true;
    } finally {
      try {
        await handle?.close();
      } catch {
      }
    }
  }
  /** One-time import of the pre-0.4.1 `quota-history.json`; the old file is renamed, never deleted. */
  async migrateLegacy() {
    const migrated = /* @__PURE__ */ new Map();
    if (!existsSync6(this.legacyPath)) return migrated;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync3(this.legacyPath, "utf8"));
    } catch {
      try {
        await rename(this.legacyPath, `${this.legacyPath}.corrupt-${Date.now()}`);
      } catch {
      }
      return migrated;
    }
    const cutoff = cutoffFor();
    const lines = [];
    const records = parsed && typeof parsed === "object" ? parsed.records : void 0;
    if (records && typeof records === "object") {
      for (const [key, list] of Object.entries(records)) {
        if (!Array.isArray(list)) continue;
        const points = migrated.get(key) ?? [];
        for (const raw of list) {
          const point = normalizeLegacyPoint(raw, cutoff);
          if (!point) continue;
          points.push(point);
          lines.push(encodePoint(key, point));
        }
        if (points.length > 0) migrated.set(key, points);
      }
    }
    if (lines.length > 0) {
      try {
        await appendFile(this.journalPath, `${lines.join("\n")}
`, { encoding: "utf8", mode: 384 });
      } catch (err) {
        this.lastSaveError = err?.message ?? String(err);
        return migrated;
      }
    }
    try {
      await rename(this.legacyPath, `${this.legacyPath}.migrated-${Date.now()}`);
    } catch {
    }
    return migrated;
  }
  // ---------------------------------------------------------------- writing
  mergePoints(key, incoming) {
    if (incoming.length === 0) return;
    const existing = this.points.get(key) ?? [];
    const byTimestamp = /* @__PURE__ */ new Map();
    for (const point of existing) byTimestamp.set(point.timestamp, point);
    for (const point of incoming) byTimestamp.set(point.timestamp, point);
    const merged = Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
    const trimmed = this.trimList(merged, cutoffFor());
    if (trimmed.length === 0) this.points.delete(key);
    else this.points.set(key, trimmed);
  }
  trimList(list, cutoff) {
    let start = 0;
    while (start < list.length && list[start].timestamp < cutoff) start += 1;
    if (start > 0) list.splice(0, start);
    if (list.length > MAX_POINTS_PER_KEY) list.splice(0, list.length - MAX_POINTS_PER_KEY);
    return list;
  }
  trimMemory(cutoff) {
    let removed = 0;
    for (const [key, list] of this.points) {
      const before = list.length;
      this.trimList(list, cutoff);
      removed += before - list.length;
      if (list.length === 0) this.points.delete(key);
    }
    return removed;
  }
  appendPoint(key, point, cutoff, lines) {
    let list = this.points.get(key);
    if (!list) {
      list = [];
      this.points.set(key, list);
    }
    const last = list[list.length - 1];
    if (last && point.timestamp - last.timestamp < DEDUPE_WINDOW_MS && last.kind === point.kind && last.remainingPercent === point.remainingPercent && last.remainingBalance === point.remainingBalance) {
      return;
    }
    if (list.length > 0 && list[0].timestamp < cutoff) this.trimList(list, cutoff);
    list.push(point);
    if (list.length > MAX_POINTS_PER_KEY) list.splice(0, list.length - MAX_POINTS_PER_KEY);
    lines.push(encodePoint(key, point));
  }
  /**
   * Journal the new points carried by a round of cards.
   *
   * Only changed points are appended (5-minute dedupe, balance changes bypass it),
   * and nothing is serialized to disk synchronously: the lines are queued and
   * coalesced into one async `appendFile`.
   */
  recordSnapshots(cards) {
    const now = Date.now();
    const cutoff = cutoffFor();
    const lines = [];
    for (const card of cards) {
      if (!card || card.status === "disabled" || card.status === "error") continue;
      let representative;
      for (const group of card.groups ?? []) {
        for (const win of group.windows ?? []) {
          if (win.status === "disabled" || win.status === "unknown") continue;
          if (!isQuantified(win)) continue;
          const point = {
            timestamp: now,
            kind: "usage",
            remainingPercent: win.remainingPercent,
            usedPercent: win.usedPercent,
            resetAt: win.resetAt
          };
          const key = `${card.id}::${group.id || group.title}::${win.id}`;
          this.appendPoint(key, point, cutoff, lines);
          if (!representative) {
            representative = { timestamp: now, kind: "usage", remainingPercent: win.remainingPercent, usedPercent: win.usedPercent, resetAt: win.resetAt };
          }
        }
      }
      if (!representative && typeof card.balance?.remaining === "number" && Number.isFinite(card.balance.remaining)) {
        representative = { timestamp: now, kind: "balance", remainingBalance: card.balance.remaining };
      }
      if (representative) this.appendPoint(card.id, representative, cutoff, lines);
    }
    if (lines.length === 0) return;
    this.pendingLines.push(...lines);
    if (this.pendingLines.length >= FLUSH_EAGER_LINES) void this.flush();
    else this.scheduleFlush();
  }
  scheduleFlush() {
    if (this.flushTimer !== void 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = void 0;
      void this.flush();
    }, FLUSH_DELAY_MS);
    if (typeof this.flushTimer.unref === "function") this.flushTimer.unref();
  }
  /** Append every queued line; resolves true when the journal is up to date. */
  async flush() {
    if (this.flushPromise) return this.flushPromise;
    if (this.flushTimer !== void 0) {
      clearTimeout(this.flushTimer);
      this.flushTimer = void 0;
    }
    const lines = this.pendingLines.splice(0);
    if (lines.length === 0) return true;
    this.flushPromise = (async () => {
      try {
        await appendFile(this.journalPath, `${lines.join("\n")}
`, { encoding: "utf8", mode: 384 });
        this.lastSaveError = void 0;
        return true;
      } catch (err) {
        this.pendingLines.unshift(...lines);
        this.lastSaveError = err?.message ?? String(err);
        return false;
      } finally {
        this.flushPromise = null;
        if (this.pendingLines.length > 0) this.scheduleFlush();
      }
    })();
    return this.flushPromise;
  }
  flushSync() {
    if (this.flushTimer !== void 0) {
      clearTimeout(this.flushTimer);
      this.flushTimer = void 0;
    }
    if (this.pendingLines.length === 0) return true;
    const lines = this.pendingLines.splice(0);
    try {
      appendFileSync(this.journalPath, `${lines.join("\n")}
`, { encoding: "utf8", mode: 384 });
      this.lastSaveError = void 0;
      return true;
    } catch (err) {
      this.pendingLines.unshift(...lines);
      this.lastSaveError = err?.message ?? String(err);
      return false;
    }
  }
  /** Backward-compatible name for a synchronous flush (the old full rewrite). */
  save() {
    return this.flushSync();
  }
  get persistenceDegraded() {
    return this.lastSaveError !== void 0;
  }
  get lastError() {
    return this.lastSaveError;
  }
  // ------------------------------------------------------------- compaction
  /** Trim (30 days / 2000 points) then atomically rewrite the journal; keeps a `.bak`. */
  async compact() {
    await this.ready;
    return this.compactNow();
  }
  async journalSize() {
    try {
      return (await stat(this.journalPath)).size;
    } catch {
      return -1;
    }
  }
  async compactNow() {
    if (this.compactPromise) return this.compactPromise;
    this.compactPromise = (async () => {
      try {
        await this.flush();
        const existed = existsSync6(this.journalPath);
        const beforeSize = await this.journalSize();
        this.trimMemory(cutoffFor());
        const lines = [];
        for (const [key, list] of this.points) {
          for (const point of list) lines.push(encodePoint(key, point));
        }
        if (existed) {
          try {
            await copyFile(this.journalPath, `${this.journalPath}.bak`);
          } catch {
          }
        }
        const tmpPath = `${this.journalPath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmpPath, lines.length > 0 ? `${lines.join("\n")}
` : "", { encoding: "utf8", mode: 384 });
        const afterSize = await this.journalSize();
        if (afterSize !== beforeSize) {
          await unlink(tmpPath).catch(() => {
          });
          return false;
        }
        await rename(tmpPath, this.journalPath);
        this.lastSaveError = void 0;
        return true;
      } catch (err) {
        this.lastSaveError = err?.message ?? String(err);
        return false;
      } finally {
        this.compactPromise = null;
      }
    })();
    return this.compactPromise;
  }
  // ----------------------------------------------------------------- reading
  keyParts(key) {
    const [instanceId, poolId, windowId] = key.split("::");
    return { instanceId: instanceId ?? key, poolId, windowId };
  }
  getTrendPoints(instanceIdOrKey, days = 7) {
    const list = this.points.get(instanceIdOrKey);
    if (!list || list.length === 0) return [];
    const cutoff = Date.now() - days * DAY_MS;
    const { instanceId, poolId, windowId } = this.keyParts(instanceIdOrKey);
    const out = [];
    for (const point of list) {
      if (point.timestamp < cutoff) continue;
      out.push({
        timestamp: point.timestamp,
        instanceId,
        ...poolId !== void 0 ? { poolId } : {},
        ...windowId !== void 0 ? { windowId } : {},
        ...point.kind !== void 0 ? { kind: point.kind } : {},
        ...point.remainingPercent !== void 0 ? { remainingPercent: point.remainingPercent } : {},
        ...point.usedPercent !== void 0 ? { usedPercent: point.usedPercent } : {},
        ...point.remainingBalance !== void 0 ? { remainingBalance: point.remainingBalance } : {},
        ...point.resetAt !== void 0 ? { resetAt: point.resetAt } : {}
      });
    }
    return out;
  }
  getUsageTrendPoints(instanceIdOrKey, days = 7) {
    const list = this.points.get(instanceIdOrKey) ?? [];
    const now = Date.now();
    const startTime = now - days * DAY_MS;
    const recentPoints = list.filter((point) => point.timestamp >= startTime);
    const numBins = 7;
    const binDuration = days * DAY_MS / numBins;
    const usageBins = new Array(numBins).fill(0);
    if (recentPoints.length >= 2) {
      for (let i = 1; i < recentPoints.length; i += 1) {
        const prev = recentPoints[i - 1];
        const curr = recentPoints[i];
        const binIndex = Math.min(numBins - 1, Math.max(0, Math.floor((curr.timestamp - startTime) / binDuration)));
        if (prev.remainingBalance !== void 0 && curr.remainingBalance !== void 0) {
          const deltaBalance = prev.remainingBalance - curr.remainingBalance;
          if (deltaBalance > 0) usageBins[binIndex] += deltaBalance;
        } else {
          if (prev.remainingPercent === void 0 || curr.remainingPercent === void 0) continue;
          if (curr.remainingPercent > prev.remainingPercent) continue;
          const prevUsed = prev.usedPercent ?? 100 - prev.remainingPercent;
          const currUsed = curr.usedPercent ?? 100 - curr.remainingPercent;
          const deltaUsed = currUsed - prevUsed;
          if (deltaUsed > 0) usageBins[binIndex] += deltaUsed;
        }
      }
    }
    const maxUsage = Math.max(...usageBins);
    const points = [];
    for (let i = 0; i < numBins; i += 1) {
      const binTime = startTime + i * binDuration + binDuration / 2;
      if (maxUsage <= 0) {
        points.push({ t: binTime, r: 0 });
      } else {
        const value = usageBins[i];
        const normalized = value > 0 ? Math.min(100, Math.round(value / maxUsage * 85 + 10)) : 0;
        points.push({ t: binTime, r: normalized });
      }
    }
    return points;
  }
  calculateBurnRate(instanceIdOrKey, currentRemainingPercent) {
    const list = this.points.get(instanceIdOrKey) ?? [];
    if (list.length < 2) return {};
    const now = Date.now();
    const oneDayAgo = now - DAY_MS;
    const recentPoints = list.filter(
      (point) => point.timestamp >= oneDayAgo && point.kind !== "balance" && typeof point.remainingPercent === "number" && Number.isFinite(point.remainingPercent)
    );
    if (recentPoints.length < 2) return {};
    const firstPoint = recentPoints[0];
    const lastPoint = recentPoints[recentPoints.length - 1];
    const first = firstPoint.remainingPercent;
    const last = lastPoint.remainingPercent;
    const timeDiffHours = (lastPoint.timestamp - firstPoint.timestamp) / (3600 * 1e3);
    if (timeDiffHours < 0.25) return {};
    if (last > first) return {};
    const deltaUsed = Math.max(0, first - last);
    const burnRatePerHour = Math.round(deltaUsed / timeDiffHours * 100) / 100;
    let estimatedHoursLeft;
    if (burnRatePerHour > 0.01 && currentRemainingPercent > 0) {
      estimatedHoursLeft = Math.round(currentRemainingPercent / burnRatePerHour * 10) / 10;
    }
    return { burnRatePerHour, estimatedHoursLeft };
  }
};

// src/core/alarm.ts
function amountValue(text) {
  if (!text) return void 0;
  const match = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return void 0;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : void 0;
}
var QuotaAlarmDetector = class {
  activeAlarms = /* @__PURE__ */ new Map();
  detectAlarms(cards, thresholdPercent = 15, options = {}) {
    const alarms = [];
    const now = Date.now();
    const liveIds = /* @__PURE__ */ new Set();
    for (const card of cards) {
      liveIds.add(card.id);
      if (card.status === "disabled") continue;
      if (card.status === "error") {
        const alarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          level: "critical",
          message: `${card.name}: 连接异常 (${card.error || "凭据失效"})`,
          timestamp: now
        };
        alarms.push(alarm);
        this.activeAlarms.set(card.id, alarm);
        continue;
      }
      const balanceAmount = card.balance?.remaining;
      if (typeof balanceAmount === "number" && Number.isFinite(balanceAmount) && balanceAmount <= 0) {
        const alarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: "balance",
          windowId: "account-balance",
          level: "critical",
          message: `${card.name}: 账户余额已用尽${card.balance?.currency ? ` (${card.balance.currency})` : ""}`,
          timestamp: now
        };
        alarms.push(alarm);
        this.activeAlarms.set(card.id, alarm);
        continue;
      }
      let lowestRemaining;
      let lowestLabel = "";
      let lowestPoolId;
      let lowestWindowId;
      let exhaustedBalanceText;
      for (const group of card.groups ?? []) {
        for (const win of group.windows ?? []) {
          if (win.status === "disabled" || win.status === "unknown") continue;
          if (windowQuotaKind(win) === "balance") {
            const value = amountValue(win.amountText);
            if (value !== void 0 && value <= 0 && !exhaustedBalanceText) exhaustedBalanceText = win.amountText;
            continue;
          }
          if (!isQuantified(win)) continue;
          if (lowestRemaining === void 0 || win.remainingPercent < lowestRemaining) {
            lowestRemaining = win.remainingPercent;
            lowestLabel = `${group.title} · ${win.label}`;
            lowestPoolId = group.id || group.poolType;
            lowestWindowId = win.id;
          }
        }
      }
      if (exhaustedBalanceText) {
        const alarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: "balance",
          level: "critical",
          message: `${card.name}: 余额已用尽 (${exhaustedBalanceText})`,
          timestamp: now
        };
        alarms.push(alarm);
        this.activeAlarms.set(card.id, alarm);
        continue;
      }
      if (lowestRemaining === void 0) {
        this.activeAlarms.delete(card.id);
        continue;
      }
      if (lowestRemaining <= thresholdPercent) {
        const isCritical = lowestRemaining <= 5;
        const alarm = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: lowestPoolId,
          windowId: lowestWindowId,
          level: isCritical ? "critical" : "warn",
          message: `${card.name}: ${lowestLabel} 剩余 ${Math.round(lowestRemaining)}%${isCritical ? " (即将用尽)" : " (低于阈值)"}`,
          timestamp: now
        };
        alarms.push(alarm);
        this.activeAlarms.set(card.id, alarm);
      } else {
        this.activeAlarms.delete(card.id);
      }
    }
    if (options.prune !== false) {
      for (const id of Array.from(this.activeAlarms.keys())) {
        if (!liveIds.has(id)) this.activeAlarms.delete(id);
      }
    }
    return alarms;
  }
  getActiveAlarms() {
    return Array.from(this.activeAlarms.values());
  }
};

// src/core/manager.ts
import { existsSync as existsSync7, readFileSync as readFileSync4, mkdirSync as mkdirSync2, renameSync as renameSync2, copyFileSync } from "node:fs";
import { join as join5 } from "node:path";
import { homedir as homedir4 } from "node:os";
var DEFAULT_PROVIDER_ORDER = [
  "deepseek",
  "antigravity",
  "cursor",
  "codex",
  "siliconflow",
  "openrouter",
  "github_copilot",
  "openai_billing",
  "claude",
  "kimi",
  "glm",
  "minimax",
  "qwen",
  "volcengine",
  "opencode_go",
  "custom_api"
];
var PROVIDER_DEFAULT_MODELS = {
  deepseek: {
    primaryId: "deepseek-chat",
    available: ["deepseek-chat", "deepseek-reasoner"],
    role: "长文本理解、通用代码生成与逻辑推理"
  },
  siliconflow: {
    primaryId: "deepseek-ai/DeepSeek-V3",
    available: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-Coder-32B-Instruct"],
    role: "国内高并发大模型推理中转"
  },
  openrouter: {
    primaryId: "anthropic/claude-3.5-sonnet",
    available: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1"],
    role: "海外顶尖全模型智能聚合路由"
  },
  antigravity: {
    primaryId: "gemini-3.8-flash",
    available: ["gemini-3.8-flash", "gemini-3.1-pro", "gemini-4-argon", "claude-sonnet-5-5", "claude-opus-5-5"],
    role: "超长上下文、快速响应与高阶多模态分析"
  },
  cursor: {
    primaryId: "claude-3.5-sonnet",
    available: ["claude-3.5-sonnet", "cursor-small", "gpt-4o"],
    role: "IDE 本地编程补全与编辑"
  },
  codex: {
    primaryId: "gpt-6.1-sol",
    available: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"],
    role: "深度复杂推理、代码架构与多轮长任务"
  },
  github_copilot: {
    primaryId: "gpt-4o",
    available: ["gpt-4o", "claude-3.5-sonnet"],
    role: "代码生成与上下文审查"
  },
  openai_billing: {
    primaryId: "gpt-4o",
    available: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    role: "OpenAI 官方 API 全量能力"
  },
  claude: {
    primaryId: "claude-sonnet-5-5",
    available: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-3-5-sonnet"],
    role: "高精度代码架构、深度逻辑推理与工程交付"
  },
  kimi: {
    primaryId: "moonshot-v1-auto",
    available: ["moonshot-v1-auto", "moonshot-v1-32k", "moonshot-v1-128k"],
    role: "超长中文文档研读与知识检索"
  },
  glm: {
    primaryId: "glm-4-flash",
    available: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
    role: "中文高响应推理与轻量任务"
  },
  qwen: {
    primaryId: "qwen-plus",
    available: ["qwen-plus", "qwen-max", "qwen-2.5-coder-32b-instruct"],
    role: "阿里云百炼中文大模型与代码基座"
  },
  minimax: {
    primaryId: "MiniMax-Text-01",
    available: ["MiniMax-Text-01"],
    role: "通用中文对话与文本创作"
  },
  volcengine: {
    primaryId: "doubao-pro-32k",
    available: ["doubao-pro-32k", "doubao-lite-32k"],
    role: "火山方舟豆包高性价比推理"
  },
  opencode_go: {
    primaryId: "opencode-go-default",
    available: ["opencode-go-default"],
    role: "算力共享与开源模型托管"
  },
  custom_api: {
    primaryId: "gpt-4o",
    available: ["gpt-4o"],
    role: "自定义 OneAPI / NewAPI 渠道"
  }
};
async function runWithConcurrency(items, fn, limit = 5) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      const item = items[idx];
      try {
        const val = await fn(item);
        results[idx] = { status: "fulfilled", value: val };
      } catch (err) {
        results[idx] = { status: "rejected", reason: err };
      }
    }
  }
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
function maskSecret(val) {
  if (!val) return "";
  return "••••••••";
}
function restoreMaskedSecrets(incoming, existing) {
  if (!incoming || typeof incoming !== "object") return incoming;
  if (!existing || typeof existing !== "object") return incoming;
  const res = Array.isArray(incoming) ? [...incoming] : { ...incoming };
  if (Array.isArray(incoming) && Array.isArray(existing)) {
    const byId = /* @__PURE__ */ new Map();
    for (const item of existing) {
      if (item && typeof item === "object" && typeof item.id === "string") byId.set(item.id, item);
    }
    return incoming.map((item) => {
      if (!item || typeof item !== "object") return item;
      const prev = typeof item.id === "string" ? byId.get(item.id) : void 0;
      return prev ? restoreMaskedSecrets(item, prev) : item;
    });
  }
  const identityChanged = res.baseUrl !== void 0 && existing.baseUrl !== void 0 && res.baseUrl !== existing.baseUrl || res.provider !== void 0 && existing.provider !== void 0 && res.provider !== existing.provider;
  for (const k of Object.keys(res)) {
    if (typeof res[k] === "string" && (res[k] === "***" || res[k] === "••••••••" || res[k].includes("••••"))) {
      if (identityChanged) res[k] = "";
      else if (existing[k] !== void 0) res[k] = existing[k];
    } else if (typeof res[k] === "object" && res[k] !== null) {
      res[k] = restoreMaskedSecrets(res[k], existing[k]);
    }
  }
  return res;
}
var SECRET_STRING_KEYS = ["apiKey", "sessionToken", "token", "sessionKey"];
function emptyBundle() {
  return { providers: {}, accounts: {}, custom: {} };
}
function splitSecrets(config) {
  const publicConfig = JSON.parse(JSON.stringify(config || {}));
  const secrets = emptyBundle();
  const takeFrom = (target, store, bucket) => {
    if (!target || typeof target !== "object") return;
    const found = {};
    for (const key of SECRET_STRING_KEYS) {
      if (typeof target[key] === "string" && target[key]) {
        found[key] = target[key];
        delete target[key];
      }
    }
    if (target.oauth && typeof target.oauth === "object") {
      const oauth = {};
      for (const key of ["accessToken", "refreshToken", "accountId"]) {
        if (typeof target.oauth[key] === "string" && target.oauth[key]) {
          oauth[key] = target.oauth[key];
          delete target.oauth[key];
        }
      }
      if (Object.keys(oauth).length > 0) found.oauth = oauth;
    }
    if (Object.keys(found).length > 0) store[bucket] = found;
  };
  if (typeof publicConfig.httpProxy === "string" && publicConfig.httpProxy) {
    secrets.proxy = publicConfig.httpProxy;
    delete publicConfig.httpProxy;
  }
  for (const [name, value] of Object.entries(publicConfig)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (name === "accounts" || name === "custom_compatible") continue;
    takeFrom(value, secrets.providers, name);
  }
  if (Array.isArray(publicConfig.accounts)) {
    for (const acc of publicConfig.accounts) takeFrom(acc, secrets.accounts, String(acc?.id ?? ""));
  }
  if (Array.isArray(publicConfig.custom_compatible)) {
    for (const cust of publicConfig.custom_compatible) takeFrom(cust, secrets.custom, String(cust?.id ?? ""));
  }
  return { publicConfig, secrets };
}
function mergeSecrets(config, secrets) {
  if (!secrets || typeof secrets !== "object") return config;
  const target = config;
  if (typeof secrets.proxy === "string" && secrets.proxy && !target.httpProxy) target.httpProxy = secrets.proxy;
  const restore = (obj, store, key) => {
    const found = store?.[key];
    if (!found || !obj) return;
    for (const field of SECRET_STRING_KEYS) {
      if (typeof found[field] === "string" && !obj[field]) obj[field] = found[field];
    }
    if (found.oauth && typeof found.oauth === "object") obj.oauth = { ...obj.oauth || {}, ...found.oauth };
  };
  for (const [name, value] of Object.entries(target)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (name === "accounts" || name === "custom_compatible") continue;
    restore(value, secrets.providers, name);
  }
  for (const acc of Array.isArray(target.accounts) ? target.accounts : []) restore(acc, secrets.accounts, String(acc?.id ?? ""));
  for (const cust of Array.isArray(target.custom_compatible) ? target.custom_compatible : []) restore(cust, secrets.custom, String(cust?.id ?? ""));
  return target;
}
var FORCE_MIN_INTERVAL_MS = 5e3;
var ERROR_BACKOFF_BASE_MS = 6e4;
var ERROR_BACKOFF_MAX_MS = 6e5;
var ERROR_BACKOFF_FACTOR = 2;
var QuotaManager = class {
  providers = /* @__PURE__ */ new Map();
  oauthManager = new OAuthManager();
  historyManager = new QuotaHistoryManager();
  alarmDetector = new QuotaAlarmDetector();
  cardCache = /* @__PURE__ */ new Map();
  /** Per-instance single flight: concurrent refreshes of one instance share one provider call. */
  inflightTasks = /* @__PURE__ */ new Map();
  /** Whole-round single flight keyed by provider filter ('' = full sweep). */
  inflightRounds = /* @__PURE__ */ new Map();
  /** Last time a real upstream refresh was started, per instance (force throttling). */
  lastForcedAt = /* @__PURE__ */ new Map();
  /** Failure backoff state per instance. */
  backoffs = /* @__PURE__ */ new Map();
  /** Bumped on every config save; in-flight results from older generations never reach the cache. */
  configGeneration = 0;
  lastError;
  lastPersistError;
  configPath;
  secretsPath;
  config = {};
  constructor() {
    this.registerDefaultProviders();
    const dshDir = process.env.DSH_HOME || join5(homedir4(), ".dsh");
    if (!existsSync7(dshDir)) {
      try {
        mkdirSync2(dshDir, { recursive: true });
      } catch {
      }
    }
    this.configPath = join5(dshDir, "quota-config.json");
    this.secretsPath = join5(dshDir, "quota-secrets.json");
    this.loadConfig();
    this.loadSecrets();
    if (!existsSync7(this.secretsPath)) {
      try {
        const { secrets } = splitSecrets(this.config);
        const hasAny = Object.keys(secrets.providers).length + Object.keys(secrets.accounts).length + Object.keys(secrets.custom).length > 0;
        if (hasAny) this.persistSplit();
      } catch {
      }
    }
  }
  loadSecrets() {
    try {
      if (!existsSync7(this.secretsPath)) return;
      const raw = readFileSync4(this.secretsPath, "utf8");
      const parsed = JSON.parse(raw);
      this.config = mergeSecrets(this.config, parsed?.secrets);
    } catch {
    }
  }
  /** Persist the secret half first, then the secret-free config, both atomically. */
  persistSplit() {
    const { publicConfig, secrets } = splitSecrets(this.config);
    const secretsOk = atomicWriteJsonSync(this.secretsPath, { version: 1, secrets }, 384);
    const configOk = atomicWriteJsonSync(this.configPath, publicConfig, 384);
    const ok = secretsOk && configOk;
    this.lastPersistError = ok ? void 0 : "配置持久化失败（磁盘只读或空间不足）";
    return ok;
  }
  registerDefaultProviders() {
    const list = [
      new DeepSeekProvider(),
      new AntigravityProvider(),
      new CursorProvider(),
      new CodexProvider(),
      new GitHubCopilotProvider(),
      new OpenAIBillingProvider(),
      new ClaudeProvider(),
      new KimiProvider(),
      new GLMProvider(),
      new MiniMaxProvider(),
      new QwenProvider(),
      new VolcengineProvider(),
      new SiliconFlowProvider(),
      new OpenRouterProvider(),
      new OpenCodeGoProvider(),
      new CustomApiProvider()
    ];
    for (const p of list) {
      ;
      p.onTokenRefreshed = (info) => {
        this.persistRefreshedTokens(p.name, info);
      };
      this.providers.set(p.name, p);
    }
  }
  /** Write refreshed OAuth tokens into the config (secrets are split out on save). */
  persistRefreshedTokens(providerName, info) {
    if (!info || typeof info.accessToken !== "string" || info.accessToken.length === 0) return;
    const current = this.config[providerName];
    if (!current || typeof current !== "object") return;
    const oauth = { ...current.oauth || {} };
    oauth.accessToken = info.accessToken;
    if (typeof info.refreshToken === "string" && info.refreshToken.length > 0) oauth.refreshToken = info.refreshToken;
    if (typeof info.expiresAt === "number" && Number.isFinite(info.expiresAt)) oauth.expiresAt = info.expiresAt;
    try {
      this.saveConfig({ [providerName]: { ...current, oauth } });
    } catch (error) {
      console.warn("[dsh-quota] failed to persist refreshed tokens:", error?.message ?? error);
    }
  }
  loadConfig() {
    try {
      if (existsSync7(this.configPath)) {
        const raw = readFileSync4(this.configPath, "utf8");
        this.config = JSON.parse(raw);
        if (!this.config.enabledProviders) {
          this.config.enabledProviders = DEFAULT_PROVIDER_ORDER.filter((p) => this.config[p]?.enabled !== false);
        }
        if (!this.config.providerOrder) {
          this.config.providerOrder = DEFAULT_PROVIDER_ORDER;
        }
        if (typeof this.config.refreshIntervalSeconds !== "number" || this.config.refreshIntervalSeconds <= 0) {
          this.config.refreshIntervalSeconds = 60;
        }
        if (typeof this.config.alarmThresholdPercent !== "number") {
          this.config.alarmThresholdPercent = 15;
        }
      } else {
        this.config = {
          deepseek: { enabled: true },
          cursor: { enabled: true, autoDetectLocal: false },
          antigravity: { enabled: true, autoDetectLocal: false },
          codex: { enabled: true, autoDetectLocal: false },
          github_copilot: { enabled: true, autoDetectLocal: false },
          openai_billing: { enabled: false },
          claude: { enabled: false },
          kimi: { enabled: false },
          glm: { enabled: false },
          minimax: { enabled: false },
          qwen: { enabled: false },
          volcengine: { enabled: false },
          opencode_go: { enabled: true },
          enabledProviders: ["deepseek", "antigravity", "cursor", "codex", "github_copilot", "opencode_go"],
          providerOrder: DEFAULT_PROVIDER_ORDER,
          showFloatingHud: true,
          refreshIntervalSeconds: 60,
          alarmThresholdPercent: 15,
          enableNotification: true
        };
        this.persistSplit();
      }
    } catch {
      try {
        const quarantine = `${this.configPath}.corrupt-${Date.now()}`;
        renameSync2(this.configPath, quarantine);
      } catch {
      }
      this.config = {
        deepseek: { enabled: true },
        cursor: { enabled: true, autoDetectLocal: false },
        antigravity: { enabled: true, autoDetectLocal: false },
        codex: { enabled: true, autoDetectLocal: false },
        github_copilot: { enabled: true, autoDetectLocal: false },
        opencode_go: { enabled: true },
        enabledProviders: ["deepseek", "antigravity", "cursor", "codex", "github_copilot", "opencode_go"],
        providerOrder: DEFAULT_PROVIDER_ORDER,
        showFloatingHud: true,
        refreshIntervalSeconds: 60,
        alarmThresholdPercent: 15,
        enableNotification: true
      };
    }
    return this.config;
  }
  saveConfig(newConfig) {
    const current = this.config || {};
    const unmasked = restoreMaskedSecrets(newConfig, current);
    const merged = {
      ...current,
      ...unmasked,
      proxyMode: unmasked.proxyMode !== void 0 ? unmasked.proxyMode : current.proxyMode,
      httpProxy: unmasked.httpProxy !== void 0 ? unmasked.httpProxy : current.httpProxy,
      deepseek: { ...current.deepseek, ...unmasked.deepseek },
      cursor: { ...current.cursor, ...unmasked.cursor },
      codex: { ...current.codex, ...unmasked.codex },
      antigravity: { ...current.antigravity, ...unmasked.antigravity },
      github_copilot: { ...current.github_copilot, ...unmasked.github_copilot },
      openai_billing: { ...current.openai_billing, ...unmasked.openai_billing },
      claude: { ...current.claude, ...unmasked.claude },
      kimi: { ...current.kimi, ...unmasked.kimi },
      glm: { ...current.glm, ...unmasked.glm },
      minimax: { ...current.minimax, ...unmasked.minimax },
      qwen: { ...current.qwen, ...unmasked.qwen },
      volcengine: { ...current.volcengine, ...unmasked.volcengine },
      siliconflow: { ...current.siliconflow, ...unmasked.siliconflow },
      openrouter: { ...current.openrouter, ...unmasked.openrouter },
      opencode_go: { ...current.opencode_go, ...unmasked.opencode_go },
      custom_compatible: unmasked.custom_compatible !== void 0 ? unmasked.custom_compatible : current.custom_compatible,
      accounts: unmasked.accounts !== void 0 ? unmasked.accounts : current.accounts,
      enabledProviders: unmasked.enabledProviders !== void 0 ? unmasked.enabledProviders : current.enabledProviders,
      floatingHudProviders: unmasked.floatingHudProviders !== void 0 ? unmasked.floatingHudProviders : current.floatingHudProviders,
      floatingHudMetrics: unmasked.floatingHudMetrics !== void 0 ? unmasked.floatingHudMetrics : current.floatingHudMetrics,
      providerOrder: unmasked.providerOrder !== void 0 ? unmasked.providerOrder : current.providerOrder,
      customNames: (() => {
        if (unmasked.customNames === void 0) return current.customNames;
        const combined = { ...current.customNames || {}, ...unmasked.customNames };
        for (const [k, v] of Object.entries(combined)) {
          if (!v || !v.trim()) delete combined[k];
        }
        return combined;
      })()
    };
    this.config = merged;
    this.configGeneration += 1;
    this.cardCache.clear();
    this.backoffs.clear();
    this.lastForcedAt.clear();
    this.inflightTasks.clear();
    this.inflightRounds.clear();
    if (!this.persistSplit()) {
      throw new Error(this.lastPersistError ?? "配置写入失败");
    }
  }
  getSafeConfig() {
    const copy = JSON.parse(JSON.stringify(this.config || {}));
    const maskOauth = (owner) => {
      if (!owner || typeof owner !== "object" || !owner.oauth || typeof owner.oauth !== "object") return;
      if (owner.oauth.accessToken) owner.oauth.accessToken = maskSecret(owner.oauth.accessToken);
      if (owner.oauth.refreshToken) owner.oauth.refreshToken = maskSecret(owner.oauth.refreshToken);
    };
    if (typeof copy.httpProxy === "string" && copy.httpProxy) {
      copy.httpProxy = sanitizeProxyUrl(copy.httpProxy);
    }
    for (const value of Object.values(copy)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      for (const key of SECRET_STRING_KEYS) {
        if (typeof value[key] === "string" && value[key]) {
          value[key] = maskSecret(value[key]);
        }
      }
      maskOauth(value);
    }
    if (Array.isArray(copy.custom_compatible)) {
      copy.custom_compatible = copy.custom_compatible.map((item) => {
        const out = { ...item };
        for (const key of SECRET_STRING_KEYS) {
          if (typeof out[key] === "string" && out[key]) out[key] = maskSecret(out[key]);
        }
        maskOauth(out);
        return out;
      });
    }
    if (Array.isArray(copy.accounts)) {
      copy.accounts = copy.accounts.map((item) => {
        const out = { ...item };
        for (const key of SECRET_STRING_KEYS) {
          if (typeof out[key] === "string" && out[key]) out[key] = maskSecret(out[key]);
        }
        maskOauth(out);
        return out;
      });
    }
    return copy;
  }
  getConfig() {
    return this.config;
  }
  saveCodexLogin(tokens) {
    const codexDir = join5(homedir4(), ".codex");
    const authPath = join5(codexDir, "auth.json");
    try {
      mkdirSync2(codexDir, { recursive: true });
      let auth = {};
      if (existsSync7(authPath)) {
        try {
          copyFileSync(authPath, `${authPath}.dsh-quota-backup-${Date.now()}`);
        } catch {
        }
        auth = JSON.parse(readFileSync4(authPath, "utf8"));
      }
      auth.auth_mode = "chatgpt";
      auth.tokens = {
        ...auth.tokens,
        access_token: tokens.accessToken,
        ...tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {},
        ...tokens.accountId ? { account_id: tokens.accountId } : {}
      };
      atomicWriteJsonSync(authPath, auth, 384);
    } catch {
    }
  }
  buildInstanceTasks(providerFilter) {
    const tasks = [];
    if (this.config.accounts && this.config.accounts.length > 0) {
      for (const acc of this.config.accounts) {
        if (acc.enabled !== false) {
          tasks.push({
            id: acc.id,
            providerName: acc.provider,
            accountConfig: acc
          });
        }
      }
    }
    if (this.config.custom_compatible && Array.isArray(this.config.custom_compatible)) {
      for (const cust of this.config.custom_compatible) {
        if (cust.enabled !== false && cust.apiKey) {
          tasks.push({
            id: cust.id,
            providerName: "custom_api",
            accountConfig: {
              id: cust.id,
              provider: "custom_api",
              name: cust.name,
              apiKey: cust.apiKey,
              baseUrl: cust.baseUrl,
              extra: { balancePath: cust.balancePath }
            }
          });
        }
      }
    }
    const seenIds = new Set(tasks.map((t) => t.id));
    for (const [pName] of this.providers.entries()) {
      if (pName === "custom_api") continue;
      if (!seenIds.has(pName)) {
        const provCfg = this.config[pName];
        if (provCfg && provCfg.enabled !== false) {
          tasks.push({
            id: pName,
            providerName: pName
          });
          seenIds.add(pName);
        }
      }
    }
    if (!providerFilter) return tasks;
    const needle = providerFilter.toLowerCase();
    return tasks.filter(
      (t) => t.providerName.toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle)
    );
  }
  generateSparkline(instanceId) {
    return this.historyManager.getUsageTrendPoints(instanceId, 7);
  }
  /**
   * Single-flight quota round.
   *
   * Concurrent callers for the same scope share one upstream sweep (audit A6): a
   * manual refresh racing the poller must not double the provider requests. Each
   * caller still observes its own AbortSignal, so a closed tab cannot cancel the
   * sweep other callers are waiting on.
   */
  async getQuotaCards(forceRefresh = false, providerFilter, signal) {
    const flightKey = providerFilter ? `filter:${providerFilter}` : "all";
    let flight = this.inflightRounds.get(flightKey);
    if (!flight) {
      flight = this.runRound(forceRefresh, providerFilter, signal);
      this.inflightRounds.set(flightKey, flight);
      const clear = () => {
        if (this.inflightRounds.get(flightKey) === flight) this.inflightRounds.delete(flightKey);
      };
      void flight.then(clear, clear);
    }
    return this.raceAbort(flight, signal);
  }
  async runRound(forceRefresh, providerFilter, signal) {
    try {
      await this.historyManager.ready;
    } catch {
    }
    const generation = this.configGeneration;
    const tasks = this.buildInstanceTasks(providerFilter);
    let anyFetched = false;
    const settled = await runWithConcurrency(tasks, async (task) => {
      const result = await this.refreshInstance(task, { force: forceRefresh, signal, generation });
      if (result?.fetched) anyFetched = true;
      return result?.card ?? null;
    }, 5);
    if (signal?.aborted) throw this.abortError();
    const allCards = [];
    for (const entry of settled) {
      if (entry.status === "fulfilled" && entry.value) allCards.push(entry.value);
    }
    if (anyFetched) {
      try {
        this.historyManager.recordSnapshots(allCards);
      } catch (err) {
        this.lastError = `历史写入失败: ${err?.message ?? err}`;
      }
    }
    const alarms = this.alarmDetector.detectAlarms(
      allCards,
      this.config.alarmThresholdPercent ?? 15,
      { prune: !providerFilter }
    );
    const orderList = this.config.providerOrder ?? DEFAULT_PROVIDER_ORDER;
    const enabledSet = new Set(this.config.enabledProviders ?? DEFAULT_PROVIDER_ORDER);
    const visibleCards = allCards.filter((card) => {
      if (card.status === "disabled") return false;
      const isEnabled = enabledSet.has(card.id) || enabledSet.has(card.provider);
      if (card.provider === "custom_api") return isEnabled;
      return isEnabled && this.config[card.provider]?.enabled !== false;
    });
    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.id) !== -1 ? orderList.indexOf(a.id) : orderList.indexOf(a.provider);
      const idxB = orderList.indexOf(b.id) !== -1 ? orderList.indexOf(b.id) : orderList.indexOf(b.provider);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
    return {
      cards: visibleCards,
      allCards,
      alarms,
      // Completion time, not request start: TTL counts from when data actually arrived (audit A11).
      lastUpdated: Date.now(),
      persistenceDegraded: this.historyManager.persistenceDegraded || this.lastPersistError !== void 0,
      lastError: this.lastError
    };
  }
  abortError() {
    const err = new Error("请求已取消");
    err.name = "AbortError";
    err.code = "ABORT_ERR";
    return err;
  }
  /** Reject a caller as soon as its own signal aborts, without cancelling the shared sweep. */
  raceAbort(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(this.abortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(this.abortError());
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (err) => {
          cleanup();
          reject(err);
        }
      );
    });
  }
  /**
   * Cache/single-flight/backoff gate in front of one provider call.
   *
   * Order of precedence: TTL cache → force throttle (5 s) → failure backoff →
   * per-instance single flight → upstream.
   */
  async refreshInstance(task, options) {
    const { id, providerName, accountConfig } = task;
    const now = Date.now();
    const cached = this.cardCache.get(id);
    if (cached && !options.force) {
      const intervalSec = getRefreshIntervalSeconds(this.config);
      const ttl = Math.max(5e3, intervalSec * 1e3);
      if (now - cached.fetchedAt < ttl) return { card: cached.card, fetched: false };
    }
    if (options.force && cached) {
      const lastForced = this.lastForcedAt.get(id) ?? 0;
      if (now - lastForced < FORCE_MIN_INTERVAL_MS) return { card: cached.card, fetched: false };
    }
    const backoff = this.backoffs.get(id);
    if (backoff && backoff.retryAt > now) {
      return cached ? { card: cached.card, fetched: false } : null;
    }
    const inFlight = this.inflightTasks.get(id);
    if (inFlight) return inFlight;
    const flight = (async () => {
      const provider = this.providers.get(providerName);
      if (!provider) return null;
      if (options.signal?.aborted) throw this.abortError();
      this.lastForcedAt.set(id, Date.now());
      const configSnapshot = this.config;
      try {
        const result = await provider.fetchCard(configSnapshot, accountConfig, options.signal);
        if (options.signal?.aborted) throw this.abortError();
        const card = result.card;
        this.decorateCard(card, id, providerName, configSnapshot);
        if (options.generation === this.configGeneration) {
          this.cardCache.set(id, { card, fetchedAt: Date.now() });
          this.backoffs.delete(id);
        }
        return { card, fetched: true };
      } catch (err) {
        if (options.signal?.aborted) throw this.abortError();
        const failures = (this.backoffs.get(id)?.failures ?? 0) + 1;
        const delayMs = Math.min(
          ERROR_BACKOFF_MAX_MS,
          ERROR_BACKOFF_BASE_MS * ERROR_BACKOFF_FACTOR ** (failures - 1)
        );
        const retryAt = Date.now() + delayMs;
        const errorCard = this.makeErrorCard(id, providerName, accountConfig, provider, err, retryAt);
        this.lastError = `${providerName}: ${err?.message ?? err}`;
        if (options.generation === this.configGeneration) {
          this.backoffs.set(id, { failures, retryAt });
          this.cardCache.set(id, { card: errorCard, fetchedAt: Date.now() });
        }
        return { card: errorCard, fetched: true };
      }
    })();
    this.inflightTasks.set(id, flight);
    try {
      return await flight;
    } finally {
      if (this.inflightTasks.get(id) === flight) this.inflightTasks.delete(id);
    }
  }
  makeErrorCard(id, providerName, accountConfig, provider, err, retryAt) {
    const customName = this.config[providerName]?.name || this.config.customNames?.[id] || this.config.customNames?.[providerName];
    const card = {
      id,
      name: customName || accountConfig?.name || provider.name,
      provider: providerName,
      category: provider.category,
      status: "error",
      error: err?.message ?? String(err),
      groups: [],
      lastUpdated: Date.now()
    };
    card.retryAfter = retryAt;
    card.retryAfterMs = Math.max(0, retryAt - Date.now());
    return card;
  }
  decorateCard(card, id, providerName, configSnapshot = this.config) {
    const representative = this.representativeWindow(card);
    if (representative.remainingPercent !== void 0) {
      const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(
        id,
        representative.remainingPercent
      );
      card.burnRatePerHour = burnRatePerHour;
      card.estimatedHoursLeft = estimatedHoursLeft;
    }
    card.sparkline = this.generateSparkline(id);
    const customName = configSnapshot[providerName]?.name || this.config.customNames?.[id] || this.config.customNames?.[providerName];
    if (customName) card.name = customName;
  }
  /**
   * Pick one window to represent a card's short-cycle trend.
   *
   * Only a quantified window can drive burn rate. Index 0 is server order, which
   * changes when a new pool appears; prefer an active `usage` window and never
   * treat a balance amount as a percentage.
   */
  representativeWindow(card) {
    const windows = (card.groups ?? []).flatMap((group) => group.windows ?? []);
    const quantified = windows.filter(
      (win) => win.status !== "unknown" && win.status !== "disabled" && isQuantified(win)
    );
    const preferred = quantified.find((win) => win.status !== "exhausted") ?? quantified[0];
    if (preferred) return { remainingPercent: preferred.remainingPercent, windowId: preferred.id };
    const balanceWindow = windows.find((win) => windowQuotaKind(win) === "balance");
    return balanceWindow ? { windowId: balanceWindow.id } : {};
  }
  async refreshSingleProvider(instanceOrProvider, signal) {
    try {
      await this.historyManager.ready;
    } catch {
    }
    const tasks = this.buildInstanceTasks();
    const task = tasks.find((t) => t.id === instanceOrProvider || t.providerName === instanceOrProvider);
    if (!task) return void 0;
    const result = await this.refreshInstance(task, {
      force: true,
      signal,
      generation: this.configGeneration
    });
    if (!result) return void 0;
    if (result.fetched) {
      try {
        this.historyManager.recordSnapshots([result.card]);
      } catch (err) {
        this.lastError = `历史写入失败: ${err?.message ?? err}`;
      }
    }
    return result.card;
  }
  /**
   * Fire-and-forget refresh used by routes and OAuth callbacks: never rejects,
   * records `lastError` for status reporting (audit A7).
   */
  async safeRefresh(providerFilter, signal) {
    try {
      await this.getQuotaCards(true, providerFilter, signal);
      this.lastError = void 0;
      return true;
    } catch (err) {
      this.lastError = err?.message ?? String(err);
      try {
        console.warn("[dsh-quota] background refresh failed:", this.lastError);
      } catch {
      }
      return false;
    }
  }
  getLastError() {
    return this.lastError;
  }
  async testConnection(providerName, accountConfig, signal) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      return {
        ok: false,
        provider: providerName,
        message: `未知服务提供商: ${providerName}`
      };
    }
    if (typeof provider.testConnection === "function") {
      return provider.testConnection(this.config, accountConfig, signal);
    }
    try {
      const start = Date.now();
      const res = await provider.fetchCard(this.config, accountConfig, signal);
      const latencyMs = Date.now() - start;
      if (res.card.status === "ok" || res.card.status === "warn") {
        return {
          ok: true,
          provider: providerName,
          latencyMs,
          account: res.card.account,
          message: `连接成功 (延迟: ${latencyMs}ms)`
        };
      }
      return {
        ok: false,
        provider: providerName,
        latencyMs,
        message: res.card.error || "连接失败"
      };
    } catch (err) {
      return {
        ok: false,
        provider: providerName,
        message: `测试异常: ${err.message}`
      };
    }
  }
  async testAllConnections(signal) {
    const tasks = this.buildInstanceTasks();
    const results = {};
    await runWithConcurrency(tasks, async (t) => {
      const res = await this.testConnection(t.providerName, t.accountConfig, signal);
      results[t.id] = res;
      return res;
    }, 5);
    return results;
  }
  /**
   * Structured summary and intelligent model routing recommendations for DSH Agent Tool calls
   */
  async getAgentQuotaSummary(providerName, forceRefresh = false) {
    const { cards, alarms, lastUpdated } = await this.getQuotaCards(forceRefresh, providerName);
    const targetCards = providerName ? cards.filter((c) => c.provider.toLowerCase().includes(providerName.toLowerCase()) || c.id.toLowerCase().includes(providerName.toLowerCase())) : cards;
    const ranked = [];
    for (const card of cards) {
      if (card.status === "error" || card.status === "disabled") continue;
      const remaining = this.worstQuantifiedPercent(card);
      if (remaining !== void 0) ranked.push({ card, remaining });
    }
    ranked.sort((a, b) => {
      if (b.remaining !== a.remaining) return b.remaining - a.remaining;
      const aPreferred = a.card.provider === "deepseek" ? 1 : 0;
      const bPreferred = b.card.provider === "deepseek" ? 1 : 0;
      if (bPreferred !== aPreferred) return bPreferred - aPreferred;
      return a.card.name.localeCompare(b.card.name);
    });
    const healthyRanked = ranked.filter((entry) => entry.card.status === "ok");
    const warningRanked = ranked.filter((entry) => entry.card.status === "warn");
    let recommendation;
    if (healthyRanked.length > 0) {
      const { card: primary, remaining } = healthyRanked[0];
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: "通用大模型" };
      const fallbacks = healthyRanked.filter((entry) => entry.card.id !== primary.id).slice(0, 4).map((entry) => {
        const fMeta = PROVIDER_DEFAULT_MODELS[entry.card.provider] || { primaryId: entry.card.provider, available: [entry.card.provider], role: "备用模型" };
        return {
          provider: entry.card.provider,
          modelId: fMeta.primaryId,
          name: `${entry.card.name} (${fMeta.primaryId})`,
          reason: `${fMeta.role} · 量化剩余 ${Math.round(entry.remaining)}%`
        };
      });
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: "healthy",
        reason: `首选 ${primary.name} · 调用模型 ${meta.primaryId}（最低窗口剩余 ${Math.round(remaining)}% · ${meta.role}）`,
        availableModels: meta.available,
        fallbackRoutes: fallbacks
      };
    } else if (warningRanked.length > 0) {
      const { card: primary, remaining } = warningRanked[0];
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: "告警备用" };
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: "warning",
        reason: `首选 ${primary.name} · 模型 ${meta.primaryId} 最低窗口剩余 ${Math.round(remaining)}%，已低于警戒线，建议谨慎执行高消耗长任务`,
        availableModels: meta.available,
        fallbackRoutes: []
      };
    } else if (cards.some((card) => card.status === "ok")) {
      recommendation = {
        primaryModel: "none",
        primaryModelId: "none",
        primaryProvider: "none",
        status: "warning",
        reason: "已连接的服务均未提供可量化额度（仅连通性或余额），无法判断额度是否充足，请先查看余额或手动确认",
        availableModels: [],
        fallbackRoutes: []
      };
    } else {
      recommendation = {
        primaryModel: "none",
        primaryModelId: "none",
        primaryProvider: "none",
        status: "exhausted",
        reason: "当前所有已配置 AI 服务均处于未连接或异常状态，请在额度监控中配置有效凭据",
        availableModels: [],
        fallbackRoutes: []
      };
    }
    return {
      success: true,
      lastUpdated: new Date(lastUpdated).toLocaleString("zh-CN"),
      alarmCount: alarms.length,
      alarms: alarms.map((a) => ({ level: a.level, name: a.name, message: a.message })),
      recommendation,
      services: targetCards.map((c) => {
        const modelMeta = PROVIDER_DEFAULT_MODELS[c.provider];
        const windows = (c.groups ?? []).flatMap((g) => g.windows ?? []);
        const hasQuantified = windows.some((w) => isQuantified(w));
        const hasBalance = windows.some((w) => windowQuotaKind(w) === "balance");
        const hasLiveness = windows.some((w) => windowQuotaKind(w) === "liveness");
        return {
          id: c.id,
          name: c.name,
          provider: c.provider,
          modelId: modelMeta?.primaryId,
          availableModels: modelMeta?.available,
          category: c.category,
          status: c.status,
          plan: c.plan,
          account: c.account,
          error: c.error,
          balance: c.balance,
          // Balance-only services report money, never a synthesized percentage.
          balanceText: this.formatBalanceText(c.balance),
          quotaKind: hasQuantified ? "usage" : hasBalance || c.balance ? "balance" : hasLiveness ? "liveness" : "unknown",
          worstRemainingPercent: this.worstQuantifiedPercent(c),
          burnRatePerHour: c.burnRatePerHour ? `${c.burnRatePerHour}%/h` : void 0,
          estimatedHoursLeft: c.estimatedHoursLeft ? `${c.estimatedHoursLeft} 小时` : void 0,
          quotas: c.groups.map((g) => ({
            group: g.title,
            windows: g.windows.map((w) => {
              const windowKind = windowQuotaKind(w);
              const quantified = isQuantified(w);
              return {
                label: w.label,
                kind: windowKind,
                // `—` for liveness/unknown; the amount text for balance; a real % only for usage.
                remaining: quantified ? `${w.remainingPercent}%` : windowKind === "balance" ? w.amountText ?? this.formatBalanceText(c.balance) ?? "—" : "—",
                used: quantified ? `${w.usedPercent}%` : void 0,
                subtitle: w.subtitle,
                amountText: windowKind === "balance" ? w.amountText : void 0
              };
            })
          }))
        };
      })
    };
  }
  /** Lowest remaining percent among quantified windows, or undefined when none exists. */
  worstQuantifiedPercent(card) {
    let worst;
    for (const group of card.groups ?? []) {
      for (const win of group.windows ?? []) {
        if (!isQuantified(win)) continue;
        if (worst === void 0 || win.remainingPercent < worst) worst = win.remainingPercent;
      }
    }
    return worst;
  }
  formatBalanceText(balance) {
    if (!balance) return void 0;
    const currency = balance.currency && balance.currency !== "TOKEN" && balance.currency !== "COUNT" ? balance.currency : "";
    if (typeof balance.remaining === "number" && Number.isFinite(balance.remaining)) {
      return `${balance.remaining}${currency ? ` ${currency}` : ""}`;
    }
    if (typeof balance.total === "number" && Number.isFinite(balance.total)) {
      return `${balance.total}${currency ? ` ${currency}` : ""}`;
    }
    return void 0;
  }
};

// src/routes.ts
var API_HEADER = "x-dsh-quota";
var MAX_BODY_BYTES = 256 * 1024;
function isLoopbackHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}
function checkGuard(req) {
  const header = req?.headers?.[API_HEADER];
  if (header !== "1") return { status: 403, message: "缺少 X-DSH-Quota 请求头" };
  if (process.env.DSH_QUOTA_ALLOW_REMOTE_API !== "1") {
    const hostHeader = String(req?.headers?.host ?? "");
    const hostname = hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
    if (!isLoopbackHostname(hostname)) {
      return { status: 403, message: `非本机访问被拒绝 (Host: ${hostHeader || "unknown"})` };
    }
  }
  const origin = req?.headers?.origin;
  if (typeof origin === "string" && origin.length > 0 && origin !== "null") {
    let originHost = "";
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return { status: 403, message: "Origin 无效" };
    }
    if (!isLoopbackHostname(originHost)) return { status: 403, message: "跨站请求被拒绝" };
  }
  const site = req?.headers?.["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") {
    return { status: 403, message: `跨站请求被拒绝 (Sec-Fetch-Site: ${site})` };
  }
  return void 0;
}
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
async function readJsonBody(req) {
  let body = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("请求载荷过大 (超过 256KB)");
      error.statusCode = 413;
      throw error;
    }
    body += chunk;
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("请求体不是合法 JSON");
    error.statusCode = 400;
    throw error;
  }
}
function downsample(points, limit = 500) {
  if (points.length <= limit) return points;
  const stride = points.length / limit;
  const out = [];
  for (let i = 0; i < limit; i += 1) {
    out.push(points[Math.min(points.length - 1, Math.floor((i + 1) * stride) - 1)]);
  }
  return out;
}
function clampDays(raw) {
  const parsed = Number.parseInt(raw ?? "7", 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, parsed));
}
function makeQuotaRoutes(manager) {
  const guarded = (handler) => {
    return async (req, res) => {
      const failure = checkGuard(req);
      if (failure !== void 0) {
        sendJson(res, failure.status, { ok: false, error: failure.message });
        return;
      }
      if (req.method === "POST" && !/^application\/json\b/i.test(String(req.headers?.["content-type"] ?? ""))) {
        sendJson(res, 415, { ok: false, error: "POST 必须使用 application/json" });
        return;
      }
      try {
        await handler(req, res);
      } catch (err) {
        sendJson(res, err?.statusCode ?? 500, { ok: false, error: err?.message ?? String(err) });
      }
    };
  };
  const withAbort = (req) => {
    const controller = new AbortController();
    if (typeof req?.on === "function") {
      req.on("close", () => controller.abort());
      req.on("aborted", () => controller.abort());
    }
    return controller.signal;
  };
  return [
    {
      kind: "exact",
      path: "/api/dsh-quota/status",
      handler: guarded(async (req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        const force = url.searchParams.get("force") === "true";
        const provider = url.searchParams.get("provider");
        const signal = withAbort(req);
        if (provider) {
          const card = await manager.refreshSingleProvider(provider, signal);
          if (card === void 0) {
            sendJson(res, 404, { ok: false, error: `未知或未启用的服务商: ${provider}` });
            return;
          }
          sendJson(res, 200, { ok: true, card });
          return;
        }
        const result = await manager.getQuotaCards(force, void 0, signal);
        sendJson(res, 200, result);
      })
    },
    {
      kind: "exact",
      path: "/api/dsh-quota/test-connection",
      handler: guarded(async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "仅支持 POST" });
          return;
        }
        const payload = await readJsonBody(req);
        const provider = typeof payload?.provider === "string" ? payload.provider : "";
        if (!provider) {
          sendJson(res, 400, { ok: false, message: "缺少 provider 参数" });
          return;
        }
        const testResult = await manager.testConnection(provider, payload?.accountConfig, withAbort(req));
        sendJson(res, 200, testResult);
      })
    },
    {
      kind: "exact",
      path: "/api/dsh-quota/test-all",
      handler: guarded(async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "仅支持 POST" });
          return;
        }
        const results = await manager.testAllConnections(withAbort(req));
        sendJson(res, 200, { ok: true, results });
      })
    },
    {
      kind: "exact",
      path: "/api/dsh-quota/history",
      handler: guarded(async (req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        const instanceId = url.searchParams.get("instanceId");
        if (!instanceId) {
          sendJson(res, 400, { ok: false, error: "缺少 instanceId 参数" });
          return;
        }
        if (instanceId.length > 200) {
          sendJson(res, 400, { ok: false, error: "instanceId 过长" });
          return;
        }
        const points = manager.historyManager.getTrendPoints(instanceId, clampDays(url.searchParams.get("days")));
        sendJson(res, 200, { ok: true, points: downsample(points) });
      })
    },
    {
      kind: "exact",
      path: "/api/dsh-quota/config",
      handler: guarded(async (req, res) => {
        if (req.method === "GET") {
          sendJson(res, 200, manager.getSafeConfig());
          return;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "仅支持 GET/POST" });
          return;
        }
        const parsed = await readJsonBody(req);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          sendJson(res, 400, { ok: false, error: "配置必须是 JSON 对象" });
          return;
        }
        manager.saveConfig(parsed);
        void manager.getQuotaCards(true).catch((err) => {
          console.warn("[dsh-quota] background refresh after config save failed:", err?.message ?? err);
        });
        sendJson(res, 200, { ok: true });
      })
    },
    {
      kind: "exact",
      path: "/api/dsh-quota/auth/codex/start",
      handler: guarded(async (req, res) => {
        const cfg = manager.getConfig();
        const { authUrl } = await manager.oauthManager.startCodexLogin((tokens) => {
          manager.saveCodexLogin(tokens);
          const current = manager.getConfig();
          const { oauth: _legacyOauth, ...codex } = current.codex ?? {};
          manager.saveConfig({
            ...current,
            codex: { ...codex, enabled: true, autoDetectLocal: true }
          });
          void manager.getQuotaCards(true).catch(() => {
          });
        }, cfg.httpProxy, cfg.proxyMode);
        sendJson(res, 200, { ok: true, authUrl });
      })
    },
    {
      kind: "exact",
      path: "/api/dsh-quota/auth/antigravity/start",
      handler: guarded(async (req, res) => {
        const cfg = manager.getConfig();
        const { authUrl } = await manager.oauthManager.startAntigravityLogin((tokens) => {
          const current = manager.getConfig();
          manager.saveConfig({
            ...current,
            antigravity: { enabled: true, autoDetectLocal: true, oauth: tokens }
          });
          void manager.getQuotaCards(true).catch(() => {
          });
        }, cfg.httpProxy, cfg.proxyMode);
        sendJson(res, 200, { ok: true, authUrl });
      })
    },
    {
      kind: "exact",
      path: "/api/dsh-quota/auth/cursor/connect",
      handler: guarded(async (req, res) => {
        const current = manager.getConfig();
        manager.saveConfig({
          ...current,
          cursor: { ...current.cursor, enabled: true, autoDetectLocal: true }
        });
        const q = await manager.getQuotaCards(true);
        const cursorCard = q.cards.find((c) => c.provider === "cursor");
        sendJson(res, 200, { ok: true, card: cursorCard });
      })
    }
  ];
}

// src/index.ts
var VERSION = PLUGIN_VERSION;
var inject = ["systemPrompt", "webServer"];
var GUIDANCE = `本机已安装 dsh-quota 插件（DSH AI 额度与用量监控 v${PLUGIN_VERSION}）：侧边栏「额度监控」入口。能力：集中监控并展示 DeepSeek、Cursor、Codex、Google Antigravity、GitHub Copilot、OpenAI Billing、Claude、Kimi、智谱 GLM、MiniMax、通义千问、火山方舟、硅基流动 (SiliconFlow)、OpenRouter、OpenCode-Go 及 OneAPI 中转服务的实时剩余额度、用量及到期重置周期；支持 Gemini 4 Argon 独立周额度、7 天时序趋势 Sparkline、消耗速率计算、一键全部测活与多账号中转管理。在长程编码任务启动前或用户询问额度/模型选择时，可调用 get_quota_status 自动获取各模型实时余量与智能路由推荐。`;
function apply(ctx) {
  const manager = new QuotaManager();
  ctx.effect(() => {
    const routes = makeQuotaRoutes(manager);
    const disposers = [];
    for (const r of routes) {
      disposers.push(ctx.webServer.register(r));
    }
    return () => {
      for (const d of disposers) d();
      manager.oauthManager.dispose();
    };
  }, "quota: routes");
  ctx.effect(() => {
    return ctx.systemPrompt.section({
      name: "plugin:quota-monitor",
      order: 210,
      text: GUIDANCE
    });
  }, "quota: system prompt");
  try {
    const registerTool = (targetTools) => {
      if (!targetTools) return;
      if (typeof targetTools.register === "function") {
        return targetTools.register({
          name: "get_quota_status",
          description: "查询当前配置的所有 AI 服务的实时剩余额度、余额、告警状态以及智能模型推荐路由。",
          parameters: {
            type: "object",
            properties: {
              provider: {
                type: "string",
                description: "可选：指定查询的 Provider 名称或实例 ID（如 deepseek, cursor, antigravity, kimi, glm, qwen）"
              },
              forceRefresh: {
                type: "boolean",
                description: "是否强制从各官方 API 重新拉取最新数据（默认 false 使用缓存）"
              }
            }
          },
          output: {
            schema: { type: "string" },
            render(_args, value) {
              return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }];
            }
          },
          execute: async (args, exec) => {
            if (exec?.signal?.aborted) {
              throw new Error("Tool execution aborted");
            }
            const summary = await manager.getAgentQuotaSummary(args?.provider, args?.forceRefresh);
            return JSON.stringify(summary, null, 2);
          }
        });
      }
      if (typeof targetTools.registerTool === "function") {
        return targetTools.registerTool({
          name: "get_quota_status",
          description: "查询当前配置的所有 AI 服务的实时剩余额度、余额、告警状态以及智能模型推荐路由。",
          parameters: {
            type: "object",
            properties: {
              provider: {
                type: "string",
                description: "可选：指定查询的 Provider 名称或实例 ID（如 deepseek, cursor, antigravity, kimi, glm, qwen）"
              },
              forceRefresh: {
                type: "boolean",
                description: "是否强制从各官方 API 重新拉取最新数据（默认 false 使用缓存）"
              }
            }
          },
          handler: async (args, exec) => {
            if (exec?.signal?.aborted) {
              throw new Error("Tool execution aborted");
            }
            return manager.getAgentQuotaSummary(args.provider, args.forceRefresh);
          }
        });
      }
    };
    if (ctx.tools) {
      ctx.effect(() => registerTool(ctx.tools), "quota: agent tool");
    } else if (typeof ctx.inject === "function") {
      ctx.inject(["tools"], (scoped) => {
        scoped.effect(() => registerTool(scoped.tools), "quota: agent tool");
      });
    } else if (ctx.agent) {
      ctx.effect(() => registerTool(ctx.agent), "quota: agent tool");
    }
  } catch {
  }
}
export {
  AntigravityProvider,
  ClaudeProvider,
  CodexProvider,
  CursorProvider,
  CustomApiProvider,
  DEFAULT_PROVIDER_ORDER,
  DeepSeekProvider,
  GLMProvider,
  GitHubCopilotProvider,
  KimiProvider,
  MiniMaxProvider,
  OpenAIBillingProvider,
  OpenCodeGoProvider,
  OpenRouterProvider,
  PLUGIN_VERSION,
  PROVIDER_DEFAULT_MODELS,
  QuotaManager,
  QwenProvider,
  SiliconFlowProvider,
  VERSION,
  VolcengineProvider,
  apply,
  atomicWriteJsonSync,
  fetchWithProxy,
  formatQuotaResetText,
  getRefreshIntervalSeconds,
  inject,
  isQuantified,
  runWithConcurrency,
  sanitizeProxyUrl,
  windowQuotaKind
};
