(function () {
var factory = (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  PANEL_ID: () => PANEL_ID,
  VERSION: () => VERSION,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/core/types.ts
var PLUGIN_VERSION = "0.4.3";
function windowQuotaKind(win) {
  if (win.quotaKind !== void 0) return win.quotaKind;
  return win.remainingPercent !== void 0 ? "usage" : "unknown";
}
function isQuantified(win) {
  if (windowQuotaKind(win) !== "usage") return false;
  return typeof win.remainingPercent === "number" && Number.isFinite(win.remainingPercent) && typeof win.usedPercent === "number" && Number.isFinite(win.usedPercent);
}

// src/client/api.ts
function makeHudMetricKey(provider, groupTitle, windowId) {
  return `${provider}::${encodeURIComponent(groupTitle)}::${encodeURIComponent(windowId)}`;
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
var QUOTA_REQUEST_HEADER = "X-DSH-Quota";
var REQUEST_TIMEOUT_MS = 8e3;
function resolveApiBase(input = {}) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const g = hasOwn("global") ? input.global : typeof globalThis === "undefined" ? void 0 : globalThis;
  const transportBase = g?.__DSH_TRANSPORT__?.streamBaseUrl;
  if (typeof transportBase === "string" && transportBase.trim() !== "") return transportBase.trim();
  const baseURI = hasOwn("baseURI") ? input.baseURI : typeof document === "undefined" ? void 0 : document.baseURI;
  if (typeof baseURI === "string" && baseURI.trim() !== "") return baseURI.trim();
  return "/";
}
function resolveApiUrl(path, input = {}) {
  const relative = path.replace(/^\/+/, "");
  const base = resolveApiBase(input);
  try {
    const normalized = base.endsWith("/") ? base : `${base}/`;
    return new URL(relative, normalized).href;
  } catch {
    return `/${relative}`;
  }
}
function escapeHtmlText(value) {
  if (value === void 0 || value === null) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeCardText(card) {
  return {
    ...card,
    name: escapeHtmlText(card.name),
    plan: card.plan === void 0 ? void 0 : escapeHtmlText(card.plan),
    account: card.account === void 0 ? void 0 : escapeHtmlText(card.account),
    error: card.error === void 0 ? void 0 : escapeHtmlText(card.error),
    groups: (card.groups || []).map((group) => ({
      ...group,
      title: escapeHtmlText(group.title),
      windows: (group.windows || []).map((win) => ({
        ...win,
        label: escapeHtmlText(win.label),
        subtitle: win.subtitle === void 0 ? void 0 : escapeHtmlText(win.subtitle),
        amountText: win.amountText === void 0 ? void 0 : escapeHtmlText(win.amountText)
      }))
    }))
  };
}
async function quotaFetch(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set(QUOTA_REQUEST_HEADER, "1");
  const requestInit = {
    ...init,
    headers,
    cache: "no-store"
  };
  if (init.signal === void 0) {
    requestInit.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  } else {
    requestInit.signal = init.signal;
  }
  try {
    return await fetch(resolveApiUrl(path), requestInit);
  } catch (err) {
    if (init.signal === void 0 && (err?.name === "TimeoutError" || err?.name === "AbortError")) {
      throw new Error(`额度接口请求超时（${Math.round(REQUEST_TIMEOUT_MS / 1e3)} 秒未响应）`);
    }
    throw new Error(`无法连接额度接口：${err?.message || String(err)}`);
  }
}
var QuotaClientApi = class {
  async getCards(force = false) {
    const res = await quotaFetch(`api/dsh-quota/status?force=${force}`);
    if (!res.ok) throw new Error(`获取额度失败 (${res.status})`);
    return res.json();
  }
  async refreshSingle(providerOrId) {
    const res = await quotaFetch(`api/dsh-quota/status?provider=${encodeURIComponent(providerOrId)}&force=true`);
    if (!res.ok) throw new Error(`刷新服务失败 (${res.status})`);
    const data = await res.json();
    if (data && data.card) return data.card;
    if (data && Array.isArray(data.cards)) {
      const found = data.cards.find((c) => c.id === providerOrId || c.provider === providerOrId);
      if (found) return found;
    }
    throw new Error(`未找到服务「${providerOrId}」的额度数据，可能已被删除、改名或禁用`);
  }
  async testConnection(provider, accountConfig) {
    const res = await quotaFetch("api/dsh-quota/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, accountConfig })
    });
    if (!res.ok) throw new Error(`测活请求失败 (${res.status})`);
    return res.json();
  }
  async testAllConnections() {
    const res = await quotaFetch("api/dsh-quota/test-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error(`一键测活失败 (${res.status})`);
    const data = await res.json();
    return data.results || {};
  }
  async getHistory(instanceId, days = 7) {
    const res = await quotaFetch(`api/dsh-quota/history?instanceId=${encodeURIComponent(instanceId)}&days=${days}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.points || [];
  }
  async getConfig() {
    const res = await quotaFetch("api/dsh-quota/config");
    if (!res.ok) throw new Error(`获取配置失败 (${res.status})`);
    return res.json();
  }
  async saveConfig(cfg) {
    const res = await quotaFetch("api/dsh-quota/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg)
    });
    if (!res.ok) throw new Error(`保存配置失败 (${res.status})`);
  }
  async startCodexLogin() {
    const res = await quotaFetch("api/dsh-quota/auth/codex/start");
    if (!res.ok) throw new Error(`启动 Codex 登录失败 (${res.status})`);
    const data = await res.json();
    return data.authUrl;
  }
  async startAntigravityLogin() {
    const res = await quotaFetch("api/dsh-quota/auth/antigravity/start");
    if (!res.ok) throw new Error(`启动 Antigravity 登录失败 (${res.status})`);
    const data = await res.json();
    return data.authUrl;
  }
  async connectCursor() {
    const res = await quotaFetch("api/dsh-quota/auth/cursor/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error(`连接 Cursor 失败 (${res.status})`);
    const data = await res.json();
    return data.card;
  }
};

// src/client/controller.ts
function formatErrorForUi(err) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim() !== "") return err;
  return "未知错误";
}
function alarmNotificationKey(alarm) {
  return `${alarm.instanceId}_${alarm.level}_${alarm.windowId ?? ""}`;
}
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
var QuotaController = class {
  constructor(api) {
    __publicField(this, "api");
    __publicField(this, "panelOpen", false);
    __publicField(this, "loading", false);
    __publicField(this, "testingAll", false);
    __publicField(this, "error");
    __publicField(this, "cards", []);
    __publicField(this, "allCards", []);
    __publicField(this, "alarms", []);
    __publicField(this, "testResults", {});
    __publicField(this, "refreshingProviders", /* @__PURE__ */ new Set());
    __publicField(this, "lastUpdated", 0);
    __publicField(this, "activeTab", "overview");
    __publicField(this, "activeCategory", "all");
    __publicField(this, "collapsedGroups", /* @__PURE__ */ new Set());
    __publicField(this, "config");
    __publicField(this, "listeners", /* @__PURE__ */ new Set());
    __publicField(this, "pollingTimer", null);
    __publicField(this, "notifiedAlarmIds", /* @__PURE__ */ new Set());
    __publicField(this, "onVisibilityChangeHandler");
    __publicField(this, "onWindowFocusHandler");
    __publicField(this, "isDestroyed", false);
    /** The refresh currently on the wire; concurrent refresh() callers join it. */
    __publicField(this, "inflight", null);
    this.api = api;
  }
  async init() {
    if (this.isDestroyed) return;
    await this.loadConfig();
    if (this.isDestroyed) return;
    await this.refresh(false);
    if (this.isDestroyed) return;
    this.startPolling();
    this.setupWindowListeners();
  }
  getRefreshIntervalSec() {
    return getRefreshIntervalSeconds(this.config);
  }
  isDocumentHidden() {
    if (typeof document === "undefined") return false;
    return document.hidden === true || document.visibilityState === "hidden";
  }
  startPolling() {
    if (this.isDestroyed) return;
    this.stopPolling();
    if (this.isDocumentHidden()) return;
    const intervalSec = this.getRefreshIntervalSec();
    const intervalMs = Math.max(5 * 1e3, intervalSec * 1e3);
    this.pollingTimer = setInterval(() => {
      if (this.isDestroyed) {
        this.stopPolling();
        return;
      }
      if (this.isDocumentHidden()) return;
      void this.refresh(false, true);
    }, intervalMs);
  }
  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
  /** Silent catch-up when data is older than the interval (capped at 60s). */
  refreshIfStale() {
    if (this.isDestroyed) return;
    const intervalSec = this.getRefreshIntervalSec();
    const staleThresholdMs = Math.min(60 * 1e3, intervalSec * 1e3);
    if (Date.now() - this.lastUpdated >= staleThresholdMs) {
      void this.refresh(false, true);
    }
  }
  setupWindowListeners() {
    if (this.isDestroyed) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (this.onVisibilityChangeHandler) return;
    this.onVisibilityChangeHandler = () => {
      if (this.isDestroyed) return;
      if (this.isDocumentHidden()) {
        this.stopPolling();
        return;
      }
      this.startPolling();
      this.refreshIfStale();
    };
    this.onWindowFocusHandler = () => {
      if (this.isDestroyed) return;
      if (this.isDocumentHidden()) return;
      this.refreshIfStale();
    };
    document.addEventListener("visibilitychange", this.onVisibilityChangeHandler);
    window.addEventListener("focus", this.onWindowFocusHandler);
  }
  /** Drop remembered alarms that are no longer active so the set stays bounded. */
  pruneNotifiedAlarms(alarms) {
    const activeKeys = new Set(alarms.map((alarm) => alarmNotificationKey(alarm)));
    for (const key of Array.from(this.notifiedAlarmIds)) {
      if (!activeKeys.has(key)) this.notifiedAlarmIds.delete(key);
    }
  }
  triggerDesktopNotification(alarms) {
    if (this.isDestroyed) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (this.config?.enableNotification === false) return;
    const criticalAlarms = alarms.filter((a) => a.level === "critical" && !this.notifiedAlarmIds.has(alarmNotificationKey(a)));
    if (criticalAlarms.length === 0) return;
    const send = () => {
      for (const a of criticalAlarms) {
        try {
          new Notification("DSH 额度监控告警", {
            body: a.message,
            icon: "/favicon.ico"
          });
          this.notifiedAlarmIds.add(alarmNotificationKey(a));
        } catch {
        }
      }
    };
    if (Notification.permission === "granted") {
      send();
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") send();
      }).catch(() => {
      });
    }
  }
  destroy() {
    this.isDestroyed = true;
    this.inflight = null;
    this.stopPolling();
    if (typeof document !== "undefined" && this.onVisibilityChangeHandler) {
      document.removeEventListener("visibilitychange", this.onVisibilityChangeHandler);
      this.onVisibilityChangeHandler = void 0;
    }
    if (typeof window !== "undefined" && this.onWindowFocusHandler) {
      window.removeEventListener("focus", this.onWindowFocusHandler);
      this.onWindowFocusHandler = void 0;
    }
    this.listeners.clear();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit() {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (err) {
        console.error("[dsh-quota] listener failed:", err);
      }
    }
  }
  getSnapshot() {
    const cfg = this.config;
    const orderList = cfg?.providerOrder && cfg.providerOrder.length > 0 ? cfg.providerOrder : DEFAULT_PROVIDER_ORDER;
    const enabledSet = cfg?.enabledProviders ? new Set(cfg.enabledProviders) : null;
    const pool = this.allCards.length > 0 ? this.allCards : this.cards;
    let visibleCards = pool;
    if (this.activeCategory !== "all") {
      visibleCards = visibleCards.filter((c) => c.category === this.activeCategory);
    }
    if (enabledSet) {
      visibleCards = visibleCards.filter((c) => {
        if (c.provider === "custom_api") {
          return enabledSet.has(c.id);
        }
        return enabledSet.has(c.id) || enabledSet.has(c.provider);
      });
    }
    visibleCards = visibleCards.filter((c) => c.status !== "disabled");
    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.id) !== -1 ? orderList.indexOf(a.id) : orderList.indexOf(a.provider);
      const idxB = orderList.indexOf(b.id) !== -1 ? orderList.indexOf(b.id) : orderList.indexOf(b.provider);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
    return {
      panelOpen: this.panelOpen,
      loading: this.loading,
      testingAll: this.testingAll,
      error: this.error,
      cards: visibleCards,
      allCards: this.allCards.length > 0 ? this.allCards : this.cards,
      alarms: this.alarms,
      testResults: this.testResults,
      refreshingProviders: new Set(this.refreshingProviders),
      lastUpdated: this.lastUpdated,
      activeTab: this.activeTab,
      activeCategory: this.activeCategory,
      collapsedGroups: new Set(this.collapsedGroups),
      config: this.config
    };
  }
  hasAlarms() {
    return this.alarms.length > 0 || this.cards.some((c) => c.status === "warn" || c.status === "error");
  }
  open() {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.emit();
    void this.refresh();
    void this.loadConfig();
  }
  close() {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.emit();
  }
  toggle() {
    if (this.panelOpen) this.close();
    else this.open();
  }
  setTab(tab) {
    this.activeTab = tab;
    this.emit();
  }
  setCategory(category) {
    this.activeCategory = category;
    this.emit();
  }
  toggleGroupCollapse(groupId) {
    if (this.collapsedGroups.has(groupId)) {
      this.collapsedGroups.delete(groupId);
    } else {
      this.collapsedGroups.add(groupId);
    }
    this.emit();
  }
  /**
   * Refresh cards, merging concurrent calls (polling + focus + manual refresh)
   * onto one in-flight request. `silent` only hides the loading indicator; a
   * failure is always recorded so the header can show "last updated + failed".
   */
  async refresh(force = false, silent = false) {
    if (this.inflight !== null) return this.inflight;
    let tracked;
    tracked = this.performRefresh(force, silent).finally(() => {
      if (this.inflight === tracked) this.inflight = null;
    });
    this.inflight = tracked;
    return tracked;
  }
  async performRefresh(force, silent) {
    if (!silent) {
      this.loading = true;
      this.error = void 0;
      this.emit();
    }
    try {
      const data = await this.api.getCards(force);
      this.cards = (data.cards || []).map(escapeCardText);
      this.allCards = (data.allCards || data.cards || []).map(escapeCardText);
      this.alarms = data.alarms || [];
      if (typeof data.lastUpdated === "number" && Number.isFinite(data.lastUpdated)) {
        this.lastUpdated = data.lastUpdated;
      }
      this.error = void 0;
      this.pruneNotifiedAlarms(this.alarms);
      this.triggerDesktopNotification(this.alarms);
    } catch (err) {
      this.error = formatErrorForUi(err);
    } finally {
      if (!silent) {
        this.loading = false;
      }
      this.emit();
    }
  }
  async refreshSingle(providerOrId) {
    this.refreshingProviders.add(providerOrId);
    this.emit();
    try {
      const updatedCard = escapeCardText(await this.api.refreshSingle(providerOrId));
      const idx = this.cards.findIndex((c) => c.id === providerOrId || c.provider === providerOrId);
      if (idx !== -1) this.cards[idx] = updatedCard;
      const allIdx = this.allCards.findIndex((c) => c.id === providerOrId || c.provider === providerOrId);
      if (allIdx !== -1) this.allCards[allIdx] = updatedCard;
      this.lastUpdated = Date.now();
      this.error = void 0;
    } catch (err) {
      this.error = formatErrorForUi(err);
    } finally {
      this.refreshingProviders.delete(providerOrId);
      this.emit();
    }
  }
  async testConnection(provider, accountConfig) {
    const res = await this.api.testConnection(provider, accountConfig);
    this.testResults[accountConfig?.id || provider] = res;
    this.emit();
    return res;
  }
  async testAllConnections() {
    this.testingAll = true;
    this.emit();
    try {
      const results = await this.api.testAllConnections();
      this.testResults = { ...this.testResults, ...results };
      return results;
    } finally {
      this.testingAll = false;
      this.emit();
    }
  }
  async getHistory(instanceId, days = 7) {
    return this.api.getHistory(instanceId, days);
  }
  async loadConfig() {
    try {
      this.config = await this.api.getConfig();
      this.emit();
      this.startPolling();
    } catch (err) {
      this.error = formatErrorForUi(err);
      this.emit();
    }
  }
  async saveConfig(cfg) {
    const previousConfig = this.config;
    this.config = cfg;
    this.loading = true;
    this.emit();
    try {
      await this.api.saveConfig(cfg);
      this.startPolling();
      await this.refresh(true);
    } catch (err) {
      this.config = previousConfig;
      this.error = formatErrorForUi(err);
    } finally {
      this.loading = false;
      this.emit();
    }
  }
  async startCodexLogin() {
    return this.api.startCodexLogin();
  }
  async startAntigravityLogin() {
    return this.api.startAntigravityLogin();
  }
  async connectCursor() {
    return this.api.connectCursor();
  }
};

// src/client/sidebar-entry-core.ts
function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return void 0;
  const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement;
  return logoOwner ?? column.firstElementChild;
}
function newSessionButton(root) {
  const nested = root.querySelector('button[class*="newSession"]');
  if (nested !== null) return nested;
  for (const child of root.children) {
    if (child.tagName === "BUTTON") return child;
  }
  return void 0;
}
function createEntry(options) {
  const entry = document.createElement("button");
  entry.type = "button";
  entry.spellcheck = false;
  entry.setAttribute(options.rowAttribute, "");
  if (options.plugin !== void 0) {
    entry.setAttribute("data-dsh-plugin", options.plugin);
    entry.setAttribute("data-dsh-part", "sidebar-entry");
  }
  entry.className = options.css["entry"] ?? "";
  entry.setAttribute("aria-label", options.label());
  if (options.tooltip !== void 0) entry.setAttribute("title", options.tooltip());
  entry.innerHTML = '<span class="' + (options.css["entryIcon"] ?? "") + '">' + options.icon + '</span><span class="' + (options.css["entryLabel"] ?? "") + '">' + options.label() + "</span>";
  entry.addEventListener("click", options.onToggle);
  return entry;
}
function placeEntry(root, entry, options) {
  const button = newSessionButton(root);
  if (button === void 0) return false;
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]');
    const base = row !== null && row.parentElement === root ? row : button;
    const family = Array.from(root.children).filter(
      (el) => el instanceof HTMLElement && el.matches(options.familySelectors.join(", "))
    );
    const anchor = options.position === "before" ? family.length > 0 ? family[0] : base.nextElementSibling : family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling;
    root.insertBefore(entry, anchor);
  }
  return true;
}
function mountSidebarEntry(options) {
  if (typeof document === "undefined") return () => {
  };
  for (const stale of Array.from(document.querySelectorAll(options.rowSelector))) {
    stale.remove();
  }
  const entry = createEntry(options);
  let root;
  let placed = false;
  let frameId = null;
  const requestFrame = (callback) => {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(() => callback());
    return setTimeout(callback, 16);
  };
  const cancelFrame = (id) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    else clearTimeout(id);
  };
  const observer = new MutationObserver(() => {
    if (frameId !== null) return;
    frameId = requestFrame(() => {
      frameId = null;
      tryPlace();
    });
  });
  const observeNarrow = (target) => {
    observer.disconnect();
    observer.observe(target, { childList: true, subtree: true });
    if (target.parentElement !== null) observer.observe(target.parentElement, { childList: true });
    observer.observe(document.body, { childList: true });
  };
  const observeBroad = () => {
    observer.disconnect();
    observer.observe(document.body, { childList: true, subtree: true });
  };
  const tryPlace = () => {
    if (root !== void 0 && !root.isConnected) {
      root = void 0;
      placed = false;
    }
    if (placed) {
      if (document.body.contains(entry)) return;
      placed = false;
    }
    root ?? (root = sidebarRoot());
    if (root === void 0) {
      observeBroad();
      return;
    }
    placed = placeEntry(root, entry, options);
    if (placed) observeNarrow(root);
  };
  const unsubscribeActive = options.active === void 0 ? void 0 : (() => {
    const syncActive = () => {
      if (options.active.isOpen()) entry.dataset.active = "true";
      else delete entry.dataset.active;
    };
    const unsubscribe = options.active.subscribe(syncActive);
    syncActive();
    return unsubscribe;
  })();
  tryPlace();
  if (root === void 0) observeBroad();
  return () => {
    observer.disconnect();
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    unsubscribeActive?.();
    entry.remove();
  };
}

// src/client/sidebar-entry.ts
var ENTRY_SELECTOR = "[data-dsh-quota-entry]";
var ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3.49 13.26A6.375 6.375 0 1 1 12.51 13.26" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M8 8.75L11.4 5.35" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="8" cy="8.75" r="1.55" fill="currentColor"/></svg>';
function ensureSidebarStyles() {
  if (document.getElementById("dsh-quota-sidebar-style")) return;
  const style = document.createElement("style");
  style.id = "dsh-quota-sidebar-style";
  style.textContent = `
    .dsh-quota-entry {
      box-sizing: border-box;
      min-height: 36px;
      height: 36px;
      width: calc(100% - 4px);
      margin: 0 2px 4px 2px;
      padding: 7px 8px;
      background: transparent;
      border: none;
      border-radius: 12px;
      color: var(--dsw-alias-label-primary, #1f2328);
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      line-height: 22px;
      white-space: nowrap;
      text-align: left;
      text-decoration: none !important;
      align-items: center;
      gap: 8px;
      display: flex;
      user-select: none;
      position: relative;
      transition: background-color 120ms ease, color 120ms ease;
    }
    .dsh-quota-entry:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .dsh-quota-entry[data-active] {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-weight: 400;
    }
    .dsh-quota-entry:focus-visible {
      outline: 2px solid var(--dsw-alias-label-primary, #1f2328);
      outline-offset: -2px;
    }
    .dsh-quota-entry-icon {
      flex: none;
      justify-content: center;
      align-items: center;
      display: inline-flex;
      width: 16px;
      height: 16px;
      color: inherit;
      position: relative;
    }
    .dsh-quota-entry-icon svg {
      display: block;
      width: 16px;
      height: 16px;
    }
    .dsh-quota-entry-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
      font-size: 14px;
      line-height: 22px;
      color: inherit;
      text-decoration: none !important;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry,
    [data-sidebar-collapsed] .dsh-quota-entry {
      width: 36px;
      height: 36px;
      margin: 0 auto 4px;
      padding: 0;
      justify-content: center;
      border-radius: 12px;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-icon,
    [data-sidebar-collapsed] .dsh-quota-entry-icon {
      width: 18px;
      height: 18px;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-icon svg,
    [data-sidebar-collapsed] .dsh-quota-entry-icon svg {
      width: 18px;
      height: 18px;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-label,
    [data-sidebar-collapsed] .dsh-quota-entry-label {
      display: none;
    }
  `;
  document.head.appendChild(style);
}
function mountQuotaSidebarEntry(controller) {
  ensureSidebarStyles();
  return mountSidebarEntry({
    rowAttribute: "data-dsh-quota-entry",
    rowSelector: ENTRY_SELECTOR,
    plugin: "quota",
    icon: ICON,
    css: {
      entry: "dsh-quota-entry",
      entryIcon: "dsh-quota-entry-icon",
      entryLabel: "dsh-quota-entry-label"
    },
    label: () => "额度监控",
    tooltip: () => "查看各 AI 模型与编程助手剩余额度与用量",
    onToggle: () => controller.toggle(),
    position: "after",
    familySelectors: ["[data-dsh-taskboard-entry]", "[data-dsh-ssh-entry]", "[data-dsh-skill-entry]", "[data-dsh-quota-entry]"],
    active: {
      subscribe: (listener) => {
        return controller.subscribe(() => {
          const entryEl = document.querySelector(ENTRY_SELECTOR);
          if (entryEl) {
            entryEl.dataset.alarm = controller.hasAlarms() ? "true" : "false";
          }
          listener();
        });
      },
      isOpen: () => controller.getSnapshot().panelOpen
    }
  });
}

// src/client/view.ts
var PROVIDER_METAS = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    category: "domestic_llm",
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://api.deepseek.com",
    hasBaseUrl: true
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    category: "ide",
    keyLabel: "Session Token (可选)",
    keyPlaceholder: "WorkosCursorSessionToken (从浏览器 Cookie 复制)",
    hasLocalDetect: true,
    localDetectLabel: "自动探测本地 state.vscdb (推荐)"
  },
  antigravity: {
    id: "antigravity",
    name: "Google Antigravity",
    category: "official_cloud",
    isOauth: true,
    oauthProvider: "antigravity",
    hasLocalDetect: true,
    localDetectLabel: "自动探测本地凭据 (gcloud/auth)"
  },
  codex: {
    id: "codex",
    name: "Codex (ChatGPT)",
    category: "official_cloud",
    isOauth: true,
    oauthProvider: "codex",
    keyLabel: "Access Token (可选手动填入)",
    keyPlaceholder: "access_token",
    hasLocalDetect: true,
    localDetectLabel: "自动探测本地 ~/.codex/auth.json"
  },
  github_copilot: {
    id: "github_copilot",
    name: "GitHub Copilot",
    category: "ide",
    keyLabel: "GitHub Token (可选)",
    keyPlaceholder: "gho_... / ghp_...",
    hasLocalDetect: true,
    localDetectLabel: "自动探测本地 VS Code Copilot 登录态"
  },
  openai_billing: {
    id: "openai_billing",
    name: "OpenAI Platform",
    category: "official_cloud",
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://api.openai.com",
    hasBaseUrl: true
  },
  claude: {
    id: "claude",
    name: "Anthropic Claude",
    category: "official_cloud",
    keyLabel: "API Key",
    keyPlaceholder: "sk-ant-...",
    defaultBaseUrl: "https://api.anthropic.com",
    hasBaseUrl: true
  },
  kimi: {
    id: "kimi",
    name: "Moonshot Kimi",
    category: "domestic_llm",
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://api.moonshot.cn",
    hasBaseUrl: true
  },
  glm: {
    id: "glm",
    name: "智谱清言 (GLM)",
    category: "domestic_llm",
    keyLabel: "API Key",
    keyPlaceholder: "id.secret",
    defaultBaseUrl: "https://open.bigmodel.cn",
    hasBaseUrl: true
  },
  minimax: {
    id: "minimax",
    name: "MiniMax (海螺)",
    category: "domestic_llm",
    keyLabel: "API Key",
    keyPlaceholder: "API Key",
    defaultBaseUrl: "https://api.minimax.chat",
    hasBaseUrl: true,
    hasGroupId: true
  },
  qwen: {
    id: "qwen",
    name: "阿里通义千问",
    category: "domestic_llm",
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://dashscope.aliyuncs.com",
    hasBaseUrl: true
  },
  volcengine: {
    id: "volcengine",
    name: "火山方舟 (豆包)",
    category: "domestic_llm",
    keyLabel: "API Key",
    keyPlaceholder: "ark api key",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com",
    hasBaseUrl: true
  },
  siliconflow: {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    category: "domestic_llm",
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://api.siliconflow.cn",
    hasBaseUrl: true
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    category: "official_cloud",
    keyLabel: "API Key",
    keyPlaceholder: "sk-or-v1-...",
    defaultBaseUrl: "https://openrouter.ai/api",
    hasBaseUrl: true
  },
  opencode_go: {
    id: "opencode_go",
    name: "OpenCode Go",
    category: "official_cloud",
    keyLabel: "API Key",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://opencode.cc",
    hasBaseUrl: true
  }
};
var CATEGORY_NAMES = {
  all: "全部服务",
  domestic_llm: "国内大模型",
  ide: "IDE 编程助手",
  official_cloud: "海外官方",
  custom_api: "自定义中转"
};
function esc(value) {
  if (value === void 0 || value === null) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatRelativeTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const diffMs = now - timestamp;
  if (diffMs < 45 * 1e3) return "刚刚";
  if (diffMs < 60 * 60 * 1e3) return `${Math.max(1, Math.round(diffMs / 6e4))} 分钟前`;
  if (diffMs < 24 * 60 * 60 * 1e3) return `${Math.max(1, Math.round(diffMs / 36e5))} 小时前`;
  return `${Math.max(1, Math.round(diffMs / 864e5))} 天前`;
}
function renderProvenanceBadge(card) {
  const provenance = card.sourceProvenance;
  if (!provenance) return "";
  const labels = {
    "official-summary": "官方",
    "model-fallback": "模型",
    "local-state": "本地",
    "oauth-api": "OAuth",
    "user-balance": "余额"
  };
  const label = labels[provenance.method ?? ""] ?? "估算";
  const parts = [label];
  if (provenance.host) parts.push(provenance.host);
  if (provenance.endpoint) parts.push(provenance.endpoint);
  if (provenance.timestamp) parts.push(new Date(provenance.timestamp).toLocaleString());
  if (provenance.partial) parts.push("部分数据");
  return `<span class="quota-provenance" title="${esc(parts.join(" · "))}">${label}</span>`;
}
function recordDailySummary(summary) {
  if (typeof localStorage === "undefined") return {};
  const key = "dsh_quota_summary_daily";
  const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    const today = dayKey(/* @__PURE__ */ new Date());
    const yesterday = dayKey(new Date(Date.now() - 864e5));
    stored[today] = { ...summary, at: Date.now() };
    const keys = Object.keys(stored).sort();
    for (const stale of keys.slice(0, Math.max(0, keys.length - 8))) delete stored[stale];
    localStorage.setItem(key, JSON.stringify(stored));
    return stored[yesterday] ?? {};
  } catch {
    return {};
  }
}
function renderSummaryDelta(current, previous, positiveIsBad) {
  if (previous === void 0 || !Number.isFinite(previous)) return '<span class="trend-flat">· 较昨日 —</span>';
  const delta = current - previous;
  if (delta === 0) return '<span class="trend-flat">· 较昨日 持平</span>';
  const bad = positiveIsBad ? delta > 0 : delta < 0;
  const cls = bad ? "trend-up" : "trend-down";
  return `<span class="${cls}">· 较昨日 ${delta > 0 ? "+" : ""}${delta}</span>`;
}
function getQuotaStatusColor(remainingPercent) {
  if (remainingPercent <= 15) return "var(--q-error)";
  if (remainingPercent <= 35) return "var(--q-warn)";
  return "var(--q-success)";
}
function renderHelp(text) {
  return `
    <span class="quota-help-tip" data-tooltip="${text}" title="${text}" tabindex="0">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
        <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
      </svg>
    </span>
  `;
}
function formatWindowSubtitle(win, now = Date.now()) {
  const kind = windowQuotaKind(win);
  const subtitle = typeof win.subtitle === "string" && win.subtitle.trim() !== "" ? win.subtitle : "";
  if (kind === "usage" && isQuantified(win)) {
    const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)));
    const used = Math.max(0, Math.min(100, Math.round(win.usedPercent)));
    if (rem >= 100 || used <= 0) return "已用 0% · 额度充足";
    if (win.resetAt) {
      const resetDate = new Date(win.resetAt);
      if (!isNaN(resetDate.getTime())) {
        const diffMs = resetDate.getTime() - now;
        if (diffMs > 0) {
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
          const fullTimeStr = days > 0 ? `${dateStr} ${timeStr}` : timeStr;
          let countdown = "";
          if (days > 0) countdown = `${days} 天${hours > 0 ? ` ${hours} 小时` : ""}后`;
          else if (hours > 0) countdown = `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}后`;
          else countdown = `${minutes} 分钟后`;
          return `已用 ${used}% · 预计 ${countdown}重置 (${fullTimeStr})`;
        }
        return `已用 ${used}% · 即将重置`;
      }
    }
    return subtitle || `已用 ${used}%`;
  }
  if (kind === "balance") {
    if (subtitle) return subtitle;
    const amountText = typeof win.amountText === "string" ? win.amountText.trim() : "";
    return amountText !== "" ? `余额 ${amountText}` : "—";
  }
  if (kind === "liveness") return subtitle || "已连接 · 未提供额度接口";
  return subtitle || "额度状态未知";
}
function formatClockTime(timestamp) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function renderCircleProgress(remainingPercent) {
  const size = 32;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedRem = Math.max(0, Math.min(100, Math.round(remainingPercent)));
  const offset = circumference - clampedRem / 100 * circumference;
  const color = getQuotaStatusColor(clampedRem);
  const label = clampedRem <= 0 ? "额度已用尽 0%" : `剩余 ${clampedRem}%`;
  return `
    <div class="row-ring${clampedRem <= 0 ? " is-zero" : ""}${clampedRem >= 100 ? " is-wide" : ""}" role="img" aria-label="${label}" title="${label}">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${stroke}" fill="none" style="stroke: var(--q-track);"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${stroke}" fill="none"
          style="stroke: ${color}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; stroke-linecap: round; transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;"/>
      </svg>
      <span class="row-ring-label" style="color: ${color};">${clampedRem}%</span>
    </div>
  `;
}
function renderSparklineSvg(points) {
  const valid = Array.isArray(points) ? points.filter((point) => point !== null && point !== void 0 && typeof point.r === "number" && Number.isFinite(point.r)) : [];
  if (valid.length < 2) {
    return `<span class="spark-empty" title="需要至少 2 个采样点才能绘制趋势">数据积累中</span>`;
  }
  const recent = valid.slice(-7);
  if (recent.every((point) => Math.round(point.r) <= 0)) {
    return `<span class="spark-empty" title="近 7 天没有记录到消耗">近 7 天无消耗</span>`;
  }
  const barLabel = (point) => {
    const date = new Date(point.t);
    const day = `${date.getMonth() + 1}/${date.getDate()}`;
    return `${day} 相对用量 ${Math.round(Math.max(0, Math.min(100, point.r)))}%`;
  };
  const bars = recent.map((point, index) => {
    const value = Math.max(0, Math.min(100, point.r));
    const height = Math.max(2, Math.round(value / 100 * 22));
    const last = index === recent.length - 1;
    return `<span class="spark-bar${last ? " is-last" : ""}" style="height: ${height}px;" title="${esc(barLabel(point))}"></span>`;
  }).join("");
  return `<span class="spark-wrap quota-sparkline-wrap" role="img" aria-label="近 7 天相对用量柱状图" title="近 7 天相对用量（按窗口自身归一化）">${bars}</span>`;
}
function showToast(message, type = "success") {
  if (typeof document === "undefined") return;
  let toastEl = document.getElementById("dsh-quota-toast");
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.id = "dsh-quota-toast";
    toastEl.className = "dsh-quota-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.className = `dsh-quota-toast show ${type}`;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    if (toastEl) toastEl.className = "dsh-quota-toast";
  }, 2600);
}
function showConfirmModal(opts, onOpen) {
  if (typeof document === "undefined") return;
  const overlay = document.createElement("div");
  overlay.className = "dsh-quota-modal-overlay";
  overlay.innerHTML = `
    <div class="dsh-quota-modal">
      <div class="dsh-quota-modal-title">${opts.title}</div>
      <div class="dsh-quota-modal-body">${opts.content}</div>
      <div class="dsh-quota-modal-footer">
        <button type="button" class="quota-btn secondary btn-modal-cancel">取消</button>
        <button type="button" class="quota-btn danger btn-modal-confirm">${opts.confirmText || "确认删除"}</button>
      </div>
    </div>
  `;
  onOpen?.(overlay);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".btn-modal-cancel")?.addEventListener("click", close);
  overlay.querySelector(".btn-modal-confirm")?.addEventListener("click", () => {
    close();
    opts.onConfirm();
  });
}
function downloadJsonFile(filename, data) {
  if (typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function sanitizeConfigForExport(cfg) {
  const copy = JSON.parse(JSON.stringify(cfg || {}));
  const keyProps = ["apiKey", "sessionToken", "token"];
  for (const [, v] of Object.entries(copy)) {
    if (v && typeof v === "object") {
      for (const kp of keyProps) {
        if (v[kp]) v[kp] = "***";
      }
      if (v.oauth?.accessToken) v.oauth.accessToken = "***";
      if (v.oauth?.refreshToken) v.oauth.refreshToken = "***";
    }
  }
  if (Array.isArray(copy.custom_compatible)) {
    copy.custom_compatible = copy.custom_compatible.map((item) => ({
      ...item,
      apiKey: item.apiKey ? "***" : ""
    }));
  }
  if (Array.isArray(copy.accounts)) {
    copy.accounts = copy.accounts.map((item) => ({
      ...item,
      apiKey: item.apiKey ? "***" : void 0,
      sessionToken: item.sessionToken ? "***" : void 0,
      oauth: item.oauth ? {
        ...item.oauth,
        accessToken: item.oauth.accessToken ? "***" : void 0,
        refreshToken: item.oauth.refreshToken ? "***" : void 0
      } : void 0
    }));
  }
  return copy;
}
function maskSecret(str) {
  if (!str) return "";
  const trimmed = str.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
function getCredentialInfo(id, cfg) {
  if (!cfg) return { isConfigured: false, displayValue: "未配置" };
  if (Array.isArray(cfg.custom_compatible)) {
    const cust = cfg.custom_compatible.find((c) => c.id === id);
    if (cust) {
      const hasKey = Boolean(cust.apiKey?.trim());
      return {
        isConfigured: hasKey,
        displayValue: hasKey ? maskSecret(cust.apiKey) : "未配置"
      };
    }
  }
  switch (id) {
    case "deepseek": {
      const k = cfg.deepseek?.apiKey?.trim();
      return { isConfigured: Boolean(k), displayValue: k ? maskSecret(k) : "未配置" };
    }
    case "cursor": {
      const token = cfg.cursor?.sessionToken?.trim();
      const auto = cfg.cursor?.autoDetectLocal !== false && cfg.cursor?.enabled !== false;
      if (token) return { isConfigured: true, displayValue: maskSecret(token) };
      if (auto) return { isConfigured: true, displayValue: "本地探测 (state.vscdb)" };
      return { isConfigured: false, displayValue: "未配置" };
    }
    case "antigravity": {
      const email = cfg.antigravity?.oauth?.email;
      const authed = Boolean(cfg.antigravity?.oauth?.accessToken);
      const auto = cfg.antigravity?.autoDetectLocal !== false && cfg.antigravity?.enabled !== false;
      if (authed) return { isConfigured: true, displayValue: email ? `Google (${email})` : "已授权" };
      if (auto) return { isConfigured: true, displayValue: "本地凭据 (gcloud)" };
      return { isConfigured: false, displayValue: "未配置" };
    }
    case "codex": {
      const authed = Boolean(cfg.codex?.oauth?.accessToken);
      const auto = cfg.codex?.autoDetectLocal !== false && cfg.codex?.enabled !== false;
      if (authed) return { isConfigured: true, displayValue: "OAuth Token" };
      if (auto) return { isConfigured: true, displayValue: "本地凭据 (auth.json)" };
      return { isConfigured: false, displayValue: "未配置" };
    }
    case "github_copilot": {
      const token = cfg.github_copilot?.token?.trim();
      const auto = cfg.github_copilot?.autoDetectLocal !== false && cfg.github_copilot?.enabled === true;
      if (token) return { isConfigured: true, displayValue: maskSecret(token) };
      if (auto) return { isConfigured: true, displayValue: "本地凭据 (VS Code)" };
      return { isConfigured: false, displayValue: "未配置" };
    }
    default: {
      const provConf = cfg[id];
      const key = provConf?.apiKey?.trim();
      return { isConfigured: Boolean(key), displayValue: key ? maskSecret(key) : "未配置" };
    }
  }
}
function getServiceDisplayName(id, cfg, defaultName) {
  if (cfg.customNames && cfg.customNames[id]) {
    return cfg.customNames[id];
  }
  const provConf = cfg[id];
  if (provConf && provConf.name) {
    return provConf.name;
  }
  if (Array.isArray(cfg.custom_compatible)) {
    const cust = cfg.custom_compatible.find((c) => c.id === id);
    if (cust && cust.name) return cust.name;
  }
  return defaultName;
}
function getAvailableHudMetricsForTarget(target, cards) {
  const provId = target.kind === "custom" ? target.endpoint.id : target.kind === "new_custom" ? "custom" : target.id;
  const card = cards.find((c) => c.id === provId || c.provider === provId);
  const dynamicItems = [];
  if (card && card.groups && card.groups.length > 0) {
    for (const g of card.groups) {
      for (const w of g.windows) {
        let label = `${g.title} · ${w.label}`;
        if (card.provider === "antigravity") {
          if (w.id === "gemini-weekly") label = "Gemini 模型 · 周限额 (周用量)";
          else if (w.id === "gemini-5h") label = "Gemini 模型 · 5小时限额";
          else if (w.id === "claude-weekly") label = "Claude & GPT 模型 · 周限额 (周用量)";
          else if (w.id === "claude-5h") label = "Claude & GPT 模型 · 5小时限额";
        } else if (card.provider === "cursor") {
          if (w.id === "cursor-auto") label = "Fast Requests (核心高速请求)";
          else if (w.id === "cursor-named") label = "Other Models (其他通用模型)";
        }
        dynamicItems.push({
          key: makeHudMetricKey(card.provider, g.title, w.id),
          label
        });
      }
    }
  }
  if (dynamicItems.length > 0) return dynamicItems;
  if (target.kind === "provider") {
    const prov = target.id;
    if (prov === "antigravity") {
      return [
        { key: makeHudMetricKey("antigravity", "Gemini Models", "gemini-weekly"), label: "Gemini 模型 · 周限额 (周用量)" },
        { key: makeHudMetricKey("antigravity", "Gemini Models", "gemini-5h"), label: "Gemini 模型 · 5小时限额" },
        { key: makeHudMetricKey("antigravity", "Claude and GPT models", "claude-weekly"), label: "Claude & GPT 模型 · 周限额 (周用量)" },
        { key: makeHudMetricKey("antigravity", "Claude and GPT models", "claude-5h"), label: "Claude & GPT 模型 · 5小时限额" }
      ];
    }
    if (prov === "cursor") {
      return [
        { key: makeHudMetricKey("cursor", "Cursor Plan Usage", "cursor-auto"), label: "Fast Requests (核心高速请求)" },
        { key: makeHudMetricKey("cursor", "Cursor Plan Usage", "cursor-named"), label: "Other Models (其他通用模型)" }
      ];
    }
    if (prov === "codex") {
      return [
        { key: makeHudMetricKey("codex", "Codex 额度", "codex-weekly"), label: "Codex / ChatGPT 周限额 (Weekly Limit)" }
      ];
    }
    if (prov === "github_copilot") {
      return [
        { key: makeHudMetricKey("github_copilot", "Copilot 订阅与状态", "copilot-access"), label: "GitHub Copilot 订阅配额" }
      ];
    }
    if (prov === "deepseek") {
      return [
        { key: makeHudMetricKey("deepseek", "Balance", "deepseek"), label: "DeepSeek 可用余额" }
      ];
    }
    if (prov === "kimi") {
      return [
        { key: makeHudMetricKey("kimi", "Balance", "kimi"), label: "Kimi 可用余额" }
      ];
    }
    if (prov === "glm") {
      return [
        { key: makeHudMetricKey("glm", "Balance", "glm"), label: "智谱 GLM 可用余额" }
      ];
    }
    if (prov === "minimax") {
      return [
        { key: makeHudMetricKey("minimax", "Balance", "minimax"), label: "MiniMax 可用余额" }
      ];
    }
    if (prov === "qwen") {
      return [
        { key: makeHudMetricKey("qwen", "Balance", "qwen"), label: "通义千问可用余额" }
      ];
    }
    if (prov === "volcengine") {
      return [
        { key: makeHudMetricKey("volcengine", "Balance", "volcengine"), label: "火山方舟可用余额" }
      ];
    }
    if (prov === "siliconflow") {
      return [
        { key: makeHudMetricKey("siliconflow", "硅基流动账户配额", "siliconflow-balance"), label: "硅基流动可用余额" }
      ];
    }
    if (prov === "openrouter") {
      return [
        { key: makeHudMetricKey("openrouter", "OpenRouter 配额状态", "openrouter-limit"), label: "OpenRouter 配额状态" }
      ];
    }
    if (prov === "openai_billing") {
      return [
        { key: makeHudMetricKey("openai_billing", "OpenAI 账单额度", "openai-usage"), label: "OpenAI 月度账单用量" }
      ];
    }
    if (prov === "claude") {
      return [
        { key: makeHudMetricKey("claude", "API 额度", "claude-rate"), label: "Claude API 连通与配额" }
      ];
    }
    if (prov === "opencode_go") {
      return [
        { key: makeHudMetricKey("opencode_go", "Balance", "opencode_go"), label: "OpenCode 可用额度" }
      ];
    }
  }
  return [
    { key: makeHudMetricKey(provId, "Balance", provId), label: "中转站可用余额" }
  ];
}
function renderQuotaApp(container, controller) {
  container.setAttribute("data-dsh-quota-view", "");
  container.setAttribute("data-dsh-plugin", "quota");
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    [data-pane='conversation'], [class*='centerCol'] {
      position: relative;
    }
    [data-dsh-quota-view] {
      position: absolute;
      inset: 0;
      display: none;
      z-index: 60;
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, var(--q-fg));
      overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    html[data-dsh-quota-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-quota-view] {
      display: block;
    }
    html[data-dsh-quota-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-quota-view]),
    html[data-dsh-quota-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-quota-view]) {
      display: none !important;
    }

    /* Container & Layout */
    .quota-container {
      max-width: 820px;
      margin: 0 auto;
      padding: 24px 20px 64px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .quota-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1));
      padding-bottom: 14px;
    }
    .quota-title {
      font-size: 17.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.2px;
    }
    .quota-version-tag {
      font-size: 11px;
      font-weight: 600;
      color: var(--dsw-alias-brand-primary, var(--q-brand));
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04));
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .quota-tabs {
      display: flex;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
    }
    .quota-tab-btn {
      padding: 5px 14px;
      font-size: 13px;
      font-weight: 600;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .quota-tab-btn:hover {
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .quota-tab-btn.active {
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, var(--q-fg));
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    /* Overview Grid & Badges */
    .dashboard-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .summary-card {
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.015));
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .summary-card-label {
      font-size: 11.5px;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      font-weight: 500;
    }
    .summary-card-val {
      font-size: 20px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
      letter-spacing: -0.4px;
    }
    .category-filter-bar {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .category-chip {
      padding: 4px 11px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 14px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      background: transparent;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .category-chip:hover {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
    }
    .category-chip.active {
      background: var(--q-success);
      color: var(--q-on-solid);
      border-color: var(--q-success);
      font-weight: 600;
    }

    /* Section Card in Overview */
    .quota-section {
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
      border-radius: 10px;
      background: var(--dsw-alias-bg-base, #ffffff);
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
    }
    .auth-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .auth-section-title {
      font-size: 14.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
    }
    .btn-card-refresh {
      background: transparent;
      border: none;
      font-size: 14px;
      cursor: pointer;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      padding: 2px 4px;
      border-radius: 4px;
      transition: color 0.15s ease;
    }
    .btn-card-refresh:hover {
      color: var(--dsw-alias-label-primary, #111);
    }
    .btn-card-refresh.spinning svg {
      animation: spin 0.75s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .official-long-card {
      display: flex;
      flex-direction: column;
      border-radius: 6px;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.05));
    }
    .card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
    }
    .card-row:last-child {
      border-bottom: none;
    }
    .row-left-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .row-main-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #111);
    }
    .row-sub-label {
      font-size: 11.5px;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
    }
    .row-right-metric {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .row-percent-number {
      font-size: 13.5px;
      font-weight: 700;
      min-width: 42px;
      text-align: right;
    }
    .row-percent-number.is-unknown {
      color: var(--dsw-alias-label-tertiary, #888);
    }
    .row-amount-number {
      font-size: 15.5px;
      font-weight: 700;
      letter-spacing: -0.3px;
      font-variant-numeric: tabular-nums;
    }
    .row-metric-caption {
      font-size: 11px;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      font-weight: 500;
    }
    .quota-kind-badge {
      font-size: 11px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      border-radius: 999px;
      padding: 2px 8px;
      white-space: nowrap;
    }
    .quota-updated-tag {
      font-size: 11px;
      font-weight: 500;
      color: var(--dsw-alias-label-tertiary, #888);
      margin-left: 8px;
    }
    .quota-error-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--q-error) 35%, transparent);
      background: color-mix(in srgb, var(--q-error) 8%, transparent);
      color: var(--dsw-alias-label-error, var(--q-error));
      font-size: 12.5px;
    }
    .quota-error-banner .quota-error-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .quota-error-banner .quota-error-time {
      flex: none;
      opacity: 0.8;
      font-size: 11.5px;
    }
    .group-header-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      padding: 4px 2px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      user-select: none;
    }

    /* Standard Buttons */
    .quota-btn {
      padding: 6px 14px;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--q-success);
      background: var(--q-success);
      color: var(--q-on-solid);
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: center;
    }
    .quota-btn:hover {
      background: #336350;
      border-color: #336350;
    }
    .quota-btn.secondary {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
      border-color: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .quota-btn.secondary:hover {
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08));
    }
    .quota-btn.danger {
      background: rgba(176, 74, 70, 0.1);
      border-color: rgba(176, 74, 70, 0.3);
      color: var(--q-error);
    }
    .quota-btn.danger:hover {
      background: var(--q-error);
      color: var(--q-on-solid);
      border-color: var(--q-error);
    }
    .quota-btn.action {
      padding: 4px 10px;
      font-size: 12px;
    }
    .quota-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Icon Buttons (Monochrome, Hoverable, Minimalist) */
    .quota-icon-btn {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      cursor: pointer;
      transition: all 0.15s ease;
      padding: 0;
      flex: none;
    }
    .quota-icon-btn:hover {
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .quota-icon-btn.danger:hover {
      background: rgba(176, 74, 70, 0.12);
      color: var(--q-error);
    }
    .quota-icon-btn.spinning svg {
      animation: spin 0.75s linear infinite;
    }

    /* Text Inputs */
    .quota-input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      font-size: 12.5px;
      border-radius: 6px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, var(--q-fg));
      outline: none;
      transition: border-color 0.15s ease;
      font-family: inherit;
    }
    .quota-input:focus {
      border-color: var(--q-success);
      box-shadow: 0 0 0 2px rgba(63, 122, 99, 0.15);
    }

    /* Segmented Control (Sub-tabs) */
    .quota-settings-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .quota-segmented {
      display: inline-flex;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
      border-radius: 8px;
      padding: 3px;
      gap: 3px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
    }
    .quota-segmented-btn {
      padding: 5px 14px;
      font-size: 12.5px;
      font-weight: 600;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .quota-segmented-btn.active {
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, var(--q-fg));
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }
    .quota-count-pill {
      font-size: 10.5px;
      background: rgba(63, 122, 99, 0.12);
      color: var(--q-success);
      padding: 0 6px;
      border-radius: 10px;
      font-weight: 700;
    }

    /* Switch Component */
    .quota-switch {
      position: relative;
      display: inline-block;
      width: 34px;
      height: 18px;
      cursor: pointer;
      flex: none;
      user-select: none;
    }
    .quota-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .quota-switch-slider {
      position: absolute;
      inset: 0;
      background-color: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.18));
      border-radius: 18px;
      transition: background-color 0.18s ease;
    }
    .quota-switch-slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 2px;
      bottom: 2px;
      background-color: var(--q-on-solid);
      border-radius: 50%;
      transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
    }
    .quota-switch input:checked + .quota-switch-slider {
      background-color: var(--q-success);
    }
    .quota-switch input:checked + .quota-switch-slider:before {
      transform: translateX(16px);
    }
    .quota-switch input:disabled + .quota-switch-slider {
      opacity: 0.35;
      cursor: not-allowed;
    }

    /* Service Table (Clean, Non-wrapping, Minimalist) */
    .quota-table-wrap {
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
      border-radius: 8px;
      overflow: hidden;
      background: var(--dsw-alias-bg-base, #ffffff);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
    }
    .quota-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    .quota-table th {
      padding: 10px 14px;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      font-weight: 600;
      font-size: 12px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      white-space: nowrap;
    }
    .quota-table td {
      padding: 11px 14px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
      vertical-align: middle;
      font-size: 13px;
    }
    .quota-table-row:last-child td {
      border-bottom: none;
    }
    .quota-table-row {
      transition: background 0.12s ease;
      cursor: grab;
    }
    .quota-table-row:hover {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.025));
    }
    .quota-table-row.dragging {
      opacity: 0.3;
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08));
    }
    .quota-table-row.drag-over-top td {
      border-top: 2px solid var(--dsw-alias-brand-primary, var(--q-brand));
    }
    .quota-table-row.drag-over-bottom td {
      border-bottom: 2px solid var(--dsw-alias-brand-primary, var(--q-brand));
    }
    .sort-drag-handle {
      color: var(--dsw-alias-label-tertiary, var(--q-fg-3));
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      opacity: 0.6;
    }
    .quota-table-row:hover .sort-drag-handle {
      opacity: 1;
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .service-name-cell {
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #111);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .service-name-cell:hover span:first-child {
      text-decoration: underline;
      color: var(--q-success);
    }

    /* Detailed Settings Modal Component */
    .dsh-quota-modal.dsh-details-modal {
      width: 92%;
      max-width: 520px;
      max-height: 88vh;
      padding: 0;
      gap: 0;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .dsh-modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: none;
    }
    .dsh-drawer-title-wrap {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .dsh-drawer-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
    }
    .btn-drawer-close {
      background: transparent;
      border: none;
      font-size: 18px;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-drawer-close:hover {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.05));
      color: var(--dsw-alias-label-primary, #111);
    }
    .dsh-drawer-body {
      flex: 1;
      padding: 18px 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .dsh-drawer-footer {
      padding: 13px 20px;
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.015));
      flex: none;
    }
    .quota-input-affix-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .btn-toggle-eye {
      position: absolute;
      right: 8px;
      background: transparent;
      border: none;
      color: var(--dsw-alias-label-tertiary, var(--q-fg-3));
      cursor: pointer;
      padding: 3px 5px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
    }
    .btn-toggle-eye:hover {
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .drawer-info-card {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12.5px;
    }
    .drawer-info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .drawer-info-label {
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      font-weight: 500;
    }
    .drawer-info-val {
      font-weight: 600;
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .drawer-test-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-top: 4px;
    }
    .drawer-test-result {
      font-size: 12px;
      font-weight: 500;
      display: none;
    }
    .drawer-test-result.ok {
      display: inline-block;
      color: var(--q-success);
    }
    .drawer-test-result.err {
      display: inline-block;
      color: var(--q-error);
    }

    /* Drawer HUD Metrics List */
    .drawer-hud-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      padding-top: 12px;
    }
    .drawer-hud-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-hud-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      border-radius: 8px;
      padding: 10px 12px;
    }
    .hud-metric-checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      font-size: 12.5px;
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .hud-metric-checkbox-row input[type="checkbox"] {
      cursor: pointer;
      accent-color: var(--q-success);
      width: 15px;
      height: 15px;
    }

    /* Add Service Selector Modal */
    .add-service-modal {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      max-height: 380px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .add-service-option {
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      background: var(--dsw-alias-bg-base, #ffffff);
      cursor: pointer;
      transition: all 0.14s ease;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .add-service-option:hover {
      border-color: var(--q-success);
      background: rgba(63, 122, 99, 0.04);
      transform: translateY(-1px);
    }
    .add-service-option-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #111);
    }

    /* Preferences Grouped Cards */
    .quota-pref-card {
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
      border-radius: 8px;
      padding: 16px 18px;
      background: var(--dsw-alias-bg-base, #ffffff);
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
    }
    .pref-card-header {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.05));
    }
    .pref-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    /* Modal & Toast */
    .dsh-quota-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(2px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: dshModalFadeIn 0.15s ease-out;
    }
    @keyframes dshModalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .dsh-quota-modal {
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, var(--q-fg));
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.15));
      border-radius: 12px;
      padding: 20px 24px;
      width: 90%;
      max-width: 440px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.24);
      display: flex;
      flex-direction: column;
      gap: 14px;
      animation: dshModalScaleIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes dshModalScaleIn {
      from { transform: scale(0.94); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .dsh-quota-modal-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, var(--q-fg));
    }
    .dsh-quota-modal-body {
      font-size: 13.5px;
      color: var(--dsw-alias-label-secondary, var(--q-fg-2));
      line-height: 1.5;
    }
    .dsh-quota-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 6px;
    }
    .dsh-quota-toast {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px) scale(0.95);
      background: var(--dsw-alias-label-primary, var(--q-fg));
      color: var(--q-on-solid);
      padding: 9px 20px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      z-index: 100000;
      opacity: 0;
      pointer-events: none;
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }
    .dsh-quota-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
      pointer-events: auto;
    }
    .dsh-quota-toast.success {
      background: var(--q-success);
    }
    .dsh-quota-toast.error {
      background: var(--q-error);
    }

    /* ============================================================
       0.4.1 visual system: theme tokens, type scale, responsive
       ============================================================ */
    [data-dsh-quota-view] {
      --q-bg-fb: #ffffff;
      --q-bg-1-fb: rgba(0, 0, 0, 0.04);
      --q-bg-2-fb: rgba(0, 0, 0, 0.06);
      --q-fg-fb: #1f2328;
      --q-fg-2-fb: #57606a;
      --q-fg-3-fb: #8c959f;
      --q-border-fb: rgba(0, 0, 0, 0.1);
      --q-border-1-fb: rgba(0, 0, 0, 0.08);
      --q-track-fb: rgba(0, 0, 0, 0.14);

      --q-bg: var(--dsw-alias-bg-base, var(--q-bg-fb));
      --q-bg-1: var(--dsw-alias-bg-layer-1, var(--q-bg-1-fb));
      --q-bg-2: var(--dsw-alias-bg-layer-2, var(--q-bg-2-fb));
      --q-fg: var(--dsw-alias-label-primary, var(--q-fg-fb));
      --q-fg-2: var(--dsw-alias-label-secondary, var(--q-fg-2-fb));
      --q-fg-3: var(--dsw-alias-label-tertiary, var(--q-fg-3-fb));
      --q-border: var(--dsw-alias-border-l2, var(--q-border-fb));
      --q-border-1: var(--dsw-alias-border-l1, var(--q-border-1-fb));
      --q-track: var(--dsw-alias-border-l1, var(--q-track-fb));

      --q-brand: var(--dsw-alias-brand-primary, #0969da);
      /* Original muted palette (青绿 / 赭黄 / 砖红). The host state tokens are
         noticeably brighter in the light theme, and the muted trio is what the
         plugin shipped with. Dark mode gets a lighter tint of the same hue below
         so small labels stay legible without changing the identity. */
      --q-btn: #3F7A63;
      --q-btn-hover: #336350;
      --q-btn-fg: #ffffff;
      --q-success: #3F7A63;
      --q-warn: #BA8137;
      --q-error: #B04A46;
      --q-on-solid: var(--dsw-alias-label-primary-foreground, #ffffff);

      --q-radius-sm: 6px;
      --q-radius: 8px;
      --q-radius-lg: 12px;
      --q-font-xs: 11px;
      --q-font-sm: 12px;
      --q-font: 13px;
      --q-font-lg: 14px;
      --q-font-xl: 17.5px;
      --q-gap: 12px;
      --q-gap-sm: 8px;
    }
    @media (prefers-color-scheme: dark) {
      [data-dsh-quota-view] {
        --q-bg-fb: #17181b;
        --q-bg-1-fb: #1e1f23;
        --q-bg-2-fb: #26272c;
        --q-fg-fb: #e8e8e8;
        --q-fg-2-fb: #9aa0a6;
        --q-fg-3-fb: #7d838a;
        --q-border-fb: #33353a;
        --q-border-1-fb: #2a2c31;
        --q-track-fb: #3a3d43;
        --q-success: #6fa78f;
        --q-warn: #d0a25f;
        --q-error: #cf827d;
        --q-btn: #5c9880;
        --q-btn-hover: #6aa88b;
        --q-btn-fg: #101114;
      }
    }

    /* Type scale: one family of sizes instead of ten near-duplicates. */
    .quota-container { font-size: var(--q-font); }
    .quota-title { font-size: var(--q-font-xl); }
    .summary-card-label,
    .summary-sub,
    .row-metric-caption,
    .quota-updated-tag { font-size: var(--q-font-xs); }
    .summary-card-val { font-size: 20px; }
    .auth-section-title { font-size: var(--q-font-lg); }
    .row-main-label { font-size: var(--q-font); }
    .row-sub-label { font-size: var(--q-font-sm); }
    .category-chip,
    .quota-tab-btn,
    .quota-segmented-btn { font-size: var(--q-font-sm); }

    /* Radii: 6 / 8 / 12 only. */
    .quota-section,
    .summary-card,
    .quota-pref-card,
    .quota-table-wrap,
    .official-long-card,
    .dsh-quota-modal { border-radius: var(--q-radius); }
    .quota-tab-btn,
    .quota-segmented-btn { border-radius: var(--q-radius-sm); }
    .auth-group-block { border-radius: var(--q-radius); }

    /* Primary actions use the host button token; green stays semantic. */
    .btn-add-service,
    .quota-btn.action,
    .btn-drawer-save { background: var(--q-btn); border-color: var(--q-btn); color: var(--q-btn-fg); }
    .btn-add-service:hover,
    .quota-btn.action:hover,
    .btn-drawer-save:hover { background: var(--q-btn-hover); border-color: var(--q-btn-hover); }
    .quota-btn.secondary { background: transparent; color: var(--q-fg); border-color: var(--q-border); }
    .quota-btn.secondary:hover { background: var(--q-bg-1); }

    /* Active tab/chip: neutral inversion, theme-aware in light and dark. */
    .quota-tab-btn.active,
    .quota-segmented-btn.active { background: var(--q-bg); color: var(--q-fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
    .category-chip.active { background: var(--q-fg); border-color: var(--q-fg); color: var(--q-bg); font-weight: 600; }
    .category-chip { color: var(--q-fg-2); border-color: var(--q-border-1); }

    /* Toast: neutral uses the inverse surface so dark mode stays readable. */
    .dsh-quota-toast { background: var(--q-fg); color: var(--q-bg); }
    .dsh-quota-toast.success,
    .dsh-quota-toast.error,
    .dsh-quota-toast.info { color: var(--q-on-solid); }

    /* Header: title line + secondary status line; actions keep their own row. */
    .quota-header { flex-wrap: wrap; row-gap: 10px; gap: 12px; }
    .quota-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; row-gap: 4px; min-width: 0; }
    .quota-header-actions { display: flex; gap: 10px; align-items: center; margin-left: auto; }
    .quota-updated-tag { color: var(--q-fg-3); font-weight: 500; white-space: nowrap; }
    .quota-updated-tag.is-stale { color: var(--q-warn); font-weight: 600; }
    .quota-refresh-interval { color: var(--q-fg-3); font-size: var(--q-font-xs); white-space: nowrap; cursor: pointer; }
    .quota-refresh-interval:hover { color: var(--q-fg-2); }

    /* Summary: four mutually exclusive buckets + a sub-line per tile. */
    .dashboard-summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--q-gap); }
    .summary-card { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .summary-card .summary-card-val { line-height: 1.1; }
    .summary-sub { color: var(--q-fg-3); line-height: 1.3; }
    .summary-sub .trend-up { color: var(--q-error); }
    .summary-sub .trend-down { color: var(--q-success); }
    .summary-sub .trend-flat { color: var(--q-fg-3); }

    /* Category chips: scrollable strip with edge fade and arrow affordance. */
    .category-filter-wrap { position: relative; }
    .category-filter-bar { scroll-behavior: smooth; scrollbar-width: none; padding: 0 2px 2px; }
    .category-filter-bar::-webkit-scrollbar { display: none; }
    .category-filter-wrap::before,
    .category-filter-wrap::after {
      content: ''; position: absolute; top: 0; bottom: 2px; width: 24px; pointer-events: none; z-index: 1;
      opacity: 0; transition: opacity 0.15s ease;
    }
    .category-filter-wrap::before { left: 0; background: linear-gradient(90deg, var(--q-bg), transparent); }
    .category-filter-wrap::after { right: 0; background: linear-gradient(270deg, var(--q-bg), transparent); }
    .category-filter-wrap.can-scroll-left::before,
    .category-filter-wrap.can-scroll-right::after { opacity: 1; }
    .category-scroll-btn {
      position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
      width: 22px; height: 22px; padding: 0; border-radius: 50%;
      border: 1px solid var(--q-border); background: var(--q-bg); color: var(--q-fg-2);
      display: none; align-items: center; justify-content: center; cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); font-size: 11px; line-height: 1;
    }
    .category-filter-wrap.can-scroll-left .category-scroll-btn.prev,
    .category-filter-wrap.can-scroll-right .category-scroll-btn.next { display: flex; }
    .category-scroll-btn.prev { left: -6px; }
    .category-scroll-btn.next { right: -6px; }

    /* Cards: long names and hosts ellipsize instead of pushing the row open. */
    .auth-title-row { gap: var(--q-gap-sm); align-items: flex-start; }
    .auth-title-main { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
    .auth-section-title { min-width: 0; display: flex; align-items: center; gap: 6px; }
    .auth-section-title > .service-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .auth-card-meta { display: flex; gap: 8px; align-items: center; flex: none; }
    .auth-host { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--q-fg-2); font-size: var(--q-font-sm); }
    .btn-card-refresh { width: 28px; height: 28px; padding: 0; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; }
    .quota-icon-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; }
    .quota-icon-btn.danger:hover { color: var(--q-error); background: color-mix(in srgb, var(--q-error) 12%, transparent); }

    /* Ring: 32px with the percentage inside; the textual percentage is gone. */
    .row-right-metric { display: flex; align-items: center; gap: 10px; flex: none; }
    .row-ring { position: relative; width: 32px; height: 32px; flex: none; }
    .row-ring svg { display: block; transform: rotate(-90deg); }
    .row-ring .row-ring-label {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums;
    }
    .row-ring.is-zero .row-ring-label { color: var(--q-error); }
    .row-ring.is-wide .row-ring-label { font-size: 9px; }

    /* Sparkline: bars, baseline, last point emphasised; no fabricated line. */
    .spark-wrap { width: 84px; height: 26px; display: inline-flex; align-items: flex-end; gap: 2px; position: relative; }
    .spark-wrap::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; border-top: 1px dashed var(--q-border-1); }
    .spark-bar { flex: 1; border-radius: 2px 2px 0 0; background: color-mix(in srgb, var(--q-fg-3) 45%, transparent); min-height: 2px; }
    .spark-bar.is-last { background: var(--q-fg-2); }
    .spark-empty { font-size: var(--q-font-xs); color: var(--q-fg-3); white-space: nowrap; }

    /* Provenance badge: official / local / estimate, with full source on hover. */
    .quota-provenance {
      font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px;
      border: 1px solid var(--q-border-1); color: var(--q-fg-3); background: transparent; white-space: nowrap;
    }

    /* Error card: inline retry plus collapsible detail. */
    .error-actions { display: flex; align-items: center; gap: 8px; flex: none; }
    .error-detail { margin-top: 6px; font-size: var(--q-font-sm); color: var(--q-fg-2); }
    .error-detail summary { cursor: pointer; color: var(--q-fg-3); }
    .error-detail pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; font-size: var(--q-font-xs); color: var(--q-fg-2); }

    /* Single-window groups have nothing to collapse: hide the toggle entirely. */
    .auth-group-block .group-header-title.single-window { cursor: default; }
    .auth-group-block .group-header-title.single-window .group-toggle { display: none; }

    /* Skeleton: three placeholder cards while the first load is in flight. */
    .quota-skeleton { border: 1px solid var(--q-border); border-radius: var(--q-radius); padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
    .skeleton-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--q-bg-1) 25%, var(--q-bg-2) 37%, var(--q-bg-1) 63%); background-size: 400% 100%; animation: q-shimmer 1.4s ease infinite; }
    .skeleton-line.w40 { width: 40%; } .skeleton-line.w70 { width: 70%; } .skeleton-line.w55 { width: 55%; }
    @keyframes q-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

    /* Settings table: sticky header, hover, readable icon targets. */
    .quota-table thead th { position: sticky; top: 0; z-index: 1; background: var(--q-bg); border-bottom: 1px solid var(--q-border); }
    .quota-table-row:hover { background: var(--q-bg-1); }
    .quota-table-row { border-bottom: 1px solid var(--q-border-1); }
    .quota-switch { vertical-align: middle; }

    /* Drawer: grouped fields and an inline test result. */
    .drawer-section { display: flex; flex-direction: column; gap: 10px; padding: 12px 0; border-top: 1px solid var(--q-border-1); }
    .drawer-section:first-of-type { border-top: none; padding-top: 0; }
    .drawer-section-title { font-size: var(--q-font-sm); font-weight: 700; color: var(--q-fg-2); letter-spacing: 0.02em; }
    .drawer-test-result { font-size: var(--q-font-sm); color: var(--q-fg-2); min-height: 18px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
    .drawer-test-result:empty { display: none; }
    .drawer-test-result.ok, .drawer-test-result.err { font-weight: 600; }

    /* Accessibility: visible focus, reduced motion. */
    [data-dsh-quota-view] button:focus-visible,
    [data-dsh-quota-view] input:focus-visible,
    [data-dsh-quota-view] select:focus-visible,
    [data-dsh-quota-view] summary:focus-visible {
      outline: 2px solid var(--q-brand); outline-offset: 2px; border-radius: 4px;
    }
    @media (prefers-reduced-motion: reduce) {
      [data-dsh-quota-view] * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
    }

    /* Responsive: 1024 -> 2x2 summary, 720 -> compact header/table/rows. */
    /* Spacing: keep the container on a 4px rhythm. */
    .quota-container { gap: 16px; }
    .quota-section { padding: 16px; gap: 10px; }
    .summary-card { padding: 14px 16px; }
    .category-filter-bar { gap: 8px; }
    .auth-title-row { padding-bottom: 2px; }

    @media (prefers-color-scheme: dark) {
      .quota-section,
      .summary-card,
      .quota-pref-card { box-shadow: none; }
      .quota-section,
      .quota-table-row { border-color: var(--q-border-1); }
    }

    @media (max-width: 1024px) {
      .dashboard-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 720px) {
      .quota-container { padding: 16px 14px 56px; gap: 14px; }
      .quota-header { align-items: flex-start; }
      .quota-header-actions { width: 100%; justify-content: space-between; margin-left: 0; }
      #btn-refresh { padding: 5px 10px; white-space: nowrap; }
      .auth-title-row { flex-wrap: wrap; }
      .auth-card-meta { width: 100%; justify-content: flex-start; flex-wrap: wrap; row-gap: 4px; }
      .auth-host { max-width: 100%; }
      .quota-table thead { display: none; }
      .quota-table, .quota-table tbody, .quota-table tr, .quota-table td { display: block; width: auto !important; }
      .quota-table tr { padding: 8px 12px; border-bottom: 1px solid var(--q-border-1); }
      .quota-table td { padding: 3px 0; border: none; text-align: left !important; }
      .quota-table td[data-label] { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .quota-table td[data-label]::before { content: attr(data-label); color: var(--q-fg-2); font-size: var(--q-font-sm); }
      .quota-table td[data-label='操作'] > div { justify-content: flex-end; }
      .quota-table td[data-label='排序'] { display: none; }
      .quota-table tr { padding: 10px 12px; }
      .quota-table td[data-label] { min-height: 30px; }
      .quota-table td[data-label='服务'] { font-weight: 600; font-size: var(--q-font); }
      .row-sub-label { white-space: normal; overflow: visible; }
    }
    @media (max-width: 480px) {
      .dashboard-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .summary-card { padding: 10px 12px; }
      .summary-card-val { font-size: 18px; }
      .quota-title { font-size: 16px; }
      #btn-refresh { font-size: 12px; }
    }
  `;
  document.head.appendChild(styleEl);
  let settingsSubTab = "services";
  let activeDrawerTarget = null;
  let isDrawerOpen = false;
  let isAddServiceModalOpen = false;
  let settingsDirty = false;
  const externalNodes = /* @__PURE__ */ new Set();
  function isEditingInsideContainer() {
    if (typeof document === "undefined") return false;
    const active = document.activeElement;
    if (active === null || !container.contains(active)) return false;
    const tag = active.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }
  function confirmModal(opts) {
    showConfirmModal(opts, (overlay) => externalNodes.add(overlay));
  }
  function closeDrawer() {
    isDrawerOpen = false;
    activeDrawerTarget = null;
    update();
  }
  function openDrawer(target) {
    activeDrawerTarget = target;
    isDrawerOpen = true;
    isAddServiceModalOpen = false;
    update();
  }
  function renderDrawerBody(target, cfg, cards) {
    if (!target) return "";
    const testRes = target.kind === "provider" ? controller.getSnapshot().testResults[target.id] : void 0;
    const hudMetrics = getAvailableHudMetricsForTarget(target, cards);
    const provId = target.kind === "custom" ? target.endpoint.id : target.kind === "new_custom" ? "" : target.id;
    const selectedMetrics = cfg.floatingHudMetrics;
    const hasCustomSelection = Array.isArray(selectedMetrics) && selectedMetrics.some((k) => typeof k === "string" && (k.startsWith(`${provId}::`) || target.kind === "provider" && k.startsWith(`${target.id}::`)));
    const isMetricChecked = (key) => {
      if (!hasCustomSelection) return true;
      if (!Array.isArray(selectedMetrics)) return true;
      if (selectedMetrics.includes(`${provId}::__none__`) || target.kind === "provider" && selectedMetrics.includes(`${target.id}::__none__`)) return false;
      if (selectedMetrics.includes(key)) return true;
      if (provId === "antigravity") {
        const lowerKey = key.toLowerCase();
        const isWeekly = lowerKey.includes("weekly");
        const isGemini = lowerKey.includes("gemini");
        const isClaude = lowerKey.includes("claude") || lowerKey.includes("gpt");
        return selectedMetrics.some((sel) => {
          if (typeof sel !== "string" || !sel.startsWith("antigravity::")) return false;
          if (sel.includes("__none__")) return false;
          const l = decodeURIComponent(sel).toLowerCase();
          const selWeekly = l.includes("weekly") || l.includes("周");
          const sel5h = l.includes("5h") || l.includes("5-hour") || l.includes("five") || l.includes("5小时");
          const selGemini = l.includes("gemini");
          const selClaude = l.includes("claude") || l.includes("gpt");
          if (isGemini && selGemini && (isWeekly && selWeekly || !isWeekly && sel5h)) return true;
          if (isClaude && selClaude && (isWeekly && selWeekly || !isWeekly && sel5h)) return true;
          if (isWeekly && selWeekly || !isWeekly && sel5h) return true;
          return false;
        });
      }
      return false;
    };
    const hudMetricsHtml = hudMetrics.length > 0 ? `
      <div class="drawer-hud-section">
        <div class="drawer-hud-header">
          <span style="font-size: 12.5px; font-weight: 600;">悬浮球轮播显示项</span>
          <span style="font-size: 11px; color: var(--dsw-alias-label-tertiary);">勾选需在悬浮球中轮播的指标项</span>
        </div>
        <div class="drawer-hud-list">
          ${hudMetrics.map((m) => {
      const isChecked = isMetricChecked(m.key);
      return `
              <label class="hud-metric-checkbox-row">
                <input type="checkbox" class="cb-hud-metric" data-key="${m.key}" ${isChecked ? "checked" : ""} />
                <span>${m.label}</span>
              </label>
            `;
    }).join("")}
        </div>
      </div>
    ` : "";
    if (target.kind === "new_custom" || target.kind === "custom") {
      const ep = target.kind === "custom" ? target.endpoint : { id: "", name: "", baseUrl: "https://api.openai.com", apiKey: "" };
      return `
        <div class="drawer-section">
          <div class="drawer-section-title">连接</div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">显示名称 (自定义) <span style="color: var(--q-error);">*</span></label>
          <input type="text" id="drawer-custom-name-input" class="quota-input" placeholder="例如：NewAPI 分发站 / OneAPI 主池" value="${esc(ep.name || "")}" />
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">Base URL <span style="color: var(--q-error);">*</span></label>
          <input type="text" id="drawer-cust-base" class="quota-input" placeholder="https://api.my-oneapi.com" value="${esc(ep.baseUrl || "")}" />
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">API Key <span style="color: var(--q-error);">*</span></label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-cust-key" class="quota-input" placeholder="sk-... / Key" value="${esc(ep.apiKey || "")}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-cust-key" aria-label="切换密钥显隐" title="切换显隐">👁</button>
          </div>
        </div>
        <div class="drawer-test-row">
          <button type="button" class="quota-btn secondary action btn-drawer-test-cust">测试连接</button>
          <span class="drawer-test-result" id="drawer-test-result" role="status" aria-live="polite"></span>
        </div>
        </div>
        ${hudMetricsHtml}
      `;
    }
    const prov = target.id;
    const meta = PROVIDER_METAS[prov];
    if (!meta) return "";
    const provConf = cfg[prov] || {};
    const credInfo = getCredentialInfo(prov, cfg);
    const currentCustomName = cfg.customNames?.[prov] || provConf.name || "";
    let customFieldsHtml = "";
    if (prov === "cursor") {
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 state.vscdb</span>
            ${renderHelp("自动读取本地 Cursor 本地数据库免密获取状态")}
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-cursor-auto" ${provConf.autoDetectLocal !== false ? "checked" : ""} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">Session Token (WorkosCursorSessionToken)</label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="从浏览器 Cookie 复制 WorkosCursorSessionToken" value="${esc(provConf.sessionToken || "")}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" aria-label="切换密钥显隐" title="切换显隐">👁</button>
          </div>
          <button type="button" class="quota-btn secondary action btn-connect-cursor" style="align-self: flex-start; margin-top: 4px;">从本地 Cursor 提取登录态</button>
        </div>
      `;
    } else if (prov === "antigravity") {
      const isAuthed = Boolean(provConf.oauth?.accessToken);
      const email = provConf.oauth?.email || "";
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 gcloud/auth</span>
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-antigravity-auto" ${provConf.autoDetectLocal !== false ? "checked" : ""} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 4px;">
          <button type="button" class="quota-btn secondary action btn-login-antigravity">${isAuthed ? "重新授权 Google" : "Google 账号授权登录"}</button>
          <span style="font-size: 12px; color: ${isAuthed ? "var(--q-success)" : "var(--dsw-alias-label-tertiary)"}; font-weight: 600;">
            ${isAuthed ? `✓ 已连接 (${email || "已授权"})` : "未连接"}
          </span>
        </div>
      `;
    } else if (prov === "codex") {
      const isAuthed = Boolean(provConf.oauth?.accessToken);
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 auth.json</span>
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-codex-auto" ${provConf.autoDetectLocal !== false ? "checked" : ""} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 4px;">
          <button type="button" class="quota-btn secondary action btn-login-codex">ChatGPT 授权登录</button>
          <span style="font-size: 12px; color: ${isAuthed ? "var(--q-success)" : "var(--dsw-alias-label-tertiary)"}; font-weight: 600;">
            ${isAuthed ? "✓ 已获得授权 Token" : "未登录"}
          </span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
          <label style="font-size: 12.5px; font-weight: 600;">手动填入 Access Token (可选)</label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="access_token" value="${esc(provConf.oauth?.accessToken || "")}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" aria-label="切换密钥显隐" title="切换显隐">👁</button>
          </div>
        </div>
      `;
    } else if (prov === "github_copilot") {
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 VS Code 凭据</span>
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-copilot-auto" ${provConf.autoDetectLocal !== false ? "checked" : ""} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
          <label style="font-size: 12.5px; font-weight: 600;">GitHub Token (可选手动填入)</label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="gho_... / ghp_..." value="${esc(provConf.token || "")}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" aria-label="切换密钥显隐" title="切换显隐">👁</button>
          </div>
        </div>
      `;
    } else {
      customFieldsHtml = `
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">${meta.keyLabel || "API Key"} <span style="color: var(--q-error);">*</span></label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="${meta.keyPlaceholder || "API Key"}" value="${esc(provConf.apiKey || "")}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" aria-label="切换密钥显隐" title="切换显隐">👁</button>
          </div>
        </div>
        ${meta.hasGroupId ? `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12.5px; font-weight: 600;">Group ID</label>
            <input type="text" id="drawer-group-input" class="quota-input" placeholder="Group ID" value="${esc(provConf.groupId || "")}" />
          </div>
        ` : ""}
        ${meta.hasBaseUrl ? `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12.5px; font-weight: 600;">Base URL (选填)</label>
            <input type="text" id="drawer-base-input" class="quota-input" placeholder="默认: ${meta.defaultBaseUrl || ""}" value="${esc(provConf.baseUrl || "")}" />
          </div>
        ` : ""}
      `;
    }
    return `
      <div class="drawer-section">
      <div class="drawer-section-title">连接与凭据</div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 12.5px; font-weight: 600;">自定义显示名称 (选填)</label>
        <input type="text" id="drawer-custom-name-input" class="quota-input" placeholder="默认: ${meta.name}" value="${esc(currentCustomName)}" />
      </div>

      ${credInfo.isConfigured ? `
        <div class="drawer-info-card">
          <div class="drawer-info-row">
            <span class="drawer-info-label">凭据状态</span>
            <span class="drawer-info-val" style="color: var(--q-success);">● ${credInfo.displayValue}</span>
          </div>
          <div class="drawer-info-row">
            <span class="drawer-info-label">连接测活</span>
            <span class="drawer-info-val" style="color: ${testRes?.ok ? "var(--q-success)" : testRes ? "var(--q-error)" : "var(--dsw-alias-label-tertiary)"};">
              ${testRes ? testRes.ok ? `正常 · ${testRes.latencyMs ?? 0}ms` : `异常 · ${testRes.message || "连接失败"}` : "未测活"}
            </span>
          </div>
        </div>
      ` : ""}

      ${customFieldsHtml}

      <div class="drawer-test-row">
        <button type="button" class="quota-btn secondary action btn-drawer-test">测试连接</button>
        <span class="drawer-test-result" id="drawer-test-result" role="status" aria-live="polite"></span>
      </div>
      </div>

      ${hudMetricsHtml}
    `;
  }
  function update() {
    const state = controller.getSnapshot();
    if (!state.panelOpen) return;
    const modalAlreadyRendered = container.querySelector("#dsh-details-modal-overlay") || container.querySelector("#dsh-add-service-modal-overlay");
    if (modalAlreadyRendered && (isDrawerOpen || isAddServiceModalOpen)) {
      return;
    }
    if (settingsDirty || isEditingInsideContainer()) {
      return;
    }
    const previousScrollTop = container.scrollTop;
    const cfg = state.config || {};
    let contentHtml = "";
    if (state.activeTab === "overview") {
      const totalServices = state.cards.length;
      const okServices = state.cards.filter((c) => c.status === "ok").length;
      const warnServices = state.cards.filter((c) => c.status === "warn").length;
      const errorServices = state.cards.filter((c) => c.status === "error" || c.status === "disabled").length;
      const alarmCount = state.alarms.length;
      const disabledCount = state.allCards.filter((c) => c.status === "disabled").length;
      const refreshSec = state.config?.refreshIntervalSeconds ?? 60;
      const refreshText = refreshSec < 60 ? `${refreshSec} 秒` : `${Math.round(refreshSec / 60)} 分钟`;
      const previousDay = totalServices > 0 ? recordDailySummary({ total: totalServices, ok: okServices, warn: warnServices, error: errorServices }) : {};
      const summaryGridHtml = `
        <div class="dashboard-summary-grid">
          <div class="summary-card" title="已配置并在看板展示的服务数">
            <span class="summary-card-label">已监控服务</span>
            <span class="summary-card-val">${totalServices}</span>
            <span class="summary-sub">${disabledCount > 0 ? `另有 ${disabledCount} 个未配置` : `每 ${refreshText}刷新`}</span>
          </div>
          <div class="summary-card" title="状态正常且没有告警的服务">
            <span class="summary-card-label">正常运行</span>
            <span class="summary-card-val" style="color: var(--q-success);">${okServices}</span>
            <span class="summary-sub">${renderSummaryDelta(okServices, previousDay.ok, false)}</span>
          </div>
          <div class="summary-card" title="额度低于阈值或窗口耗尽">
            <span class="summary-card-label">告警</span>
            <span class="summary-card-val" style="color: ${warnServices > 0 ? "var(--q-warn)" : "var(--q-fg-2)"};">${warnServices}</span>
            <span class="summary-sub">${alarmCount} 条告警 ${renderSummaryDelta(warnServices, previousDay.warn, true)}</span>
          </div>
          <div class="summary-card" title="凭据或网络异常的服务">
            <span class="summary-card-label">异常</span>
            <span class="summary-card-val" style="color: ${errorServices > 0 ? "var(--q-error)" : "var(--q-fg-2)"};">${errorServices}</span>
            <span class="summary-sub">${renderSummaryDelta(errorServices, previousDay.error, true)}</span>
          </div>
        </div>
      `;
      const categories = ["all", "domestic_llm", "ide", "official_cloud", "custom_api"];
      const categoryTabsHtml = `
        <div class="category-filter-wrap" data-category-wrap>
          <button type="button" class="category-scroll-btn prev" data-scroll="-1" aria-label="向左滚动分类">‹</button>
          <div class="category-filter-bar" role="tablist" aria-label="服务分类">
            ${categories.map((cat) => `
              <button class="category-chip ${state.activeCategory === cat ? "active" : ""}" data-cat="${cat}" role="tab" aria-selected="${state.activeCategory === cat}">
                ${CATEGORY_NAMES[cat]}
              </button>
            `).join("")}
          </div>
          <button type="button" class="category-scroll-btn next" data-scroll="1" aria-label="向右滚动分类">›</button>
        </div>
      `;
      const skeletonHtml = `
        <div class="quota-skeleton" aria-hidden="true">
          <div class="skeleton-line w40"></div>
          <div class="skeleton-line w70"></div>
          <div class="skeleton-line w55"></div>
        </div>
        <div class="quota-skeleton" aria-hidden="true">
          <div class="skeleton-line w40"></div>
          <div class="skeleton-line w70"></div>
          <div class="skeleton-line w55"></div>
        </div>
        <div class="quota-skeleton" aria-hidden="true">
          <div class="skeleton-line w40"></div>
          <div class="skeleton-line w70"></div>
          <div class="skeleton-line w55"></div>
        </div>
      `;
      const sectionsHtml = state.cards.length === 0 && state.loading ? skeletonHtml : state.cards.length === 0 ? `
          <div style="text-align: center; color: var(--dsw-alias-label-tertiary, #888); padding: 56px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px;">
            <span style="font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-secondary);">暂无可展示的服务</span>
            <span style="font-size: 12.5px; max-width: 400px; line-height: 1.5;">请在「设置」中添加服务并保存凭据，开启「看板」开关后即可在此展示</span>
            <button type="button" class="quota-btn secondary btn-goto-settings" style="margin-top: 8px; padding: 5px 14px; font-size: 12.5px;">前往服务管理</button>
          </div>
        ` : state.cards.map((card) => {
        const isErr = card.status === "error" || card.status === "disabled";
        const isRefreshing = state.refreshingProviders.has(card.id) || state.refreshingProviders.has(card.provider);
        let actionBtn = "";
        if (card.provider === "codex" && isErr) {
          actionBtn = '<button class="quota-btn action btn-login-codex">登录 OpenAI</button>';
        } else if (card.provider === "cursor" && isErr) {
          actionBtn = '<button class="quota-btn action btn-login-cursor">连接 Cursor</button>';
        } else if (card.provider === "antigravity" && isErr) {
          actionBtn = '<button class="quota-btn action btn-login-antigravity">登录 Google</button>';
        }
        let bodyHtml = "";
        if (isErr) {
          bodyHtml = `
                <div class="official-long-card">
                  <div class="card-row">
                    <div class="row-left-content">
                      <span class="row-main-label" style="color: var(--q-error);">连接失败</span>
                      <span class="row-sub-label">请在设置中检查凭据或网络配置</span>
                      <details class="error-detail">
                        <summary>错误详情</summary>
                        <pre>${esc(card.error || "未返回错误信息")}</pre>
                      </details>
                    </div>
                    <div class="error-actions">
                      <button type="button" class="quota-btn secondary btn-card-retry" data-retry-id="${card.id}" aria-label="重试 ${esc(card.name)}">重试</button>
                      ${actionBtn}
                    </div>
                  </div>
                </div>
              `;
        } else {
          bodyHtml = card.groups.map((group, gIdx) => {
            const groupKey = `${card.id}::${group.title}::${gIdx}`;
            const isCollapsed = state.collapsedGroups.has(groupKey);
            const rowsHtml = group.windows.map((win) => {
              const kind = windowQuotaKind(win);
              const quantified = isQuantified(win);
              const subText = formatWindowSubtitle(win);
              if (kind === "balance") {
                const amountText = typeof win.amountText === "string" && win.amountText.trim() !== "" ? win.amountText.trim() : "—";
                const amountColor = amountText === "—" ? "var(--dsw-alias-label-tertiary, #888)" : "var(--dsw-alias-label-primary, var(--q-fg))";
                return `
                      <div class="card-row">
                        <div class="row-left-content">
                          <span class="row-main-label" title="${win.label}">${win.label}</span>
                          <span class="row-sub-label" title="${subText}">${subText}</span>
                        </div>
                        <div class="row-right-metric">
                          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 1px;">
                            <span class="row-amount-number" style="color: ${amountColor};">${amountText}</span>
                            <span class="row-metric-caption">余额</span>
                          </div>
                        </div>
                      </div>
                    `;
              }
              if (kind === "liveness") {
                return `
                      <div class="card-row">
                        <div class="row-left-content">
                          <span class="row-main-label" title="${win.label}">${win.label}</span>
                          <span class="row-sub-label" title="${subText}">${subText}</span>
                        </div>
                        <div class="row-right-metric">
                          <span class="quota-kind-badge">仅连通性</span>
                        </div>
                      </div>
                    `;
              }
              if (!quantified) {
                return `
                      <div class="card-row">
                        <div class="row-left-content">
                          <span class="row-main-label" title="${win.label}">${win.label}</span>
                          <span class="row-sub-label" title="${subText}">${subText}</span>
                        </div>
                        <div class="row-right-metric">
                          <span class="row-percent-number is-unknown">—</span>
                        </div>
                      </div>
                    `;
              }
              const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)));
              return `
                    <div class="card-row">
                      <div class="row-left-content">
                        <span class="row-main-label" title="${esc(win.label)}">${win.label}</span>
                        <span class="row-sub-label" title="${esc(subText)}">${subText}</span>
                      </div>
                      <div class="row-right-metric">
                        ${renderSparklineSvg(card.sparkline)}
                        ${renderCircleProgress(rem)}
                      </div>
                    </div>
                  `;
            }).join("");
            const collapsible = group.windows.length > 1;
            return `
                  <div class="auth-group-block">
                    <div class="group-header-title${collapsible ? "" : " single-window"}"
                      ${collapsible ? `data-group-toggle="${groupKey}" role="button" tabindex="0" aria-expanded="${!isCollapsed}"` : ""}>
                      <span>${esc(group.title)} (${group.windows.length})</span>
                      <span class="group-toggle" style="font-size: 11px; opacity: 0.7;">${isCollapsed ? "展开 ▸" : "收起 ▾"}</span>
                    </div>
                    <div class="official-long-card" style="display: ${isCollapsed ? "none" : "block"};">
                      ${rowsHtml}
                    </div>
                  </div>
                `;
          }).join("");
        }
        const hasQuantifiedWindow = card.groups.some((g) => g.windows.some((w) => isQuantified(w)));
        let rateBadge = "";
        if (hasQuantifiedWindow && card.burnRatePerHour && card.burnRatePerHour > 0) {
          rateBadge = `<span style="font-size: 11.5px; color: var(--dsw-alias-label-tertiary);">消耗: ${card.burnRatePerHour}%/h${card.estimatedHoursLeft ? ` · 余约 ${card.estimatedHoursLeft}h` : ""}</span>`;
        }
        const staleBadge = card.stale || card.sourceProvenance?.partial ? '<span class="quota-kind-badge" title="数据可能已过期或仅部分窗口可用">缓存</span>' : "";
        const provenanceBadge = renderProvenanceBadge(card);
        return `
              <div class="quota-section" data-card-id="${card.id}">
                <div class="auth-title-row">
                  <div class="auth-title-main">
                    <div class="auth-section-title">
                      <span class="service-title" title="${esc(card.name)}">${card.name}</span>
                      ${provenanceBadge}
                      ${staleBadge}
                    </div>
                  </div>
                  <div class="auth-card-meta">
                    ${rateBadge}
                    ${card.account ? `<span class="auth-host" title="${esc(card.account)}">${esc(card.account)}</span>` : ""}
                    <button class="btn-card-refresh ${isRefreshing ? "spinning" : ""}" data-refresh-id="${card.id}" aria-label="刷新 ${esc(card.name)}" title="刷新此服务">↻</button>
                    ${actionBtn}
                  </div>
                </div>
                ${bodyHtml}
              </div>
            `;
      }).join("");
      contentHtml = `
        ${summaryGridHtml}
        ${categoryTabsHtml}
        ${sectionsHtml}
      `;
    } else {
      const orderList = cfg.providerOrder && cfg.providerOrder.length > 0 ? cfg.providerOrder : Object.keys(PROVIDER_METAS);
      const enabledProviders = new Set(cfg.enabledProviders || []);
      const hudProviders = new Set(cfg.floatingHudProviders || cfg.enabledProviders || []);
      const configuredItems = [];
      if (Array.isArray(cfg.custom_compatible)) {
        cfg.custom_compatible.forEach((cust, idx) => {
          const info = getCredentialInfo(cust.id, cfg);
          if (info.isConfigured) {
            configuredItems.push({
              id: cust.id,
              name: getServiceDisplayName(cust.id, cfg, cust.name || `中转站 #${idx + 1}`),
              isCustom: true,
              customIndex: idx,
              displayValue: info.displayValue
            });
          }
        });
      }
      for (const [id, meta] of Object.entries(PROVIDER_METAS)) {
        const info = getCredentialInfo(id, cfg);
        if (info.isConfigured) {
          configuredItems.push({
            id,
            name: getServiceDisplayName(id, cfg, meta.name),
            isCustom: false,
            displayValue: info.displayValue
          });
        }
      }
      configuredItems.sort((a, b) => {
        const aChosen = enabledProviders.has(a.id);
        const bChosen = enabledProviders.has(b.id);
        if (aChosen && !bChosen) return -1;
        if (!aChosen && bChosen) return 1;
        const idxA = orderList.indexOf(a.id);
        const idxB = orderList.indexOf(b.id);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });
      if (settingsSubTab === "services") {
        let tableBodyContent = "";
        if (configuredItems.length === 0) {
          tableBodyContent = `
            <tr>
              <td colspan="5" style="text-align: center; color: var(--dsw-alias-label-tertiary); padding: 42px 14px;">
                暂无已添加的服务，请点击右上角「+ 添加服务」开始接入平台
              </td>
            </tr>
          `;
        } else {
          tableBodyContent = configuredItems.map((item) => {
            const isDashOn = enabledProviders.has(item.id);
            const isHudOn = hudProviders.has(item.id);
            return `
              <tr class="quota-table-row" data-service-id="${item.id}">
                <td style="width: 28px; text-align: center;" data-label="排序">
                  <span class="sort-drag-handle" draggable="true" title="按住拖动排序">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                      <path d="M5 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-6 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-6 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                    </svg>
                  </span>
                </td>
                <td data-label="服务">
                  <div class="service-name-cell" data-id="${item.id}" data-custom="${item.isCustom ? "true" : "false"}" data-idx="${item.customIndex ?? ""}" title="点击打开详细设置">
                    <span>${item.name}</span>
                    ${item.isCustom ? '<span style="font-size: 10px; background: var(--q-bg-1); color: var(--q-fg-2); border: 1px solid var(--q-border-1); padding: 1px 5px; border-radius: 4px; font-weight: 500;">中转</span>' : ""}
                  </div>
                </td>
                <td style="width: 72px; text-align: center;" data-label="看板">
                  <label class="quota-switch" title="在监控看板中展示">
                    <input type="checkbox" class="switch-dashboard cb-show-dashboard" data-id="${item.id}" aria-label="在监控看板展示 ${esc(item.name)}" ${isDashOn ? "checked" : ""} />
                    <span class="quota-switch-slider"></span>
                  </label>
                </td>
                <td style="width: 72px; text-align: center;" data-label="悬浮球">
                  <label class="quota-switch" title="在桌面悬浮球轮播中展示">
                    <input type="checkbox" class="switch-hud cb-show-hud" data-id="${item.id}" aria-label="在悬浮球展示 ${esc(item.name)}" ${isHudOn ? "checked" : ""} />
                    <span class="quota-switch-slider"></span>
                  </label>
                </td>
                <td style="width: 108px; text-align: right;" data-label="操作">
                  <div style="display: inline-flex; align-items: center; gap: 4px;">
                    <!-- Small colorless lightning icon for test connection -->
                    <button type="button" class="quota-icon-btn btn-row-test" data-id="${item.id}" aria-label="测试连接 ${esc(item.name)}" title="测试连接">
                      <svg width="13.5" height="13.5" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                        <path d="M8.5 1.5a.5.5 0 0 0-.915-.294l-5 7a.5.5 0 0 0 .415.794h3.75l-1.25 5.5a.5.5 0 0 0 .915.294l5-7a.5.5 0 0 0-.415-.794H7.25l1.25-5.5z"/>
                      </svg>
                    </button>
                    <!-- Small gear icon for edit & details -->
                    <button type="button" class="quota-icon-btn btn-open-drawer" data-id="${item.id}" data-custom="${item.isCustom ? "true" : "false"}" data-idx="${item.customIndex ?? ""}" aria-label="详细设置 ${esc(item.name)}" title="详细设置">
                      <svg width="13.5" height="13.5" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                        <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
                      </svg>
                    </button>
                    <!-- Small trash icon for delete -->
                    <button type="button" class="quota-icon-btn danger btn-row-delete" data-id="${item.id}" data-custom="${item.isCustom ? "true" : "false"}" data-idx="${item.customIndex ?? ""}" aria-label="删除 ${esc(item.name)}" title="删除凭据">
                      <svg width="13.5" height="13.5" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join("");
        }
        contentHtml = `
          <div class="quota-settings-nav">
            <div class="quota-segmented">
              <button type="button" class="quota-segmented-btn active" data-subtab="services">
                已添加服务
                <span class="quota-count-pill">${configuredItems.length}</span>
              </button>
              <button type="button" class="quota-segmented-btn" data-subtab="preferences">
                偏好与告警设置
              </button>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" class="quota-btn action btn-add-service">+ 添加服务</button>
              <button type="button" class="quota-btn secondary action btn-test-all">
                ${state.testingAll ? "测活中..." : "一键全部测活"}
              </button>
            </div>
          </div>

          <div class="quota-table-wrap">
            <table class="quota-table">
              <thead>
                <tr>
                  <th style="width: 28px;"></th>
                  <th>服务名称</th>
                  <th style="width: 72px; text-align: center;">看板</th>
                  <th style="width: 72px; text-align: center;">悬浮球</th>
                  <th style="width: 108px; text-align: right;">操作</th>
                </tr>
              </thead>
              <tbody>
                ${tableBodyContent}
              </tbody>
            </table>
          </div>
        `;
      } else {
        const showHud = cfg.showFloatingHud !== false;
        const enableNotify = cfg.enableNotification !== false;
        const alarmThreshold = cfg.alarmThresholdPercent ?? 15;
        const selectedSec = cfg.refreshIntervalSeconds ?? 60;
        contentHtml = `
          <div class="quota-settings-nav">
            <div class="quota-segmented">
              <button type="button" class="quota-segmented-btn" data-subtab="services">
                已添加服务
                <span class="quota-count-pill">${configuredItems.length}</span>
              </button>
              <button type="button" class="quota-segmented-btn active" data-subtab="preferences">
                偏好与告警设置
              </button>
            </div>
          </div>

          <form id="quota-pref-form" style="display: flex; flex-direction: column; gap: 14px;">
            <!-- HUD Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>桌面悬浮环 (HUD)</span>
                <label class="quota-switch">
                  <input type="checkbox" id="pref-hud-switch" ${showHud ? "checked" : ""} />
                  <span class="quota-switch-slider"></span>
                </label>
              </div>
              <span style="font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5;">
                在界面右侧显示可拖动的环形额度指示器，支持实时轮播速览各模型余量并自动贴边吸附。
              </span>
            </div>

            <!-- Alerts Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>告警与通知 (Notification)</span>
                <label class="quota-switch">
                  <input type="checkbox" id="pref-notify-switch" ${enableNotify ? "checked" : ""} />
                  <span class="quota-switch-slider"></span>
                </label>
              </div>
              <span style="font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5;">
                当模型额度低于警戒阈值或连接失效时触发系统级桌面气泡通知。
              </span>
              <div class="pref-card-row" style="border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); padding-top: 10px;">
                <div>
                  <span style="font-size: 12.5px; font-weight: 600;">低额度警戒阈值</span>
                  ${renderHelp("当剩余额度百分比低于此数值时触发警告徽章与系统通知")}
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <input type="range" id="pref-alarm-slider" min="5" max="50" step="5" value="${esc(alarmThreshold)}" style="width: 140px; cursor: pointer;" />
                  <span id="pref-alarm-val" style="font-size: 13px; font-weight: 700; color: var(--q-success); min-width: 36px;">${alarmThreshold}%</span>
                </div>
              </div>
            </div>

            <!-- Network & Refresh Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>网络代理与自动刷新</span>
              </div>
              <div class="pref-card-row">
                <div>
                  <span style="font-size: 12.5px; font-weight: 600;">定时自动刷新频率</span>
                </div>
                <select id="pref-refresh-select" class="quota-input" style="width: 160px;">
                  <option value="10" ${selectedSec === 10 ? "selected" : ""}>每 10 秒</option>
                  <option value="30" ${selectedSec === 30 ? "selected" : ""}>每 30 秒</option>
                  <option value="60" ${selectedSec === 60 ? "selected" : ""}>每 1 分钟 (推荐)</option>
                  <option value="120" ${selectedSec === 120 ? "selected" : ""}>每 2 分钟</option>
                  <option value="300" ${selectedSec === 300 ? "selected" : ""}>每 5 分钟</option>
                  <option value="600" ${selectedSec === 600 ? "selected" : ""}>每 10 分钟</option>
                </select>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); padding-top: 10px;">
                <span style="font-size: 12.5px; font-weight: 600;">网络代理 (HTTP Proxy)</span>
                <input type="text" id="pref-proxy-input" class="quota-input" placeholder="例如: http://127.0.0.1:7890 (留空直连)" value="${esc(cfg.httpProxy || "")}" />
              </div>
            </div>

            <!-- Backup & Restore Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>配置备份与跨机迁移</span>
              </div>
              <span style="font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5;">
                支持将当前所有 Provider 凭据、偏好设置及自定义中转站导出为 JSON 文件，或从已有备份中快速导入恢复。
              </span>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05));">
                <button type="button" class="quota-btn secondary" id="btn-export-safe">导出脱敏备份</button>
                <button type="button" class="quota-btn secondary" id="btn-export-full">导出完整结构 (凭据仍脱敏)</button>
                <button type="button" class="quota-btn secondary" id="btn-import-config">导入配置文件</button>
                <input type="file" id="input-import-file" accept=".json" style="display: none;" />
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
              <button type="submit" class="quota-btn">保存偏好设置</button>
            </div>
          </form>
        `;
      }
    }
    let drawerTitle = "配置凭据";
    let isDrawerTargetConfigured = false;
    if (activeDrawerTarget) {
      if (activeDrawerTarget.kind === "new_custom") {
        drawerTitle = "添加自定义中转站";
      } else if (activeDrawerTarget.kind === "custom") {
        drawerTitle = `编辑 · ${activeDrawerTarget.endpoint.name}`;
        isDrawerTargetConfigured = true;
      } else {
        const meta = PROVIDER_METAS[activeDrawerTarget.id];
        if (meta) {
          const currentCustomName = cfg.customNames?.[activeDrawerTarget.id] || cfg[activeDrawerTarget.id]?.name;
          drawerTitle = currentCustomName || meta.name;
          isDrawerTargetConfigured = getCredentialInfo(activeDrawerTarget.id, state.config || {}).isConfigured;
        }
      }
    }
    let addServiceModalHtml = "";
    if (isAddServiceModalOpen) {
      const unconfigured = Object.entries(PROVIDER_METAS).filter(([id]) => !getCredentialInfo(id, state.config || {}).isConfigured);
      const optionsHtml = unconfigured.map(([id, meta]) => `
        <div class="add-service-option" data-id="${id}">
          <span class="add-service-option-name">${meta.name}</span>
          <span style="font-size: 11px; color: var(--q-success); font-weight: 600;">+ 配置</span>
        </div>
      `).join("");
      addServiceModalHtml = `
        <div id="dsh-add-service-overlay" class="dsh-quota-modal-overlay">
          <div class="dsh-quota-modal" style="max-width: 460px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="dsh-quota-modal-title">选择要添加的服务</div>
              <button type="button" class="btn-drawer-close btn-close-add-modal" aria-label="关闭添加服务" style="font-size: 16px;">✕</button>
            </div>
            <div class="add-service-modal">
              ${optionsHtml || '<div style="grid-column: span 2; text-align: center; color: var(--dsw-alias-label-tertiary); padding: 20px 0;">已添加所有支持的官方服务</div>'}
            </div>
            <div style="border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
              <button type="button" class="quota-btn secondary action btn-modal-add-custom">+ 自定义 OneAPI / NewAPI 中转</button>
              <button type="button" class="quota-btn secondary action btn-close-add-modal">取消</button>
            </div>
          </div>
        </div>
      `;
    }
    let detailsModalHtml = "";
    if (isDrawerOpen && activeDrawerTarget) {
      const cards = state.allCards && state.allCards.length > 0 ? state.allCards : state.cards;
      detailsModalHtml = `
        <div id="dsh-details-modal-overlay" class="dsh-quota-modal-overlay">
          <div class="dsh-quota-modal dsh-details-modal">
            <div class="dsh-modal-header">
              <div class="dsh-drawer-title-wrap">
                <span class="dsh-drawer-title">${drawerTitle}</span>
                <span style="font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-left: 2px;">详细设置</span>
              </div>
              <button type="button" class="btn-drawer-close btn-close-details-modal" aria-label="关闭设置抽屉" title="关闭 (Esc)">✕</button>
            </div>
            <div class="dsh-drawer-body">
              ${renderDrawerBody(activeDrawerTarget, cfg, cards)}
            </div>
            <div class="dsh-drawer-footer">
              <button type="button" class="quota-btn danger btn-drawer-delete" style="display: ${isDrawerTargetConfigured ? "inline-block" : "none"};">删除凭据</button>
              <div style="display: flex; gap: 8px; margin-left: auto;">
                <button type="button" class="quota-btn secondary btn-drawer-cancel">取消</button>
                <button type="button" class="quota-btn btn-drawer-save">保存并生效</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }
    const lastUpdatedClock = formatClockTime(state.lastUpdated);
    const headerRefreshSec = state.config?.refreshIntervalSeconds ?? 60;
    const dataAgeMs = state.lastUpdated > 0 ? Date.now() - state.lastUpdated : 0;
    const dataIsStale = state.lastUpdated > 0 && dataAgeMs > Math.max(12e4, headerRefreshSec * 2e3);
    const relativeUpdated = formatRelativeTime(state.lastUpdated);
    const lastUpdatedLabel = lastUpdatedClock !== "" ? `最后更新 ${lastUpdatedClock}${relativeUpdated !== "" ? `（${relativeUpdated}）` : ""}` : "尚未更新";
    const headerRefreshLabel = headerRefreshSec < 60 ? `${headerRefreshSec} 秒` : `${Math.round(headerRefreshSec / 60)} 分钟`;
    const errorBannerHtml = state.error ? `
        <div class="quota-error-banner" role="alert">
          <span style="flex: none; font-weight: 600;">⚠ 刷新失败</span>
          <span class="quota-error-text" title="${esc(state.error)}">${esc(state.error)}</span>
          ${lastUpdatedClock !== "" ? `<span class="quota-error-time">显示 ${lastUpdatedClock} 的缓存数据</span>` : ""}
          <button type="button" class="quota-btn secondary btn-retry-refresh" style="flex: none; padding: 3px 10px; font-size: 11.5px;">重试</button>
        </div>
      ` : "";
    container.innerHTML = `
      <div class="quota-container">
        <div class="quota-header">
          <div class="quota-title">
            <span>AI 额度监控</span>
            <span class="quota-version-tag">v0.4.1</span>
            <span class="quota-updated-tag${dataIsStale ? " is-stale" : ""}" role="status"
              title="${dataIsStale ? "数据超过两个刷新周期未更新，可能已过期" : "数据最后更新时间"}">${lastUpdatedLabel}${dataIsStale ? " · 可能已过期" : ""}</span>
            <span class="quota-refresh-interval" data-goto-prefs role="button" tabindex="0" title="前往偏好设置">每 ${headerRefreshLabel}刷新</span>
            ${state.loading ? '<span class="quota-refresh-interval" role="status">正在刷新…</span>' : ""}
          </div>
          <div class="quota-header-actions">
            <div class="quota-tabs" role="tablist" aria-label="监控面板切换">
              <button id="tab-overview" role="tab" aria-selected="${state.activeTab === "overview"}" class="quota-tab-btn ${state.activeTab === "overview" ? "active" : ""}">监控看板</button>
              <button id="tab-settings" role="tab" aria-selected="${state.activeTab === "settings"}" class="quota-tab-btn ${state.activeTab === "settings" ? "active" : ""}">设置</button>
            </div>
            <button id="btn-refresh" class="quota-btn secondary" aria-label="全部刷新" title="全部刷新">
              <span aria-hidden="true">↻</span><span class="btn-label">全部刷新</span>
            </button>
          </div>
        </div>
        ${errorBannerHtml}
        ${contentHtml}
      </div>

      ${addServiceModalHtml}
      ${detailsModalHtml}
    `;
    if (previousScrollTop > 0) container.scrollTop = previousScrollTop;
    container.querySelector("#tab-overview")?.addEventListener("click", () => controller.setTab("overview"));
    container.querySelector("#tab-settings")?.addEventListener("click", () => controller.setTab("settings"));
    container.querySelector("#btn-refresh")?.addEventListener("click", () => controller.refresh(true));
    container.querySelector(".btn-retry-refresh")?.addEventListener("click", () => void controller.refresh(true));
    container.querySelector(".btn-goto-settings")?.addEventListener("click", () => controller.setTab("settings"));
    container.querySelectorAll(".category-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const cat = chip.getAttribute("data-cat");
        if (cat) controller.setCategory(cat);
      });
    });
    container.querySelectorAll("[data-group-toggle]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.getAttribute("data-group-toggle");
        if (key) controller.toggleGroupCollapse(key);
      });
    });
    container.querySelectorAll(".btn-card-refresh").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-refresh-id");
        if (id) void controller.refreshSingle(id);
      });
    });
    container.querySelectorAll(".btn-card-retry").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-retry-id");
        if (id) void controller.refreshSingle(id);
      });
    });
    container.querySelectorAll("[data-group-toggle]").forEach((el) => {
      el.addEventListener("keydown", (event) => {
        const keyboard = event;
        if (keyboard.key !== "Enter" && keyboard.key !== " ") return;
        keyboard.preventDefault();
        const key = el.getAttribute("data-group-toggle");
        if (key) controller.toggleGroupCollapse(key);
      });
    });
    const gotoPrefs = () => {
      controller.setTab("settings");
    };
    container.querySelectorAll("[data-goto-prefs]").forEach((el) => {
      el.addEventListener("click", gotoPrefs);
      el.addEventListener("keydown", (event) => {
        const keyboard = event;
        if (keyboard.key !== "Enter" && keyboard.key !== " ") return;
        keyboard.preventDefault();
        gotoPrefs();
      });
    });
    const categoryWrap = container.querySelector("[data-category-wrap]");
    const categoryBar = categoryWrap?.querySelector(".category-filter-bar");
    if (categoryWrap !== null && categoryBar !== null) {
      const syncCategoryEdges = () => {
        const overflow = categoryBar.scrollWidth - categoryBar.clientWidth > 2;
        categoryWrap.classList.toggle("can-scroll-left", overflow && categoryBar.scrollLeft > 2);
        categoryWrap.classList.toggle("can-scroll-right", overflow && categoryBar.scrollLeft + categoryBar.clientWidth < categoryBar.scrollWidth - 2);
      };
      categoryWrap.querySelectorAll(".category-scroll-btn").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          const direction = Number(btn.getAttribute("data-scroll") || "1");
          categoryBar.scrollBy({ left: direction * Math.max(120, categoryBar.clientWidth * 0.6), behavior: "smooth" });
        });
      });
      categoryBar.addEventListener("scroll", syncCategoryEdges, { passive: true });
      window.setTimeout(syncCategoryEdges, 0);
    }
    container.querySelectorAll(".quota-segmented-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sub = btn.getAttribute("data-subtab");
        if (sub && sub !== settingsSubTab) {
          settingsSubTab = sub;
          update();
        }
      });
    });
    container.querySelector(".btn-add-service")?.addEventListener("click", () => {
      isAddServiceModalOpen = true;
      update();
    });
    container.querySelectorAll(".btn-close-add-modal").forEach((btn) => {
      btn.addEventListener("click", () => {
        isAddServiceModalOpen = false;
        update();
      });
    });
    container.querySelector("#dsh-add-service-overlay")?.addEventListener("click", (e) => {
      if (e.target === container.querySelector("#dsh-add-service-overlay")) {
        isAddServiceModalOpen = false;
        update();
      }
    });
    container.querySelectorAll(".add-service-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const id = opt.getAttribute("data-id");
        if (id) openDrawer({ kind: "provider", id });
      });
    });
    container.querySelector(".btn-modal-add-custom")?.addEventListener("click", () => {
      openDrawer({ kind: "new_custom" });
    });
    container.querySelectorAll(".btn-open-drawer, .service-name-cell").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const isCustom = el.getAttribute("data-custom") === "true" || el.closest("[data-custom]")?.getAttribute("data-custom") === "true";
        const id = el.getAttribute("data-id") || el.closest("[data-id]")?.getAttribute("data-id");
        const currentCfg = controller.getSnapshot().config || {};
        if (isCustom) {
          const idxRaw = el.getAttribute("data-idx") || el.closest("[data-idx]")?.getAttribute("data-idx");
          const idx = Number(idxRaw);
          const ep = currentCfg.custom_compatible?.[idx];
          if (ep) openDrawer({ kind: "custom", endpoint: ep, index: idx });
        } else if (id) {
          openDrawer({ kind: "provider", id });
        }
      });
    });
    container.querySelectorAll(".btn-row-test").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        if (!id) return;
        btn.classList.add("spinning");
        try {
          const isCustom = id.startsWith("custom_");
          let res;
          if (isCustom) {
            const ep = (controller.getSnapshot().config?.custom_compatible || []).find((c) => c.id === id);
            const accountConfig = ep === void 0 ? void 0 : {
              id: ep.id,
              provider: "custom_api",
              name: ep.name,
              apiKey: ep.apiKey,
              baseUrl: ep.baseUrl,
              extra: { balancePath: ep.balancePath }
            };
            res = await controller.testConnection("custom_api", accountConfig);
          } else {
            res = await controller.testConnection(id);
          }
          const targetName = getServiceDisplayName(id, controller.getSnapshot().config || {}, PROVIDER_METAS[id]?.name || id);
          showToast(res.ok ? `${targetName}: 连接成功 (${res.latencyMs ?? 0}ms)` : `${targetName}: 连接失败 (${res.message})`, res.ok ? "success" : "error");
        } finally {
          btn.classList.remove("spinning");
        }
      });
    });
    container.querySelectorAll(".btn-row-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isCustom = btn.getAttribute("data-custom") === "true";
        const id = btn.getAttribute("data-id");
        const currentCfg = controller.getSnapshot().config || {};
        if (isCustom) {
          const idx = Number(btn.getAttribute("data-idx"));
          const ep = currentCfg.custom_compatible?.[idx];
          if (!ep) return;
          confirmModal({
            title: "确认删除中转站",
            content: `确定要删除「${ep.name}」吗？删除后将从列表中彻底移除。`,
            confirmText: "确认删除",
            onConfirm: async () => {
              const endpoints = [...currentCfg.custom_compatible || []];
              endpoints.splice(idx, 1);
              const enabledProviders = (currentCfg.enabledProviders || []).filter((x) => x !== ep.id);
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter((x) => x !== ep.id);
              const providerOrder = (currentCfg.providerOrder || []).filter((x) => x !== ep.id);
              try {
                await controller.saveConfig({
                  ...currentCfg,
                  custom_compatible: endpoints,
                  enabledProviders,
                  floatingHudProviders,
                  providerOrder
                });
                showToast("中转站已删除", "success");
              } catch (err) {
                showToast(`删除失败: ${err.message}`, "error");
              }
            }
          });
        } else if (id) {
          const meta = PROVIDER_METAS[id];
          const displayName = getServiceDisplayName(id, currentCfg, meta?.name || id);
          confirmModal({
            title: "确认清除凭据",
            content: `确定要清除「${displayName}」的凭据吗？删除后该服务将从列表中移除。`,
            confirmText: "确认清除",
            onConfirm: async () => {
              const enabledProviders = (currentCfg.enabledProviders || []).filter((x) => x !== id);
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter((x) => x !== id);
              const clearObj = { enabled: false };
              if (id === "cursor") {
                clearObj.sessionToken = "";
                clearObj.autoDetectLocal = false;
              } else if (id === "antigravity" || id === "codex") {
                clearObj.oauth = void 0;
                clearObj.autoDetectLocal = false;
              } else if (id === "github_copilot") {
                clearObj.token = "";
                clearObj.autoDetectLocal = false;
              } else {
                clearObj.apiKey = "";
                clearObj.baseUrl = "";
              }
              try {
                await controller.saveConfig({
                  ...currentCfg,
                  enabledProviders,
                  floatingHudProviders,
                  [id]: {
                    ...currentCfg[id],
                    ...clearObj
                  }
                });
                showToast(`「${displayName}」凭据已清除`, "success");
              } catch (err) {
                showToast(`清除失败: ${err.message}`, "error");
              }
            }
          });
        }
      });
    });
    container.querySelectorAll(".switch-dashboard").forEach((sw) => {
      sw.addEventListener("change", async (e) => {
        e.stopPropagation();
        const currentCfg = controller.getSnapshot().config || {};
        const id = sw.getAttribute("data-id");
        if (!id) return;
        const isChecked = sw.checked;
        const enabledSet = new Set(currentCfg.enabledProviders || Object.keys(PROVIDER_METAS));
        const customEndpoints = (currentCfg.custom_compatible || []).map((c) => c.id);
        const allIds = [...customEndpoints, ...Object.keys(PROVIDER_METAS)];
        let order = currentCfg.providerOrder && currentCfg.providerOrder.length > 0 ? [...currentCfg.providerOrder] : allIds;
        for (const provId of allIds) {
          if (!order.includes(provId)) order.push(provId);
        }
        if (isChecked) {
          enabledSet.add(id);
          order = order.filter((x) => x !== id);
          const firstUnchosenIdx = order.findIndex((x) => !enabledSet.has(x));
          if (firstUnchosenIdx === -1) order.push(id);
          else order.splice(firstUnchosenIdx, 0, id);
        } else {
          enabledSet.delete(id);
          order = order.filter((x) => x !== id);
          order.push(id);
        }
        try {
          await controller.saveConfig({
            ...currentCfg,
            enabledProviders: Array.from(enabledSet),
            providerOrder: order
          });
          showToast(isChecked ? "已添加到看板" : "已从看板移至底部", "info");
        } catch (err) {
          showToast(`更新失败: ${err.message}`, "error");
        }
      });
    });
    container.querySelectorAll(".switch-hud").forEach((sw) => {
      sw.addEventListener("change", async (e) => {
        e.stopPropagation();
        const currentCfg = controller.getSnapshot().config || {};
        const id = sw.getAttribute("data-id");
        if (!id) return;
        const isChecked = sw.checked;
        const hudSet = new Set(currentCfg.floatingHudProviders || currentCfg.enabledProviders || Object.keys(PROVIDER_METAS));
        if (isChecked) hudSet.add(id);
        else hudSet.delete(id);
        try {
          await controller.saveConfig({ ...currentCfg, floatingHudProviders: Array.from(hudSet) });
          showToast(isChecked ? "已添加到悬浮球轮播" : "已从悬浮球轮播移除", "info");
        } catch (err) {
          showToast(`更新失败: ${err.message}`, "error");
        }
      });
    });
    let draggedId = null;
    container.querySelectorAll(".sort-drag-handle").forEach((handleEl) => {
      const handle = handleEl;
      const row = handle.closest(".quota-table-row");
      if (!row) return;
      handle.addEventListener("dragstart", (e) => {
        draggedId = row.getAttribute("data-service-id");
        row.classList.add("dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", draggedId || "");
        }
      });
      handle.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        container.querySelectorAll(".quota-table-row").forEach((r) => r.classList.remove("drag-over-top", "drag-over-bottom"));
        draggedId = null;
      });
    });
    container.querySelectorAll(".quota-table-row").forEach((rowEl) => {
      const row = rowEl;
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          row.classList.add("drag-over-top");
          row.classList.remove("drag-over-bottom");
        } else {
          row.classList.add("drag-over-bottom");
          row.classList.remove("drag-over-top");
        }
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over-top", "drag-over-bottom");
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        row.classList.remove("drag-over-top", "drag-over-bottom");
        const targetId = row.getAttribute("data-service-id");
        if (!draggedId || !targetId || draggedId === targetId) return;
        const currentCfg = controller.getSnapshot().config || {};
        const customEndpoints = (currentCfg.custom_compatible || []).map((c) => c.id);
        const allIds = [...customEndpoints, ...Object.keys(PROVIDER_METAS)];
        const order = currentCfg.providerOrder && currentCfg.providerOrder.length > 0 ? [...currentCfg.providerOrder] : allIds;
        for (const id of allIds) {
          if (!order.includes(id)) order.push(id);
        }
        const fromIdx = order.indexOf(draggedId);
        const toIdx = order.indexOf(targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        const rect = row.getBoundingClientRect();
        const insertAfter = e.clientY >= rect.top + rect.height / 2;
        order.splice(fromIdx, 1);
        const newTargetIdx = order.indexOf(targetId);
        const finalIdx = insertAfter ? newTargetIdx + 1 : newTargetIdx;
        order.splice(finalIdx, 0, draggedId);
        try {
          await controller.saveConfig({ ...currentCfg, providerOrder: order });
          showToast("排序已更新", "info");
        } catch (err) {
          showToast(`排序保存失败: ${err.message}`, "error");
        }
      });
    });
    container.querySelector(".btn-test-all")?.addEventListener("click", async () => {
      const btn = container.querySelector(".btn-test-all");
      if (btn) btn.textContent = "测活中...";
      try {
        await controller.testAllConnections();
        showToast("一键全部测活完成！", "info");
      } catch (err) {
        showToast("测活失败: " + err.message, "error");
      } finally {
        if (btn) btn.textContent = "一键全部测活";
      }
    });
    const alarmSlider = container.querySelector("#pref-alarm-slider");
    const alarmVal = container.querySelector("#pref-alarm-val");
    alarmSlider?.addEventListener("input", () => {
      if (alarmVal) alarmVal.textContent = `${alarmSlider.value}%`;
    });
    const prefForm = container.querySelector("#quota-pref-form");
    prefForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const showFloatingHud = container.querySelector("#pref-hud-switch")?.checked ?? true;
      const enableNotification = container.querySelector("#pref-notify-switch")?.checked ?? true;
      const alarmThresholdPercent = parseInt(container.querySelector("#pref-alarm-slider")?.value || "15", 10);
      const refreshIntervalSeconds = parseInt(container.querySelector("#pref-refresh-select")?.value || "60", 10);
      const httpProxy = container.querySelector("#pref-proxy-input")?.value.trim();
      const currentCfg = controller.getSnapshot().config || {};
      try {
        await controller.saveConfig({
          ...currentCfg,
          showFloatingHud,
          enableNotification,
          alarmThresholdPercent,
          refreshIntervalSeconds,
          httpProxy: httpProxy || void 0
        });
        showToast("偏好设置已保存！", "success");
      } catch (err) {
        showToast(`保存失败: ${err.message}`, "error");
      }
    });
    container.querySelector("#btn-export-safe")?.addEventListener("click", () => {
      const cfg2 = controller.getSnapshot().config || {};
      const safeCfg = sanitizeConfigForExport(cfg2);
      downloadJsonFile(`dsh-quota-config-safe-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`, safeCfg);
      showToast("已导出安全脱敏配置文件", "success");
    });
    container.querySelector("#btn-export-full")?.addEventListener("click", () => {
      const cfg2 = controller.getSnapshot().config || {};
      downloadJsonFile(`dsh-quota-config-backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`, cfg2);
      showToast("已导出完整配置结构（凭据已脱敏，不能用于恢复密钥）", "info");
    });
    container.querySelector("#btn-import-config")?.addEventListener("click", () => {
      container.querySelector("#input-import-file")?.click();
    });
    container.querySelector("#input-import-file")?.addEventListener("change", (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result);
          if (typeof parsed !== "object" || parsed === null) {
            throw new Error("配置文件非有效 JSON 对象");
          }
          confirmModal({
            title: "导入配置确认",
            content: "确认导入该配置文件吗？导入后现有配置将被覆盖并即刻生效。",
            confirmText: "立即导入",
            onConfirm: async () => {
              await controller.saveConfig(parsed);
              showToast("配置导入成功并已即刻生效！", "success");
              void controller.refresh(true);
            }
          });
        } catch (err) {
          showToast(`导入失败: ${err.message}`, "error");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
    if (isDrawerOpen && activeDrawerTarget) {
      container.querySelector("#dsh-details-modal-overlay")?.addEventListener("click", (e) => {
        if (e.target === container.querySelector("#dsh-details-modal-overlay")) {
          closeDrawer();
        }
      });
      container.querySelector(".btn-close-details-modal")?.addEventListener("click", closeDrawer);
      container.querySelector(".btn-drawer-cancel")?.addEventListener("click", closeDrawer);
      container.querySelectorAll(".btn-toggle-eye").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetSel = btn.getAttribute("data-target");
          if (!targetSel) return;
          const input = container.querySelector(targetSel);
          if (input) {
            const isPwd = input.type === "password";
            input.type = isPwd ? "text" : "password";
            btn.textContent = isPwd ? "🔒" : "👁";
          }
        });
      });
      container.querySelector(".btn-drawer-save")?.addEventListener("click", async () => {
        if (!activeDrawerTarget) return;
        const currentCfg = controller.getSnapshot().config || {};
        const customNameInput = container.querySelector("#drawer-custom-name-input");
        const metricCbs = container.querySelectorAll(".cb-hud-metric");
        const targetProvId = activeDrawerTarget.kind === "custom" ? activeDrawerTarget.endpoint.id : activeDrawerTarget.kind === "new_custom" ? "" : activeDrawerTarget.id;
        let updatedFloatingMetrics = currentCfg.floatingHudMetrics;
        if (metricCbs.length > 0 && targetProvId) {
          let baseList = (currentCfg.floatingHudMetrics || []).filter((k) => typeof k === "string" && !k.startsWith(`${targetProvId}::`));
          let checkedCount = 0;
          metricCbs.forEach((cb) => {
            if (cb.checked) {
              checkedCount++;
              const k = cb.getAttribute("data-key");
              if (k) baseList.push(k);
            }
          });
          if (checkedCount === 0) {
            baseList.push(`${targetProvId}::__none__`);
          }
          updatedFloatingMetrics = baseList;
        }
        if (activeDrawerTarget.kind === "new_custom" || activeDrawerTarget.kind === "custom") {
          const baseInput2 = container.querySelector("#drawer-cust-base");
          const keyInput2 = container.querySelector("#drawer-cust-key");
          const name = customNameInput?.value.trim() || "自定义中转站";
          const baseUrl = baseInput2?.value.trim() || "https://api.openai.com";
          const apiKey = keyInput2?.value.trim() || "";
          if (!apiKey) {
            showToast("请输入中转站 API Key", "error");
            return;
          }
          const endpoints = [...currentCfg.custom_compatible || []];
          let targetId = "";
          if (activeDrawerTarget.kind === "new_custom") {
            targetId = `custom_${Date.now()}`;
            endpoints.push({ id: targetId, name, baseUrl, apiKey, enabled: true });
          } else {
            targetId = activeDrawerTarget.endpoint.id;
            endpoints[activeDrawerTarget.index] = { id: targetId, name, baseUrl, apiKey, enabled: true };
          }
          const enabledProviders2 = Array.isArray(currentCfg.enabledProviders) ? [...currentCfg.enabledProviders] : [...Object.keys(PROVIDER_METAS)];
          if (!enabledProviders2.includes(targetId)) enabledProviders2.push(targetId);
          const floatingHudProviders2 = Array.isArray(currentCfg.floatingHudProviders) ? [...currentCfg.floatingHudProviders] : [...enabledProviders2];
          if (!floatingHudProviders2.includes(targetId)) floatingHudProviders2.push(targetId);
          const providerOrder2 = Array.isArray(currentCfg.providerOrder) ? [...currentCfg.providerOrder] : [...Object.keys(PROVIDER_METAS)];
          if (!providerOrder2.includes(targetId)) providerOrder2.push(targetId);
          try {
            await controller.saveConfig({
              ...currentCfg,
              custom_compatible: endpoints,
              enabledProviders: enabledProviders2,
              floatingHudProviders: floatingHudProviders2,
              floatingHudMetrics: updatedFloatingMetrics,
              providerOrder: providerOrder2,
              customNames: {
                ...currentCfg.customNames || {},
                [targetId]: name
              }
            });
            showToast(`中转站「${name}」配置已保存！`, "success");
            closeDrawer();
          } catch (err) {
            showToast(`保存失败: ${err.message}`, "error");
          }
          return;
        }
        const prov = activeDrawerTarget.id;
        const meta = PROVIDER_METAS[prov];
        const keyInput = container.querySelector("#drawer-key-input");
        const baseInput = container.querySelector("#drawer-base-input");
        const groupInput = container.querySelector("#drawer-group-input");
        const customName = customNameInput?.value.trim() || void 0;
        const provUpdate = { enabled: true };
        if (customName) provUpdate.name = customName;
        if (keyInput) {
          const val = keyInput.value.trim();
          if (prov === "cursor") provUpdate.sessionToken = val;
          else if (prov === "codex") provUpdate.oauth = val ? { accessToken: val } : currentCfg.codex?.oauth;
          else if (prov === "github_copilot") provUpdate.token = val;
          else provUpdate.apiKey = val;
        }
        if (baseInput) provUpdate.baseUrl = baseInput.value.trim() || void 0;
        if (groupInput) provUpdate.groupId = groupInput.value.trim() || void 0;
        if (prov === "cursor") {
          const autoDetect = container.querySelector("#drawer-cursor-auto")?.checked ?? true;
          provUpdate.autoDetectLocal = autoDetect;
        } else if (prov === "antigravity") {
          const autoDetect = container.querySelector("#drawer-antigravity-auto")?.checked ?? true;
          provUpdate.autoDetectLocal = autoDetect;
        } else if (prov === "codex") {
          const autoDetect = container.querySelector("#drawer-codex-auto")?.checked ?? true;
          provUpdate.autoDetectLocal = autoDetect;
        } else if (prov === "github_copilot") {
          const autoDetect = container.querySelector("#drawer-copilot-auto")?.checked ?? true;
          provUpdate.autoDetectLocal = autoDetect;
        }
        const keyRequiredList = ["deepseek", "openai_billing", "claude", "kimi", "glm", "qwen", "volcengine", "minimax", "opencode_go"];
        if (keyRequiredList.includes(prov) && !provUpdate.apiKey) {
          showToast("请输入 API Key 后再保存", "error");
          return;
        }
        const enabledProviders = Array.isArray(currentCfg.enabledProviders) ? [...currentCfg.enabledProviders] : [...Object.keys(PROVIDER_METAS)];
        if (!enabledProviders.includes(prov)) enabledProviders.push(prov);
        const floatingHudProviders = Array.isArray(currentCfg.floatingHudProviders) ? [...currentCfg.floatingHudProviders] : [...enabledProviders];
        if (!floatingHudProviders.includes(prov)) floatingHudProviders.push(prov);
        const providerOrder = Array.isArray(currentCfg.providerOrder) ? [...currentCfg.providerOrder] : [...Object.keys(PROVIDER_METAS)];
        if (!providerOrder.includes(prov)) providerOrder.push(prov);
        const updatedCustomNames = {
          ...currentCfg.customNames || {},
          [prov]: customName || ""
        };
        try {
          await controller.saveConfig({
            ...currentCfg,
            enabledProviders,
            floatingHudProviders,
            floatingHudMetrics: updatedFloatingMetrics,
            providerOrder,
            customNames: updatedCustomNames,
            [prov]: {
              ...currentCfg[prov],
              ...provUpdate
            }
          });
          showToast(`「${customName || meta?.name || prov}」配置已保存生效！`, "success");
          closeDrawer();
          void controller.refreshSingle(prov);
        } catch (err) {
          showToast(`保存失败: ${err.message}`, "error");
        }
      });
      container.querySelector(".btn-drawer-delete")?.addEventListener("click", () => {
        if (!activeDrawerTarget) return;
        const currentCfg = controller.getSnapshot().config || {};
        const drawerTarget = activeDrawerTarget;
        if (drawerTarget.kind === "custom") {
          const targetEp = drawerTarget.endpoint;
          confirmModal({
            title: "确认删除中转站",
            content: `确定要删除中转端点「${targetEp.name}」吗？删除后将从列表中彻底移除。`,
            confirmText: "确认删除",
            onConfirm: async () => {
              const endpoints = [...currentCfg.custom_compatible || []];
              endpoints.splice(drawerTarget.index, 1);
              const enabledProviders = (currentCfg.enabledProviders || []).filter((id) => id !== targetEp.id);
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter((id) => id !== targetEp.id);
              const providerOrder = (currentCfg.providerOrder || []).filter((id) => id !== targetEp.id);
              try {
                await controller.saveConfig({
                  ...currentCfg,
                  custom_compatible: endpoints,
                  enabledProviders,
                  floatingHudProviders,
                  providerOrder
                });
                showToast("中转站已删除", "success");
                closeDrawer();
              } catch (err) {
                showToast(`删除失败: ${err.message}`, "error");
              }
            }
          });
          return;
        }
        if (activeDrawerTarget.kind === "provider") {
          const prov = activeDrawerTarget.id;
          const meta = PROVIDER_METAS[prov];
          confirmModal({
            title: "确认删除凭据",
            content: `确定要删除「${meta?.name || prov}」的登录凭据吗？删除后该服务将从列表中移除。`,
            confirmText: "确认删除",
            onConfirm: async () => {
              const enabledProviders = (currentCfg.enabledProviders || []).filter((id) => id !== prov);
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter((id) => id !== prov);
              const clearObj = { enabled: false };
              if (prov === "cursor") {
                clearObj.sessionToken = "";
                clearObj.autoDetectLocal = false;
              } else if (prov === "antigravity" || prov === "codex") {
                clearObj.oauth = void 0;
                clearObj.autoDetectLocal = false;
              } else if (prov === "github_copilot") {
                clearObj.token = "";
                clearObj.autoDetectLocal = false;
              } else {
                clearObj.apiKey = "";
                clearObj.baseUrl = "";
              }
              try {
                await controller.saveConfig({
                  ...currentCfg,
                  enabledProviders,
                  floatingHudProviders,
                  [prov]: {
                    ...currentCfg[prov],
                    ...clearObj
                  }
                });
                showToast(`「${meta?.name || prov}」凭据已删除`, "success");
                closeDrawer();
              } catch (err) {
                showToast(`删除失败: ${err.message}`, "error");
              }
            }
          });
        }
      });
      container.querySelector(".btn-drawer-test")?.addEventListener("click", async () => {
        if (!activeDrawerTarget || activeDrawerTarget.kind !== "provider") return;
        const prov = activeDrawerTarget.id;
        const fbEl = container.querySelector("#drawer-test-result");
        if (fbEl) {
          fbEl.className = "drawer-test-result ok";
          fbEl.textContent = "测试中...";
        }
        const keyInput = container.querySelector("#drawer-key-input");
        const baseInput = container.querySelector("#drawer-base-input");
        const keyVal = keyInput?.value.trim() || "";
        const baseVal = baseInput?.value.trim() || "";
        const accConfig = keyVal ? { id: prov, provider: prov, apiKey: keyVal, sessionToken: keyVal, baseUrl: baseVal || void 0 } : void 0;
        const res = await controller.testConnection(prov, accConfig);
        if (fbEl) {
          if (res.ok) {
            fbEl.className = "drawer-test-result ok";
            fbEl.textContent = `✓ 连接成功 · ${res.latencyMs ?? 0}ms`;
          } else {
            fbEl.className = "drawer-test-result err";
            fbEl.textContent = `✗ ${res.message || "连接失败"}`;
            fbEl.title = `✗ ${res.message || "连接失败"}`;
          }
        }
      });
      container.querySelector(".btn-drawer-test-cust")?.addEventListener("click", async () => {
        const fbEl = container.querySelector("#drawer-test-result");
        const customNameInput = container.querySelector("#drawer-custom-name-input");
        const name = customNameInput?.value.trim() || "中转站";
        const baseUrl = container.querySelector("#drawer-cust-base")?.value.trim() || "https://api.openai.com";
        const apiKey = container.querySelector("#drawer-cust-key")?.value.trim() || "";
        if (!apiKey) {
          showToast("请输入 API Key 后再测活", "error");
          return;
        }
        if (fbEl) {
          fbEl.className = "drawer-test-result ok";
          fbEl.textContent = "测试中...";
        }
        const res = await controller.testConnection("custom_api", {
          id: "test_cust",
          provider: "custom_api",
          name,
          baseUrl,
          apiKey
        });
        if (fbEl) {
          if (res.ok) {
            fbEl.className = "drawer-test-result ok";
            fbEl.textContent = `✓ 连接成功 · ${res.latencyMs ?? 0}ms`;
          } else {
            fbEl.className = "drawer-test-result err";
            fbEl.textContent = `✗ ${res.message || "连接失败"}`;
            fbEl.title = `✗ ${res.message || "连接失败"}`;
          }
        }
      });
      container.querySelector(".btn-login-antigravity")?.addEventListener("click", async () => {
        try {
          const authUrl = await controller.startAntigravityLogin();
          window.open(authUrl, "_blank");
          setTimeout(() => controller.refresh(true), 4e3);
        } catch (err) {
          showToast("启动 Google 登录失败: " + err.message, "error");
        }
      });
      container.querySelector(".btn-login-codex")?.addEventListener("click", async () => {
        try {
          const authUrl = await controller.startCodexLogin();
          window.open(authUrl, "_blank");
          setTimeout(() => controller.refresh(true), 4e3);
        } catch (err) {
          showToast("启动 Codex 登录失败: " + err.message, "error");
        }
      });
      container.querySelector(".btn-connect-cursor")?.addEventListener("click", async () => {
        try {
          await controller.connectCursor();
          showToast("已从本地 Cursor 同步登录凭据！", "success");
          await controller.refresh(true);
          closeDrawer();
        } catch (err) {
          showToast("连接 Cursor 失败: " + err.message, "error");
        }
      });
    }
  }
  function handleKeyDown(e) {
    if (e.key === "Escape") {
      settingsDirty = false;
      if (isDrawerOpen) closeDrawer();
      else if (isAddServiceModalOpen) {
        isAddServiceModalOpen = false;
        update();
      }
    }
  }
  document.addEventListener("keydown", handleKeyDown);
  function markDirty(event) {
    const target = event.target;
    if (target === null) return;
    if (target.tagName === "INPUT") {
      const type = target.type;
      if (type === "checkbox" || type === "radio" || type === "file" || type === "button" || type === "submit") return;
    }
    if (target.tagName === "BUTTON") return;
    settingsDirty = true;
  }
  function clearDirtyOnAction(event) {
    const target = event.target;
    if (target === null) return;
    if (target.closest('.quota-tab-btn, .category-chip, [data-group-toggle], .btn-card-refresh, #btn-refresh, .quota-segmented-btn, .btn-add-service, .btn-drawer-save, .btn-drawer-cancel, .btn-drawer-close, .btn-drawer-delete, .btn-close-add-modal, .btn-goto-settings, .btn-retry-refresh, button[type="submit"]') !== null || target.matches("#dsh-details-modal-overlay, #dsh-add-service-overlay")) {
      settingsDirty = false;
    }
  }
  const clearDirtyOnSubmit = () => {
    settingsDirty = false;
  };
  container.addEventListener("input", markDirty, true);
  container.addEventListener("change", markDirty, true);
  container.addEventListener("click", clearDirtyOnAction, true);
  container.addEventListener("submit", clearDirtyOnSubmit, true);
  const unsubscribe = controller.subscribe(update);
  update();
  return () => {
    unsubscribe();
    document.removeEventListener("keydown", handleKeyDown);
    container.removeEventListener("input", markDirty, true);
    container.removeEventListener("change", markDirty, true);
    container.removeEventListener("click", clearDirtyOnAction, true);
    container.removeEventListener("submit", clearDirtyOnSubmit, true);
    for (const node of externalNodes) node.remove();
    externalNodes.clear();
    const toast = document.getElementById("dsh-quota-toast");
    if (toast !== null) {
      clearTimeout(toast._timer);
      toast.remove();
    }
    styleEl.remove();
  };
}

// src/client/mount.ts
var CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
var ACTIVE_ATTR = "data-dsh-quota-active";
var OTHER_ACTIVE_ATTRS = ["data-dsh-taskboard-active", "data-dsh-ssh-active"];
var ACTIVATE_EVENT = "dsh-panel-activate";
var PANEL_NAME = "quota";
function conversationColumn() {
  return document.querySelector(CONVERSATION_COLUMN_SELECTOR) ?? void 0;
}
function mountPanel(controller) {
  let container;
  let disposeView;
  let frameId = null;
  const requestFrame = (callback) => {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(() => callback());
    return setTimeout(callback, 16);
  };
  const cancelFrame = (id) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    else clearTimeout(id);
  };
  const observer = new MutationObserver(() => {
    if (frameId !== null) return;
    frameId = requestFrame(() => {
      frameId = null;
      ensure();
    });
  });
  const observeNarrow = (column) => {
    observer.disconnect();
    observer.observe(column, { childList: true });
    if (column.parentElement !== null) observer.observe(column.parentElement, { childList: true });
    observer.observe(document.body, { childList: true });
  };
  const observeBroad = () => {
    observer.disconnect();
    observer.observe(document.body, { childList: true, subtree: true });
  };
  const ensure = () => {
    if (container !== void 0) {
      if (container.isConnected) return;
      disposeView?.();
      container.remove();
      container = void 0;
      disposeView = void 0;
    }
    const column = conversationColumn();
    if (column === void 0) {
      observeBroad();
      return;
    }
    container = document.createElement("div");
    container.dataset.dshQuotaView = "";
    container.dataset.dshPlugin = "quota";
    column.appendChild(container);
    disposeView = renderQuotaApp(container, controller);
    observeNarrow(column);
  };
  const applyActive = () => {
    if (controller.getSnapshot().panelOpen) {
      for (const attr of OTHER_ACTIVE_ATTRS) {
        document.documentElement.removeAttribute(attr);
      }
      document.documentElement.setAttribute(ACTIVE_ATTR, "");
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR);
    }
  };
  const onOtherActivate = (event) => {
    const detail = event.detail;
    if (detail !== PANEL_NAME && controller.getSnapshot().panelOpen) {
      controller.close();
    }
  };
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]';
  const onClickSidebarRow = (event) => {
    if (!controller.getSnapshot().panelOpen) return;
    const target = event.target;
    if (target === null) return;
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close();
  };
  document.addEventListener("click", onClickSidebarRow, true);
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
  const unsubscribe = controller.subscribe(applyActive);
  applyActive();
  ensure();
  return () => {
    document.removeEventListener("click", onClickSidebarRow, true);
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
    observer.disconnect();
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    unsubscribe();
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    disposeView?.();
    container?.remove();
    container = void 0;
  };
}

// src/client/hud.ts
var HUD_SIZE = 46;
var NARROW_BREAKPOINT = 640;
var POSITION_STORAGE_KEY = "dsh_quota_hud_pos";
var PAUSED_STORAGE_KEY = "dsh_quota_hud_paused";
var CAROUSEL_INTERVAL_MS = 4500;
var ERROR_THRESHOLD_PERCENT = 15;
var WARN_THRESHOLD_PERCENT = 35;
var HOVER_HIDE_DELAY_MS = 140;
var PAUSE_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"></rect><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"></rect></svg>`;
var PLAY_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M5 3.4 12.2 8 5 12.6Z" fill="currentColor"></path></svg>`;
function isQuantifiedMetric(metric) {
  return metric.kind === "usage" && typeof metric.remainingPercent === "number" && Number.isFinite(metric.remainingPercent);
}
function metricValueText(metric) {
  if (isQuantifiedMetric(metric)) return `${Math.round(metric.remainingPercent)}% 剩余`;
  if (metric.kind === "balance") return metric.amountText || "—";
  if (metric.kind === "liveness") return "仅连通性";
  return "未知";
}
function inferMetricShortLabel(window2) {
  if (windowQuotaKind(window2) === "balance") return "余额";
  switch (window2.windowKind) {
    case "5h":
      return "5h";
    case "weekly":
      return "周";
    case "monthly":
      return "月";
    case "sliding":
      return "滚动";
    default:
      break;
  }
  const text = `${window2.label || ""} ${window2.id || ""}`.toLowerCase();
  if (/(^|[^0-9])5\s*[- ]?h|5\s*小时|five[\s-]?hour/.test(text)) return "5h";
  if (/weekly|week|周/.test(text)) return "周";
  if (/monthly|month|月度|月/.test(text)) return "月";
  if (/slid|roll|滚动|滑动/.test(text)) return "滚动";
  if (/balance|余额/.test(text)) return "余额";
  return "量";
}
function statusTone(remainingPercent) {
  if (remainingPercent <= ERROR_THRESHOLD_PERCENT) return "error";
  if (remainingPercent <= WARN_THRESHOLD_PERCENT) return "warn";
  return "ok";
}
var HTML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'"
};
function decodeHudText(value) {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}
function metricAriaText(metric) {
  const service = decodeHudText(metric.service);
  const label = metric.shortLabel === "量" ? "" : `${metric.shortLabel} `;
  if (isQuantifiedMetric(metric)) {
    const percent = Math.round(metric.remainingPercent);
    if (percent <= 0) return `${service} ${label}剩余 0%，额度已耗尽`;
    return `${service} ${label}剩余 ${percent}%`;
  }
  if (metric.kind === "balance") return `${service} 余额 ${decodeHudText(metric.amountText || "未知")}`;
  if (metric.kind === "liveness") return `${service} 仅连通性，未提供额度接口`;
  return `${service} 额度状态未知`;
}
function computePopoverPlacement(position, viewportWidth) {
  const vertical = position.y < 200 ? "pop-bottom" : "pop-top";
  if (viewportWidth >= NARROW_BREAKPOINT) {
    return {
      vertical,
      horizontal: position.x > viewportWidth / 2 ? "pop-right" : "pop-left"
    };
  }
  const cardWidth = Math.min(220, viewportWidth - 24);
  const roomLeft = position.x + HUD_SIZE - 8;
  const roomRight = viewportWidth - position.x - 8;
  if (roomLeft >= cardWidth) return { vertical, horizontal: "pop-right" };
  if (roomRight >= cardWidth) return { vertical, horizontal: "pop-left" };
  return { vertical, horizontal: roomRight >= roomLeft ? "pop-left" : "pop-right" };
}
function neutralRingSvg() {
  return `
    <svg class="dsh-hud-svg" viewBox="0 0 46 46" aria-hidden="true" focusable="false">
      <circle class="dsh-hud-ring-track" cx="23" cy="23" r="18"></circle>
    </svg>
  `;
}
function getSavedPosition() {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (raw) {
      const pos = JSON.parse(raw);
      if (typeof pos.x === "number" && typeof pos.y === "number") {
        const maxX = Math.max(10, window.innerWidth - 60);
        const maxY = Math.max(10, window.innerHeight - 60);
        return {
          x: Math.min(Math.max(12, pos.x), maxX),
          y: Math.min(Math.max(12, pos.y), maxY)
        };
      }
    }
  } catch {
  }
  return { x: Math.max(12, window.innerWidth - 64), y: Math.max(60, window.innerHeight - 160) };
}
function savePosition(pos) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
  } catch {
  }
}
function readPausedState() {
  try {
    return sessionStorage.getItem(PAUSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function savePausedState(paused) {
  try {
    sessionStorage.setItem(PAUSED_STORAGE_KEY, paused ? "1" : "0");
  } catch {
  }
}
function mountQuotaHud(controller) {
  const hudEl = document.createElement("div");
  hudEl.setAttribute("data-dsh-quota-hud", "");
  hudEl.setAttribute("role", "button");
  hudEl.setAttribute("tabindex", "0");
  hudEl.setAttribute("aria-haspopup", "true");
  hudEl.setAttribute("aria-expanded", "false");
  hudEl.style.cssText = `
    position: fixed;
    z-index: 990;
    width: 46px;
    height: 46px;
    cursor: grab;
    user-select: none;
    touch-action: none;
    transition: transform 0.16s ease, opacity 0.16s ease;
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    [data-dsh-quota-hud] {
      --q-success: var(--dsw-alias-state-success-primary, #3F7A63);
      --q-warn: var(--dsw-alias-state-warn-primary, #BA8137);
      --q-error: var(--dsw-alias-state-error-primary, #B04A46);
      --q-fg: var(--dsw-alias-label-primary, #1f2328);
      --q-fg-2: var(--dsw-alias-label-secondary, #57606a);
      --q-bg: var(--dsw-alias-bg-base, #fff);
      --q-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
      --q-track: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.14));
      /* The raw border token is a hairline; on dark surfaces it disappears.
         Mixing it toward the label colour keeps the dial ring legible in both themes. */
      --q-track-on-surface: color-mix(in srgb, var(--q-track) 70%, var(--q-fg) 30%);
      --q-shadow: color-mix(in srgb, #000 24%, transparent);
      --q-scrim: color-mix(in srgb, var(--q-fg) 9%, transparent);
      --q-pulse-ring: color-mix(in srgb, var(--q-error) 45%, transparent);
      --q-card-width: 240px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
    }
    @media (prefers-color-scheme: dark) {
      [data-dsh-quota-hud] {
        --q-bg: var(--dsw-alias-bg-base, #17191f);
        --q-fg: var(--dsw-alias-label-primary, #e6edf3);
        --q-fg-2: var(--dsw-alias-label-secondary, #9aa4b2);
        --q-border: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
        --q-track: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.3));
      }
    }
    @keyframes q-pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--q-pulse-ring); opacity: 1; }
      50% { box-shadow: 0 0 0 6px var(--q-pulse-ring); opacity: 0.82; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-dsh-quota-hud],
      [data-dsh-quota-hud] * {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    }
    [data-dsh-quota-hud]:focus-visible {
      outline: 2px solid var(--q-fg);
      outline-offset: 3px;
      border-radius: 50%;
    }
    [data-dsh-quota-hud] .dsh-hud-circle {
      position: relative;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: var(--q-bg);
      border: 1px solid var(--q-border);
      box-shadow: 0 4px 14px var(--q-shadow);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: visible;
      transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
    }
    [data-dsh-quota-hud] .dsh-hud-circle:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 18px var(--q-shadow);
    }
    [data-dsh-quota-hud] .dsh-hud-circle.docked {
      opacity: 0.72;
    }
    [data-dsh-quota-hud] .dsh-hud-circle.docked:hover {
      opacity: 1;
    }
    [data-dsh-quota-hud] .dsh-hud-circle.is-exhausted {
      border-color: var(--q-error);
      animation: q-pulse 1.8s ease-in-out infinite;
    }
    [data-dsh-quota-hud] .dsh-hud-svg {
      position: absolute;
      inset: 0;
      width: 46px;
      height: 46px;
      transform: rotate(-90deg);
      pointer-events: none;
    }
    [data-dsh-quota-hud] .dsh-hud-ring-track {
      fill: none;
      stroke: var(--q-track-on-surface, var(--q-track));
      stroke-width: 3;
    }
    [data-dsh-quota-hud] .dsh-hud-ring-value {
      fill: none;
      stroke-width: 3;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;
    }
    [data-dsh-quota-hud] .dsh-hud-ring-value.is-ok { stroke: var(--q-success); }
    [data-dsh-quota-hud] .dsh-hud-ring-value.is-warn { stroke: var(--q-warn); }
    [data-dsh-quota-hud] .dsh-hud-ring-value.is-error { stroke: var(--q-error); }
    [data-dsh-quota-hud] .dsh-hud-content {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      line-height: 1;
      pointer-events: none;
    }
    [data-dsh-quota-hud] .dsh-hud-percent {
      font-size: 11px;
      font-weight: 700;
      color: var(--q-fg);
      letter-spacing: -0.2px;
      font-variant-numeric: tabular-nums;
    }
    [data-dsh-quota-hud] .dsh-hud-percent.is-empty {
      color: var(--q-error);
    }
    [data-dsh-quota-hud] .dsh-hud-percent-amount {
      font-size: 9.5px;
    }
    [data-dsh-quota-hud] .dsh-hud-percent-liveness {
      font-size: 10px;
    }
    [data-dsh-quota-hud] .dsh-hud-tag {
      font-size: 8.5px;
      font-weight: 600;
      color: var(--q-fg-2);
      margin-top: 1.5px;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }
    [data-dsh-quota-hud] .dsh-hud-popover {
      position: absolute;
      width: var(--q-card-width);
      max-height: min(60vh, 420px);
      overflow-y: auto;
      overscroll-behavior: contain;
      background: var(--q-bg);
      border: 1px solid var(--q-border);
      border-radius: 10px;
      box-shadow: 0 8px 24px var(--q-shadow);
      padding: 9px 10px;
      display: none;
      flex-direction: column;
      gap: 6px;
      pointer-events: none;
      z-index: 1000;
      font-family: inherit;
    }
    [data-dsh-quota-hud].is-hovered .dsh-hud-popover,
    [data-dsh-quota-hud].is-open .dsh-hud-popover {
      display: flex;
      pointer-events: auto;
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-top {
      bottom: calc(100% + 8px);
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-bottom {
      top: calc(100% + 8px);
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-right {
      right: 0;
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-left {
      left: 0;
    }
    [data-dsh-quota-hud].is-narrow .dsh-hud-popover {
      width: min(220px, calc(100vw - 24px));
      max-height: min(320px, calc(100vh - 32px));
    }
    [data-dsh-quota-hud] .dsh-hud-popover-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--q-fg);
      border-bottom: 1px solid var(--q-border);
      padding-bottom: 5px;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-title-text {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-count {
      flex: none;
      font-size: 10px;
      font-weight: 600;
      color: var(--q-fg-2);
      font-variant-numeric: tabular-nums;
    }
    [data-dsh-quota-hud] .dsh-hud-icon-button {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1px solid var(--q-border);
      border-radius: 6px;
      background: transparent;
      color: var(--q-fg-2);
      cursor: pointer;
      pointer-events: auto;
    }
    [data-dsh-quota-hud] .dsh-hud-icon-button:hover {
      color: var(--q-fg);
      background: var(--q-scrim);
    }
    [data-dsh-quota-hud] .dsh-hud-icon-button:focus-visible {
      outline: 2px solid var(--q-fg);
      outline-offset: 1px;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding: 2px 4px;
      margin: 0 -4px;
      border-radius: 6px;
      font-size: 11px;
      color: var(--q-fg-2);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-row.is-active {
      background: var(--q-scrim);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-service {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      color: var(--q-fg);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-metric {
      flex: none;
      padding: 0 5px;
      border: 1px solid var(--q-border);
      border-radius: 999px;
      background: var(--q-scrim);
      color: var(--q-fg-2);
      font-size: 9.5px;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-val {
      flex: none;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-val.is-ok { color: var(--q-success); }
    [data-dsh-quota-hud] .dsh-hud-popover-val.is-warn { color: var(--q-warn); }
    [data-dsh-quota-hud] .dsh-hud-popover-val.is-error { color: var(--q-error); }
    [data-dsh-quota-hud] .dsh-hud-popover-empty {
      font-size: 11px;
      color: var(--q-fg-2);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-action {
      width: 100%;
      padding: 4px 6px;
      border: 1px solid var(--q-border);
      border-radius: 6px;
      background: transparent;
      color: var(--q-fg-2);
      font: inherit;
      font-size: 10.5px;
      cursor: pointer;
      pointer-events: auto;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-action:hover {
      color: var(--q-fg);
      background: var(--q-scrim);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-action:focus-visible {
      outline: 2px solid var(--q-fg);
      outline-offset: 1px;
    }
  `;
  document.head.appendChild(styleEl);
  document.body.appendChild(hudEl);
  let pos = getSavedPosition();
  hudEl.style.left = `${pos.x}px`;
  hudEl.style.top = `${pos.y}px`;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let moved = false;
  let isPointerOver = false;
  let isHoverCardVisible = false;
  let isPinned = false;
  let paused = readPausedState();
  let hoverHideTimer = null;
  const motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let prefersReducedMotion = motionQuery?.matches === true;
  let lastInteractionWasTouch = false;
  function bindDragEndListeners() {
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("touchend", onPointerUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("touchcancel", onPointerUp);
    window.addEventListener("blur", onPointerUp);
  }
  function unbindDragEndListeners() {
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);
    window.removeEventListener("touchmove", onPointerMove);
    window.removeEventListener("touchend", onPointerUp);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("touchcancel", onPointerUp);
    window.removeEventListener("blur", onPointerUp);
  }
  function isHudButtonTarget(target) {
    const el = target;
    if (!el || typeof el.closest !== "function") return false;
    return el.closest(".dsh-hud-popover") !== null;
  }
  function onPointerDown(e) {
    if (isHudButtonTarget(e.target)) return;
    isDragging = true;
    moved = false;
    lastInteractionWasTouch = "touches" in e;
    hudEl.style.cursor = "grabbing";
    hudEl.style.transition = "none";
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    initialLeft = hudEl.offsetLeft;
    initialTop = hudEl.offsetTop;
    bindDragEndListeners();
  }
  function onPointerMove(e) {
    if (!isDragging) return;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const dx = clientX - startX;
    const dy = clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      moved = true;
      if ("touches" in e && e.cancelable) e.preventDefault();
    }
    const newX = Math.max(8, Math.min(window.innerWidth - 54, initialLeft + dx));
    const newY = Math.max(8, Math.min(window.innerHeight - 54, initialTop + dy));
    hudEl.style.left = `${newX}px`;
    hudEl.style.top = `${newY}px`;
  }
  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    hudEl.style.cursor = "grab";
    hudEl.style.transition = "transform 0.16s ease, left 0.2s ease, top 0.2s ease";
    unbindDragEndListeners();
    if (!moved) {
      if (lastInteractionWasTouch) setPinned(!isPinned);
      else controller.toggle();
      return;
    }
    const currentLeft = hudEl.offsetLeft;
    const currentTop = hudEl.offsetTop;
    const snapLeft = currentLeft < window.innerWidth / 2 ? 14 : window.innerWidth - 60;
    const clampedTop = Math.max(14, Math.min(window.innerHeight - 60, currentTop));
    pos = { x: snapLeft, y: clampedTop };
    hudEl.style.left = `${pos.x}px`;
    hudEl.style.top = `${pos.y}px`;
    savePosition(pos);
    render();
  }
  hudEl.addEventListener("mousedown", onPointerDown);
  hudEl.addEventListener("touchstart", onPointerDown, { passive: false });
  function cancelHoverHide() {
    if (hoverHideTimer !== null) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
  }
  function showHoverCard() {
    cancelHoverHide();
    if (isHoverCardVisible) return;
    isHoverCardVisible = true;
    hudEl.classList.add("is-hovered");
  }
  function hideHoverCardSoon() {
    if (isPinned) return;
    cancelHoverHide();
    hoverHideTimer = setTimeout(() => {
      hoverHideTimer = null;
      if (isPointerOver || isPinned) return;
      isHoverCardVisible = false;
      hudEl.classList.remove("is-hovered");
    }, HOVER_HIDE_DELAY_MS);
  }
  hudEl.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    isPointerOver = true;
    showHoverCard();
  });
  hudEl.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    isPointerOver = false;
    hideHoverCardSoon();
  });
  function setPinned(value, options = {}) {
    if (isPinned === value) return;
    isPinned = value;
    hudEl.classList.toggle("is-open", isPinned);
    hudEl.setAttribute("aria-expanded", isPinned ? "true" : "false");
    render();
    if (isPinned) {
      cancelHoverHide();
      hudEl.classList.add("is-hovered");
    } else if (!isPointerOver) {
      cancelHoverHide();
      isHoverCardVisible = false;
      hudEl.classList.remove("is-hovered");
      if (options.focusHud) hudEl.focus({ preventScroll: true });
    } else if (options.focusHud) {
      hudEl.focus({ preventScroll: true });
    }
  }
  function togglePaused() {
    paused = !paused;
    savePausedState(paused);
    render();
  }
  function onHudClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest(".dsh-hud-pause")) {
      event.preventDefault();
      event.stopPropagation();
      togglePaused();
      return;
    }
    if (target.closest(".dsh-hud-open-panel")) {
      event.preventDefault();
      event.stopPropagation();
      setPinned(false);
      controller.toggle();
    }
  }
  function onHudKeyDown(event) {
    if (event.key === "Escape") {
      if (!isPinned) return;
      event.preventDefault();
      setPinned(false, { focusHud: true });
      return;
    }
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    if (event.target !== hudEl) return;
    event.preventDefault();
    setPinned(!isPinned);
  }
  hudEl.addEventListener("click", onHudClick);
  hudEl.addEventListener("keydown", onHudKeyDown);
  function clampHudPosition() {
    const maxX = Math.max(8, window.innerWidth - 54);
    const maxY = Math.max(8, window.innerHeight - 54);
    const currentLeft = Number.parseFloat(hudEl.style.left);
    const currentTop = Number.parseFloat(hudEl.style.top);
    const sourceX = Number.isFinite(currentLeft) ? currentLeft : pos.x;
    const sourceY = Number.isFinite(currentTop) ? currentTop : pos.y;
    const x = Math.min(Math.max(8, sourceX), maxX);
    const y = Math.min(Math.max(8, sourceY), maxY);
    if (x !== pos.x || y !== pos.y) {
      pos = { x, y };
      savePosition(pos);
    }
    hudEl.style.left = `${pos.x}px`;
    hudEl.style.top = `${pos.y}px`;
  }
  const onWindowResize = () => {
    clampHudPosition();
    if (typeof document !== "undefined" && document.hidden) return;
    render();
  };
  window.addEventListener("resize", onWindowResize);
  const onMotionPreferenceChange = (event) => {
    prefersReducedMotion = event.matches;
    render();
  };
  if (motionQuery && typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", onMotionPreferenceChange);
  }
  function getProviderTag(provider) {
    const map = {
      deepseek: "DSK",
      antigravity: "AGY",
      cursor: "CUR",
      codex: "CDX",
      github_copilot: "COP",
      openai_billing: "OAI",
      claude: "CLD",
      kimi: "KMI",
      glm: "GLM",
      minimax: "MMX",
      qwen: "QWN",
      volcengine: "ARK",
      opencode_go: "OPN",
      custom_api: "API"
    };
    return map[provider] || provider.slice(0, 3).toUpperCase();
  }
  function isMetricSelected(cardProvider, cardId, groupTitle, windowId, selectedMetrics) {
    if (!Array.isArray(selectedMetrics)) return true;
    const hasCustomSelection = selectedMetrics.some((k) => typeof k === "string" && (k.startsWith(`${cardProvider}::`) || k.startsWith(`${cardId}::`)));
    if (!hasCustomSelection) return true;
    if (selectedMetrics.includes(`${cardProvider}::__none__`) || selectedMetrics.includes(`${cardId}::__none__`)) return false;
    const exactKey = makeHudMetricKey(cardProvider, groupTitle, windowId);
    if (selectedMetrics.includes(exactKey)) return true;
    if (cardProvider === "antigravity") {
      const isWeekly = windowId.toLowerCase().includes("weekly");
      const isGemini = groupTitle.toLowerCase().includes("gemini") || windowId.toLowerCase().includes("gemini");
      const isClaude = groupTitle.toLowerCase().includes("claude") || groupTitle.toLowerCase().includes("gpt") || windowId.toLowerCase().includes("claude");
      for (const sel of selectedMetrics) {
        if (typeof sel !== "string" || !sel.startsWith("antigravity::")) continue;
        if (sel.includes("__none__")) return false;
        const lower = decodeURIComponent(sel).toLowerCase();
        const selWeekly = lower.includes("weekly") || lower.includes("周");
        const sel5h = lower.includes("5h") || lower.includes("5-hour") || lower.includes("five") || lower.includes("5小时");
        const selGemini = lower.includes("gemini");
        const selClaude = lower.includes("claude") || lower.includes("gpt");
        if (isGemini && selGemini && (isWeekly && selWeekly || !isWeekly && sel5h)) return true;
        if (isClaude && selClaude && (isWeekly && selWeekly || !isWeekly && sel5h)) return true;
        if (isWeekly && selWeekly || !isWeekly && sel5h) return true;
      }
    }
    if (groupTitle === "Balance" || windowId === cardId || windowId.endsWith("-balance")) {
      for (const sel of selectedMetrics) {
        if (typeof sel === "string" && (sel.startsWith(`${cardProvider}::`) || sel.startsWith(`${cardId}::`))) {
          const lower = decodeURIComponent(sel).toLowerCase();
          if (lower.includes("balance") || lower.includes("余额") || lower.includes("额度")) return true;
        }
      }
    }
    return false;
  }
  function formatBalanceAmount(card) {
    const balance = card.balance;
    if (!balance || typeof balance.remaining !== "number" || !Number.isFinite(balance.remaining)) return void 0;
    const currency = balance.currency;
    const symbol = currency === "USD" ? "$" : currency === "TOKEN" || currency === "COUNT" ? "" : "¥";
    const digits = currency === "TOKEN" || currency === "COUNT" ? 0 : 2;
    return `${symbol}${balance.remaining.toFixed(digits)}`;
  }
  function getMetricsList(cards, config) {
    const list = [];
    const hudProviders = config?.floatingHudProviders;
    const selectedMetrics = config?.floatingHudMetrics;
    const toMetric = (card, tag, groupTitle, window2) => {
      const kind = windowQuotaKind(window2);
      const quantified = isQuantified(window2);
      const amountText = typeof window2.amountText === "string" ? window2.amountText.trim() : "";
      return {
        key: makeHudMetricKey(card.provider, groupTitle, window2.id),
        provider: card.provider,
        name: `${card.name} · ${groupTitle} · ${window2.label}`,
        service: card.name,
        shortLabel: inferMetricShortLabel(window2),
        tag,
        kind,
        remainingPercent: quantified ? Math.max(0, Math.min(100, Math.round(window2.remainingPercent))) : void 0,
        amountText: kind === "balance" ? amountText !== "" ? amountText : formatBalanceAmount(card) : void 0
      };
    };
    for (const card of cards) {
      if (card.status !== "ok" && card.status !== "warn") continue;
      if (Array.isArray(hudProviders)) {
        if (!hudProviders.includes(card.id) && !hudProviders.includes(card.provider)) {
          continue;
        }
      }
      const tag = getProviderTag(card.provider);
      if (card.groups.length === 0) {
        if (card.balance === void 0) continue;
        const key = makeHudMetricKey(card.provider, "Balance", card.id);
        if (!isMetricSelected(card.provider, card.id, "Balance", card.id, selectedMetrics)) {
          continue;
        }
        list.push({
          key,
          provider: card.provider,
          name: `${card.name} · 账户余额`,
          service: card.name,
          shortLabel: "余额",
          tag,
          kind: "balance",
          amountText: formatBalanceAmount(card)
        });
        continue;
      }
      const cardStartIndex = list.length;
      for (const group of card.groups) {
        for (const window2 of group.windows) {
          if (!isMetricSelected(card.provider, card.id, group.title, window2.id, selectedMetrics)) {
            continue;
          }
          list.push(toMetric(card, tag, group.title, window2));
        }
      }
      const hasExplicitNone = Array.isArray(selectedMetrics) && selectedMetrics.some((k) => k === `${card.provider}::__none__` || k === `${card.id}::__none__`);
      if (list.length === cardStartIndex && !hasExplicitNone && card.groups.length > 0) {
        for (const group of card.groups) {
          for (const window2 of group.windows) {
            list.push(toMetric(card, tag, group.title, window2));
          }
        }
      }
    }
    return list;
  }
  let activeIndex = 0;
  let intervalTimer = null;
  function captureFocusTarget() {
    if (typeof document === "undefined") return null;
    const active = document.activeElement;
    if (!active) return null;
    if (active === hudEl) return "host";
    if (typeof active.closest === "function") {
      if (active.closest(".dsh-hud-pause")) return "pause";
      if (active.closest(".dsh-hud-open-panel")) return "panel";
    }
    return null;
  }
  function restoreFocusTarget(target) {
    if (target === null) return;
    if (target === "host") {
      hudEl.focus({ preventScroll: true });
      return;
    }
    const selector = target === "pause" ? ".dsh-hud-pause" : ".dsh-hud-open-panel";
    const el = hudEl.querySelector(selector);
    el?.focus({ preventScroll: true });
  }
  function setHudAriaLabel(label) {
    hudEl.setAttribute("aria-label", label);
  }
  function pauseButtonHtml() {
    const label = paused ? "继续轮播" : "暂停轮播";
    const icon = paused ? PLAY_ICON : PAUSE_ICON;
    return `<button type="button" class="dsh-hud-icon-button dsh-hud-pause" aria-label="${label}" aria-pressed="${paused ? "true" : "false"}" title="${label}">${icon}</button>`;
  }
  function render() {
    const state = controller.getSnapshot();
    const isEnabled = state.config?.showFloatingHud !== false;
    if (!isEnabled) {
      hudEl.style.display = "none";
      return;
    }
    hudEl.style.display = "flex";
    const metrics = getMetricsList(state.cards, state.config);
    const focusTarget = captureFocusTarget();
    hudEl.classList.toggle("is-narrow", window.innerWidth < NARROW_BREAKPOINT);
    const placement = computePopoverPlacement(pos, window.innerWidth);
    const popoverClass = `dsh-hud-popover ${placement.vertical} ${placement.horizontal}`;
    if (metrics.length === 0) {
      const hasMetricSelection = Array.isArray(state.config?.floatingHudMetrics);
      const emptyTitle = hasMetricSelection ? "未选择额度" : "未连接服务";
      const emptyHint = hasMetricSelection ? "请在设置中选择要显示的额度窗口" : "点击打开面板完成服务连接";
      setHudAriaLabel(`额度监控：${emptyTitle}。按 Enter 展开提示`);
      hudEl.innerHTML = `
        <div class="dsh-hud-circle">
          ${neutralRingSvg()}
          <div class="dsh-hud-content">
            <span class="dsh-hud-percent">--</span>
            <span class="dsh-hud-tag">AI</span>
          </div>
        </div>
        <div class="${popoverClass}" role="group" aria-label="额度状态">
          <div class="dsh-hud-popover-title">
            <span class="dsh-hud-popover-title-text">AI 额度监控</span>
            <span class="dsh-hud-popover-count">${emptyTitle}</span>
          </div>
          <div class="dsh-hud-popover-empty">${emptyHint}</div>
          <button type="button" class="dsh-hud-popover-action dsh-hud-open-panel" aria-label="打开额度面板">打开面板</button>
        </div>
      `;
      restoreFocusTarget(focusTarget);
      return;
    }
    if (activeIndex >= metrics.length) activeIndex = 0;
    const current = metrics[activeIndex];
    const quantified = isQuantifiedMetric(current);
    const percent = quantified ? Math.round(current.remainingPercent) : void 0;
    const exhausted = percent !== void 0 && percent <= 0;
    const tone = percent !== void 0 ? statusTone(percent) : void 0;
    const ariaText = metricAriaText(current);
    setHudAriaLabel(
      isPinned ? `额度监控：${ariaText}。已展开明细，按 Esc 收起` : `额度监控：${ariaText}。按 Enter 展开明细`
    );
    const popoverRows = metrics.map((m, index) => {
      const quantifiedRow = isQuantifiedMetric(m);
      const rowTone = quantifiedRow ? statusTone(m.remainingPercent) : "";
      const valueClass = rowTone === "" ? "dsh-hud-popover-val" : `dsh-hud-popover-val is-${rowTone}`;
      const activeClass = index === activeIndex ? " is-active" : "";
      return `
        <div class="dsh-hud-popover-row${activeClass}" title="${m.name}">
          <span class="dsh-hud-popover-service" title="${m.name}">${m.service}</span>
          <span class="dsh-hud-popover-metric">${m.shortLabel}</span>
          <span class="${valueClass}">${metricValueText(m)}</span>
        </div>
      `;
    }).join("");
    let ringHtml = "";
    let centerHtml = "";
    if (quantified) {
      const radius = 18;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - percent / 100 * circumference;
      ringHtml = `
        <svg class="dsh-hud-svg" viewBox="0 0 46 46" aria-hidden="true" focusable="false">
          <circle class="dsh-hud-ring-track" cx="23" cy="23" r="${radius}"></circle>
          <circle class="dsh-hud-ring-value is-${tone}" cx="23" cy="23" r="${radius}"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
        </svg>
      `;
      centerHtml = `<span class="dsh-hud-percent${exhausted ? " is-empty" : ""}">${percent}%</span>`;
    } else if (current.kind === "balance") {
      ringHtml = neutralRingSvg();
      centerHtml = `<span class="dsh-hud-percent dsh-hud-percent-amount">${current.amountText || "—"}</span>`;
    } else if (current.kind === "liveness") {
      centerHtml = `<span class="dsh-hud-percent dsh-hud-percent-liveness">✓</span>`;
    } else {
      centerHtml = `<span class="dsh-hud-percent">--</span>`;
    }
    hudEl.innerHTML = `
      <div class="dsh-hud-circle${exhausted ? " is-exhausted" : ""}">
        ${ringHtml}
        <div class="dsh-hud-content">
          ${centerHtml}
          <span class="dsh-hud-tag">${current.tag}</span>
        </div>
      </div>
      <div class="${popoverClass}" role="group" aria-label="额度明细">
        <div class="dsh-hud-popover-title">
          <span class="dsh-hud-popover-title-text">AI 额度监控</span>
          <span class="dsh-hud-popover-count">${activeIndex + 1}/${metrics.length}</span>
          ${pauseButtonHtml()}
        </div>
        ${popoverRows}
        <button type="button" class="dsh-hud-popover-action dsh-hud-open-panel" aria-label="打开额度面板">打开面板</button>
      </div>
    `;
    restoreFocusTarget(focusTarget);
  }
  function shouldAdvanceCarousel() {
    if (typeof document !== "undefined" && document.hidden) return false;
    if (prefersReducedMotion) return false;
    if (paused || isPinned || isHoverCardVisible || isDragging) return false;
    if (typeof document !== "undefined" && document.activeElement === hudEl) return false;
    return true;
  }
  intervalTimer = setInterval(() => {
    if (!shouldAdvanceCarousel()) return;
    const state = controller.getSnapshot();
    const metrics = getMetricsList(state.cards, state.config);
    if (metrics.length > 1) {
      activeIndex = (activeIndex + 1) % metrics.length;
      render();
    }
  }, CAROUSEL_INTERVAL_MS);
  const unsubscribe = controller.subscribe(render);
  render();
  return () => {
    if (intervalTimer !== null) clearInterval(intervalTimer);
    cancelHoverHide();
    unbindDragEndListeners();
    window.removeEventListener("resize", onWindowResize);
    if (motionQuery && typeof motionQuery.removeEventListener === "function") {
      motionQuery.removeEventListener("change", onMotionPreferenceChange);
    }
    unsubscribe();
    hudEl.remove();
    styleEl.remove();
  };
}

// src/client/services.ts
function serviceOf(ctx, name) {
  if (ctx === null || ctx === void 0) return void 0;
  try {
    if (typeof ctx.get === "function") {
      const value = ctx.get(name);
      if (value !== void 0 && value !== null) return value;
    }
  } catch {
  }
  try {
    return ctx[name];
  } catch {
    return void 0;
  }
}

// src/client/locale.ts
var LOCALE_NS = "dsh-quota";
var DICT = {
  zh: {
    entry: "额度监控",
    panel: "额度监控",
    "footer.open": "额度监控",
    "badge.alarms": "有额度告警",
    "badge.alarmsCount": "有 {count} 条额度告警"
  },
  en: {
    entry: "Quota Monitor",
    panel: "Quota Monitor",
    "footer.open": "Quota Monitor",
    "badge.alarms": "Quota alerts",
    "badge.alarmsCount": "{count} quota alerts"
  }
};
var fallback = (key, params) => {
  const template = DICT.en[key] ?? String(key);
  if (params === void 0) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === void 0 ? match : String(value);
  });
};
function registerQuotaLocale(ctx) {
  const locale = serviceOf(ctx, "locale");
  if (locale === void 0) return fallback;
  try {
    locale.register?.(LOCALE_NS, DICT);
  } catch (error) {
    console.warn("[dsh-quota] locale registration failed:", error?.message ?? error);
    return fallback;
  }
  if (typeof locale.bind !== "function") return fallback;
  let bound;
  try {
    bound = locale.bind(LOCALE_NS);
  } catch {
    return fallback;
  }
  if (typeof bound !== "function") return fallback;
  return (key, params) => {
    try {
      return bound(key, params);
    } catch {
      return fallback(key, params);
    }
  };
}

// src/client/slots.ts
var PANEL_ID = "quota";
function ensureSlotStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("dsh-quota-slot-style") !== null) return;
  const style = document.createElement("style");
  style.id = "dsh-quota-slot-style";
  style.textContent = `
    .dsh-quota-slot-root { position: relative; height: 100%; min-height: 0; overflow: hidden; }
    .dsh-quota-slot-panel { height: 100%; }
    .dsh-quota-slot-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
      background: var(--dsw-alias-state-error-primary, #B04A46); color: #fff;
      font-size: 10px; font-weight: 600; line-height: 1;
    }
    .dsh-quota-footer-action {
      display: flex; align-items: center; gap: 8px; width: 100%;
      min-height: 32px; padding: 6px 8px; margin: 0;
      background: transparent; border: none; border-radius: 8px;
      color: var(--dsw-alias-label-primary, #1f2328); cursor: pointer;
      font: inherit; font-size: 13px; text-align: left;
    }
    .dsh-quota-footer-action:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); }
    .dsh-quota-footer-action[data-wide='false'] { justify-content: center; padding: 6px; }
    .dsh-quota-footer-action .dsh-quota-footer-label { white-space: nowrap; }
    .dsh-quota-footer-action[data-wide='false'] .dsh-quota-footer-label { display: none; }
  `;
  document.head.appendChild(style);
}
function gaugeIcon(react, size, active) {
  return react.createElement(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: size,
      height: size,
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": "true",
      style: { opacity: active ? 1 : 0.86 }
    },
    react.createElement("path", {
      d: "M3.49 13.26A6.375 6.375 0 1 1 12.51 13.26",
      stroke: "currentColor",
      strokeWidth: 1.25,
      strokeLinecap: "round"
    }),
    react.createElement("path", {
      d: "M8 8.75L11.4 5.35",
      stroke: "currentColor",
      strokeWidth: 1.25,
      strokeLinecap: "round"
    }),
    react.createElement("circle", { cx: 8, cy: 8.75, r: 1.55, fill: "currentColor" })
  );
}
function registerQuotaSlots(ctx, wiring) {
  const slots = serviceOf(ctx, "slots");
  if (!slots || typeof slots.register !== "function") return void 0;
  const { react, controller, t } = wiring;
  if (!react || typeof react.createElement !== "function") return void 0;
  ensureSlotStyles();
  const disposers = [];
  let registered = 0;
  const track = (result) => {
    if (typeof result === "function") disposers.push(result);
  };
  const register = (name, spec, component) => {
    const doRegister = () => {
      try {
        const result = slots.register({ name, locale: LOCALE_NS, ...spec }, component);
        registered += 1;
        return result;
      } catch (error) {
        console.warn(`[dsh-quota] slot "${name}" registration failed:`, error?.message ?? error);
        return void 0;
      }
    };
    try {
      if (typeof slots.inject === "function") {
        track(slots.inject(name, doRegister));
        return;
      }
      track(doRegister());
    } catch (error) {
      console.warn(`[dsh-quota] slot "${name}" injection failed:`, error?.message ?? error);
    }
  };
  const QuotaBadge = () => {
    const [count, setCount] = react.useState(() => {
      try {
        return controller.getSnapshot().alarms.length;
      } catch {
        return 0;
      }
    });
    react.useEffect(() => {
      let unsubscribe;
      try {
        unsubscribe = controller.subscribe(() => {
          const snapshot = controller.getSnapshot();
          setCount(Array.isArray(snapshot?.alarms) ? snapshot.alarms.length : 0);
        });
      } catch {
      }
      return () => {
        try {
          unsubscribe?.();
        } catch {
        }
      };
    }, []);
    if (count <= 0) return null;
    return react.createElement(
      "span",
      { className: "dsh-quota-slot-badge", "aria-label": t("badge.alarmsCount", { count }) },
      count > 9 ? "9+" : String(count)
    );
  };
  const QuotaFooterAction = (props) => {
    const wide = props?.wide !== false;
    return react.createElement(
      "button",
      {
        type: "button",
        className: "dsh-quota-footer-action",
        "data-wide": wide ? "true" : "false",
        title: t("footer.open"),
        "aria-label": t("footer.open"),
        onClick: () => {
          try {
            const open = controller.getSnapshot().panelOpen;
            if (open) controller.close();
            else controller.open();
          } catch (error) {
            console.warn("[dsh-quota] panel toggle failed:", error?.message ?? error);
          }
        }
      },
      gaugeIcon(react, 16, false),
      react.createElement("span", { className: "dsh-quota-footer-label" }, t("footer.open"))
    );
  };
  register("sidebar.toggle.badge", {}, QuotaBadge);
  register("sidebar.footer.action", { id: "dsh-quota-footer", order: 20 }, QuotaFooterAction);
  void registered;
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
      }
    }
  };
}

// src/client/index.ts
var VERSION = PLUGIN_VERSION;
var inject = ["slots", "locale"];
var applied = false;
function loadReact() {
  try {
    if (typeof require === "function") return require("react");
  } catch (error) {
    console.warn("[dsh-quota] react unavailable:", error?.message ?? error);
  }
  return void 0;
}
function startController(controller) {
  void controller.init().catch((error) => {
    console.warn("[dsh-quota] initial load failed:", error?.message ?? error);
  });
}
function guardedMount(label, mount) {
  try {
    return mount();
  } catch (error) {
    console.error(`[dsh-quota] ${label} failed:`, error);
    return void 0;
  }
}
function applyWithSlots(ctx, react) {
  const api = new QuotaClientApi();
  const controller = new QuotaController(api);
  const t = registerQuotaLocale(ctx);
  const disposeSlots = registerQuotaSlots(ctx, { react, controller, t });
  const disposePanel = guardedMount("panel mount", () => mountPanel(controller));
  const disposeHud = guardedMount("HUD mount", () => mountQuotaHud(controller));
  const disposeLegacyEntry = disposeSlots === void 0 ? guardedMount("legacy sidebar entry", () => mountQuotaSidebarEntry(controller)) : void 0;
  startController(controller);
  const disposeAll = () => {
    try {
      disposeSlots?.();
      disposeLegacyEntry?.();
    } catch {
    }
    disposePanel?.();
    disposeHud?.();
    controller.destroy();
    applied = false;
  };
  if (ctx && typeof ctx.effect === "function") {
    try {
      ctx.effect(() => disposeAll, "quota: client cleanup");
    } catch (error) {
      console.warn("[dsh-quota] effect registration failed:", error?.message ?? error);
    }
  }
}
function applyLegacy(ctx, api, controller) {
  applied = true;
  const disposeEntry = mountQuotaSidebarEntry(controller);
  const disposePanel = mountPanel(controller);
  const disposeHud = mountQuotaHud(controller);
  startController(controller);
  const disposeAll = () => {
    disposeEntry();
    disposePanel();
    disposeHud();
    controller.destroy();
    applied = false;
  };
  if (ctx && typeof ctx.effect === "function") {
    try {
      ctx.effect(() => disposeAll, "quota: client cleanup");
    } catch (error) {
      console.warn("[dsh-quota] effect registration failed:", error?.message ?? error);
    }
  }
}
function apply(ctx) {
  if (applied) return;
  applied = true;
  try {
    const react = loadReact();
    if (serviceOf(ctx, "slots") !== void 0 && react !== void 0) {
      try {
        applyWithSlots(ctx, react);
        return;
      } catch (error) {
        console.error("[dsh-quota] slot mount failed, falling back to DOM mount:", error);
        applied = false;
      }
    }
    const api = new QuotaClientApi();
    applyLegacy(ctx, api, new QuotaController(api));
  } catch (error) {
    applied = false;
    console.error("[dsh-quota] client mount failed:", error);
  }
}

return module.exports;
};
if (typeof window !== 'undefined' && window.__ModuleLoader__) {
  try {
    window.__ModuleLoader__.load({ id: "@francescoli/dsh-quota", factory: factory });
  } catch (error) {
    // A duplicate registration means this bundle already ran. Re-throwing would abort
    // the page's plugin sync with "loaded without registering", which is worse than
    // keeping the factory that is already registered.
    if (!/duplicate factory registration/.test(String(error && error.message))) throw error;
  }
}
})();

//# sourceMappingURL=client.js.map
