window.__ModuleLoader__.load({
  id: "dsh-quota",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });


/**
 * Shared sidebar entry injection core.
 */
                               
                      
                     
                 
              
                             
                 
                    
                  
                              
                                    
            
                                               
                     
   
 

function sidebarRoot()                          {
  const column = document.querySelector             ('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector             ('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild                           )
}

function newSessionButton(root             )                                {
  const nested = root.querySelector                   ('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child                     
  }
  return undefined
}

function createEntry(options                     )                    {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute(options.rowAttribute, '')
  if (options.plugin !== undefined) {
    entry.setAttribute('data-dsh-plugin', options.plugin)
    entry.setAttribute('data-dsh-part', 'sidebar-entry')
  }
  entry.className = options.css['entry'] ?? ''
  entry.setAttribute('aria-label', options.label())
  if (options.tooltip !== undefined) entry.setAttribute('title', options.tooltip())
  entry.innerHTML = '<span class="' + (options.css['entryIcon'] ?? '') + '">' + options.icon
    + '</span><span class="' + (options.css['entryLabel'] ?? '') + '">' + options.label() + '</span>'
  entry.addEventListener('click', options.onToggle)
  return entry
}

function placeEntry(root             , entry                   , options                     )          {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el)                    => el instanceof HTMLElement && el.matches(options.familySelectors.join(', ')),
    )
    const anchor = options.position === 'before'
      ? (family.length > 0 ? family[0] : base.nextElementSibling)
      : (family.length > 0 ? family[family.length - 1] .nextElementSibling : base.nextElementSibling)
    root.insertBefore(entry, anchor)
  }
  return true
}

function mountSidebarEntry(options                     )             {
  if (typeof document !== 'undefined' && document.querySelector(options.rowSelector) !== null) {
    return () => {}
  }
  const entry = createEntry(options)
  let root                         
  let placed = false

  const tryPlace = ()       => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry, options)
    if (placed) {
      rootObserver.observe(root, { childList: true, subtree: true })
    }
  }

  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry, options)
    }
  })

  const unsubscribeActive = options.active === undefined ? undefined : (() => {
    const syncActive = ()       => {
      if (options.active .isOpen()) entry.dataset.active = 'true'
      else delete entry.dataset.active
    }
    const unsubscribe = options.active.subscribe(syncActive)
    syncActive()
    return unsubscribe
  })()

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribeActive?.()
    entry.remove()
  }
}



const ENTRY_SELECTOR = '[data-dsh-quota-entry]'

// 18x18 SVG meter glyph aligned to the shell's 16x16 grid and stroke
const ICON = '<svg viewBox=\"0 0 16 16\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.35\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"6.25\"/><path d=\"M8 8l2.5-2.5\"/><path d=\"M4.5 10.5a4.75 4.75 0 0 1 0-5\"/></svg>'

function ensureSidebarStyles()       {
  if (document.getElementById('dsh-quota-sidebar-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-quota-sidebar-style'
  style.textContent = `
    .dsh-quota-entry {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 36px;
      padding: 0 10px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
      font-family: inherit;
      text-align: left;
      transition: background-color 120ms ease, color 120ms ease;
      position: relative;
    }
    .dsh-quota-entry:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .dsh-quota-entry[data-active] {
      background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.1));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-weight: 600;
    }
    .dsh-quota-entry-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex: none;
      position: relative;
    }
    .dsh-quota-entry-icon svg {
      display: block;
      width: 18px;
      height: 18px;
    }
    .dsh-quota-entry[data-alarm='true'] .dsh-quota-entry-icon::after {
      content: '';
      position: absolute;
      top: 1px;
      right: 1px;
      width: 6.5px;
      height: 6.5px;
      border-radius: 50%;
      background: #B04A46;
      border: 1.5px solid var(--dsw-alias-bg-base, #ffffff);
      box-shadow: 0 0 6px rgba(176, 74, 70, 0.6);
      animation: dshQuotaPulse 2.5s infinite ease-in-out;
    }
    @keyframes dshQuotaPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0.75; }
    }
    .dsh-quota-entry-label {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry {
      justify-content: center;
      padding: 0;
      width: 36px;
      height: 36px;
      margin: 0 auto 12px;
      border-radius: 50%;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-label {
      display: none;
    }
  `
  document.head.appendChild(style)
}

function mountQuotaSidebarEntry(controller                 )             {
  ensureSidebarStyles()

  return mountSidebarEntry({
    rowAttribute: 'data-dsh-quota-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'quota',
    icon: ICON,
    css: {
      entry: 'dsh-quota-entry',
      entryIcon: 'dsh-quota-entry-icon',
      entryLabel: 'dsh-quota-entry-label',
    },
    label: () => '额度监控',
    tooltip: () => '查看各 AI 模型与编程助手剩余额度与用量',
    onToggle: () => controller.toggle(),
    position: 'after',
    familySelectors: ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-skill-entry]', '[data-dsh-quota-entry]'],
    active: {
      subscribe: (listener) => {
        return controller.subscribe(() => {
          const entryEl = document.querySelector(ENTRY_SELECTOR)                      
          if (entryEl) {
            entryEl.dataset.alarm = controller.hasAlarms() ? 'true' : 'false'
          }
          listener()
        })
      },
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}

                                                                                

                        
            
               
                   
                     
                          
                  
                             
 

function makeHudMetricKey(provider        , groupTitle        , windowId        )         {
  return `${provider}::${encodeURIComponent(groupTitle)}::${encodeURIComponent(windowId)}`
}

                       
               
                       
                         
 

                            
                                             
                
               
                    
                         
                          
                     
 

                               
           
           
 

                        
            
              
                  
                            
                                              
               
                  
                
                       
                            
                          
                             
                                   
                     
 

                      
                    
                  
              
                            
                 
                   
 

                                
             
                  
                    
                  
                 
           
 

                             
                   
                    
                          
                     
                           
 

                             
            
                  
               
                   
                 
                  
                       
                           
             
                             
 

                                    
            
              
                 
                
                      
                   
 

                       
                    
                             
                          
                           
                               
                                 
                                 
                                
                              
                                
                                                
                                                                     
                                                                                  
                                                                       
                                                                             
                                                                        
                                                                                   
                                                                           
                                                 
                                               
                                              
                                                  
                                               
                                                     
 

function getRefreshIntervalSeconds(config              )         {
  if (typeof config?.refreshIntervalSeconds === 'number' && config.refreshIntervalSeconds > 0) {
    return Math.max(5, config.refreshIntervalSeconds)
  }
  if (typeof config?.refreshIntervalMinutes === 'number' && config.refreshIntervalMinutes > 0) {
    return Math.max(5, Math.round(config.refreshIntervalMinutes * 60))
  }
  return 60
}

class QuotaClientApi {
  async getCards(force = false)           
                         
                             
                         
                       
     {
    const res = await fetch(`/api/dsh-quota/status?force=${force}`)
    if (!res.ok) throw new Error(`获取额度失败 (${res.status})`)
    return res.json()
  }

  async refreshSingle(providerOrId        )                        {
    const res = await fetch(`/api/dsh-quota/status?provider=${encodeURIComponent(providerOrId)}&force=true`)
    if (!res.ok) throw new Error(`刷新服务失败 (${res.status})`)
    const data = await res.json()
    if (data.card) return data.card
    if (data.cards && Array.isArray(data.cards)) {
      const found = data.cards.find((c     ) => c.id === providerOrId || c.provider === providerOrId)
      if (found) return found
    }
    return data
  }

  async testConnection(provider        , accountConfig                    )                                {
    const res = await fetch('/api/dsh-quota/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, accountConfig }),
    })
    if (!res.ok) throw new Error(`测活请求失败 (${res.status})`)
    return res.json()
  }

  async testAllConnections()                                                {
    const res = await fetch('/api/dsh-quota/test-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`一键测活失败 (${res.status})`)
    const data = await res.json()
    return data.results || {}
  }

  async getHistory(instanceId        , days = 7)                               {
    const res = await fetch(`/api/dsh-quota/history?instanceId=${encodeURIComponent(instanceId)}&days=${days}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.points || []
  }

  async getConfig()                       {
    const res = await fetch('/api/dsh-quota/config')
    if (!res.ok) throw new Error(`获取配置失败 (${res.status})`)
    return res.json()
  }

  async saveConfig(cfg             )                {
    const res = await fetch('/api/dsh-quota/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    if (!res.ok) throw new Error(`保存配置失败 (${res.status})`)
  }

  async startCodexLogin()                  {
    const res = await fetch('/api/dsh-quota/auth/codex/start')
    if (!res.ok) throw new Error(`启动 Codex 登录失败 (${res.status})`)
    const data = await res.json()
    return data.authUrl
  }

  async startAntigravityLogin()                  {
    const res = await fetch('/api/dsh-quota/auth/antigravity/start')
    if (!res.ok) throw new Error(`启动 Antigravity 登录失败 (${res.status})`)
    const data = await res.json()
    return data.authUrl
  }

  async connectCursor()                                    {
    const res = await fetch('/api/dsh-quota/auth/cursor/connect', { method: 'POST' })
    if (!res.ok) throw new Error(`连接 Cursor 失败 (${res.status})`)
    const data = await res.json()
    return data.card
  }
}



                          

const DEFAULT_PROVIDER_ORDER = [
  'deepseek',
  'antigravity',
  'cursor',
  'codex',
  'github_copilot',
  'openai_billing',
  'claude',
  'kimi',
  'glm',
  'minimax',
  'qwen',
  'volcengine',
  'opencode_go',
  'custom_api',
]

                         
                    
                  
                     
                
                       
                          
                      
                                                   
                                  
                     
                                    
                                          
                              
                      
 

class QuotaController {
          api                
          panelOpen = false
          loading = false
          testingAll = false
          error         
          cards                 = []
          allCards                 = []
          alarms               = []
          testResults                                       = {}
          refreshingProviders = new Set        ()
          lastUpdated = 0
          activeTab                          = 'overview'
          activeCategory                           = 'all'
          collapsedGroups = new Set        ()
          config              
          listeners = new Set          ()
          pollingTimer      = null
          notifiedAlarmIds = new Set        ()
          onVisibilityChangeHandler             
          onWindowFocusHandler             

  constructor(api                ) {
    this.api = api
  }

  async init()                {
    await this.loadConfig()
    await this.refresh(false)
    this.startPolling()
    this.setupWindowListeners()
  }

  getRefreshIntervalSec()         {
    return getRefreshIntervalSeconds(this.config)
  }

  startPolling()       {
    this.stopPolling()
    const intervalSec = this.getRefreshIntervalSec()
    const intervalMs = Math.max(5 * 1000, intervalSec * 1000)

    this.pollingTimer = setInterval(() => {
      if (!this.loading) {
        void this.refresh(false, true)
      }
    }, intervalMs)
  }

  stopPolling()       {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

          setupWindowListeners()       {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    if (this.onVisibilityChangeHandler) return

    this.onVisibilityChangeHandler = () => {
      if (document.visibilityState === 'visible') {
        const intervalSec = this.getRefreshIntervalSec()
        const staleThresholdMs = Math.min(60 * 1000, intervalSec * 1000)
        if (Date.now() - this.lastUpdated >= staleThresholdMs) {
          void this.refresh(false, true)
        }
      }
    }

    this.onWindowFocusHandler = () => {
      const intervalSec = this.getRefreshIntervalSec()
      const staleThresholdMs = Math.min(60 * 1000, intervalSec * 1000)
      if (Date.now() - this.lastUpdated >= staleThresholdMs) {
        void this.refresh(false, true)
      }
    }

    document.addEventListener('visibilitychange', this.onVisibilityChangeHandler)
    window.addEventListener('focus', this.onWindowFocusHandler)
  }

          triggerDesktopNotification(alarms              )       {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (this.config?.enableNotification === false) return

    const criticalAlarms = alarms.filter(a => a.level === 'critical' && !this.notifiedAlarmIds.has(`${a.instanceId}_${a.message}`))
    if (criticalAlarms.length === 0) return

    const send = () => {
      for (const a of criticalAlarms) {
        try {
          new Notification('DSH 额度监控告警', {
            body: a.message,
            icon: '/favicon.ico',
          })
          this.notifiedAlarmIds.add(`${a.instanceId}_${a.message}`)
        } catch {}
      }
    }

    if (Notification.permission === 'granted') {
      send()
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') send()
      }).catch(() => {})
    }
  }

  destroy()       {
    this.stopPolling()
    if (typeof document !== 'undefined' && this.onVisibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.onVisibilityChangeHandler)
      this.onVisibilityChangeHandler = undefined
    }
    if (typeof window !== 'undefined' && this.onWindowFocusHandler) {
      window.removeEventListener('focus', this.onWindowFocusHandler)
      this.onWindowFocusHandler = undefined
    }
    this.listeners.clear()
  }

  subscribe(listener          )             {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

          emit()       {
    for (const l of this.listeners) l()
  }

  getSnapshot()                {
    const cfg = this.config
    const orderList = cfg?.providerOrder && cfg.providerOrder.length > 0 ? cfg.providerOrder : DEFAULT_PROVIDER_ORDER
    const enabledSet = cfg?.enabledProviders ? new Set(cfg.enabledProviders) : null

    // Filter cards to display
    let visibleCards = this.cards
    if (this.activeCategory !== 'all') {
      visibleCards = visibleCards.filter(c => c.category === this.activeCategory)
    }

    if (enabledSet) {
      visibleCards = visibleCards.filter(c => enabledSet.has(c.provider) || c.provider === 'custom_api')
    }

    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.provider)
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
    })

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
      config: this.config,
    }
  }

  hasAlarms()          {
    return this.alarms.length > 0 || this.cards.some(c => c.status === 'warn' || c.status === 'error')
  }

  open()       {
    if (this.panelOpen) return
    this.panelOpen = true
    this.emit()
    void this.refresh()
    void this.loadConfig()
  }

  close()       {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.emit()
  }

  toggle()       {
    if (this.panelOpen) this.close()
    else this.open()
  }

  setTab(tab                         )       {
    this.activeTab = tab
    this.emit()
  }

  setCategory(category                          )       {
    this.activeCategory = category
    this.emit()
  }

  toggleGroupCollapse(groupId        )       {
    if (this.collapsedGroups.has(groupId)) {
      this.collapsedGroups.delete(groupId)
    } else {
      this.collapsedGroups.add(groupId)
    }
    this.emit()
  }

  async refresh(force = false, silent = false)                {
    if (!silent) {
      this.loading = true
      this.error = undefined
      this.emit()
    }
    try {
      const data = await this.api.getCards(force)
      this.cards = data.cards
      this.allCards = data.allCards || data.cards
      this.alarms = data.alarms || []
      this.lastUpdated = data.lastUpdated
      this.triggerDesktopNotification(this.alarms)
      if (silent) {
        this.error = undefined
      }
    } catch (err     ) {
      if (!silent) {
        this.error = err.message
      }
    } finally {
      if (!silent) {
        this.loading = false
      }
      this.emit()
    }
  }

  async refreshSingle(providerOrId        )                {
    this.refreshingProviders.add(providerOrId)
    this.emit()
    try {
      const updatedCard = await this.api.refreshSingle(providerOrId)
      if (updatedCard) {
        const idx = this.cards.findIndex(c => c.id === providerOrId || c.provider === providerOrId)
        if (idx !== -1) this.cards[idx] = updatedCard
        const allIdx = this.allCards.findIndex(c => c.id === providerOrId || c.provider === providerOrId)
        if (allIdx !== -1) this.allCards[allIdx] = updatedCard
        this.lastUpdated = Date.now()
      }
    } catch (err     ) {
      this.error = err.message
    } finally {
      this.refreshingProviders.delete(providerOrId)
      this.emit()
    }
  }

  async testConnection(provider        , accountConfig                    )                                {
    const res = await this.api.testConnection(provider, accountConfig)
    this.testResults[accountConfig?.id || provider] = res
    this.emit()
    return res
  }

  async testAllConnections()                                                {
    this.testingAll = true
    this.emit()
    try {
      const results = await this.api.testAllConnections()
      this.testResults = { ...this.testResults, ...results }
      return results
    } finally {
      this.testingAll = false
      this.emit()
    }
  }

  async getHistory(instanceId        , days = 7)                               {
    return this.api.getHistory(instanceId, days)
  }

  async loadConfig()                {
    try {
      this.config = await this.api.getConfig()
      this.emit()
      this.startPolling()
    } catch {}
  }

  async saveConfig(cfg             )                {
    const previousConfig = this.config
    this.config = cfg
    this.loading = true
    this.emit()
    try {
      await this.api.saveConfig(cfg)
      this.startPolling()
      await this.refresh(true)
    } catch (err     ) {
      this.config = previousConfig
      this.error = err.message
    } finally {
      this.loading = false
      this.emit()
    }
  }

  async startCodexLogin()                  {
    return this.api.startCodexLogin()
  }

  async startAntigravityLogin()                  {
    return this.api.startAntigravityLogin()
  }

  async connectCursor()                                    {
    return this.api.connectCursor()
  }
}



const PROVIDER_TITLES                         = {
  deepseek: 'DeepSeek 官方 API',
  antigravity: 'Google Antigravity',
  cursor: 'Cursor',
  codex: 'Codex (ChatGPT)',
  github_copilot: 'GitHub Copilot',
  openai_billing: 'OpenAI Platform',
  claude: 'Anthropic Claude',
  kimi: 'Moonshot Kimi',
  glm: '智谱清言 (GLM)',
  minimax: 'MiniMax (海螺)',
  qwen: '阿里通义千问',
  volcengine: '火山方舟 (豆包)',
  opencode_go: 'OpenCode Go',
  custom_api: '自定义中转 (OneAPI)',
}

const CATEGORY_NAMES                                           = {
  all: '全部服务',
  ide: 'IDE 编程助手',
  domestic_llm: '国内大模型',
  official_cloud: '海外官方',
  custom_api: '自定义中转',
}

function getQuotaStatusColor(remainingPercent        )         {
  // 宋式雅色（低饱和度、沉静克制、护眼素雅）
  if (remainingPercent <= 15) {
    return '#B04A46' // 🔴 茜色 / 殷红（危急）
  } else if (remainingPercent <= 35) {
    return '#BA8137' // 🟡 缃黄 / 栀子（预警）
  }
  return '#3F7A63' // 🟢 竹青 / 豆绿（充足）
}

function renderHelp(text        )         {
  return `
    <span class="quota-help-tip" data-tooltip="${text}" title="${text}" tabindex="0">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
        <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
      </svg>
    </span>
  `
}

function formatWindowSubtitle(win              )         {
  const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)))
  const used = Math.max(0, Math.min(100, Math.round(win.usedPercent ?? (100 - rem))))

  if (rem >= 100 || used <= 0) {
    return '已用 0% · 额度充足'
  }

  if (win.resetAt) {
    const resetDate = new Date(win.resetAt)
    if (!isNaN(resetDate.getTime())) {
      const diffMs = resetDate.getTime() - Date.now()
      if (diffMs > 0) {
        const totalMinutes = Math.ceil(diffMs / (60 * 1000))
        const days = Math.floor(totalMinutes / (24 * 60))
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
        const minutes = totalMinutes % 60

        const m = resetDate.getMonth() + 1
        const d = resetDate.getDate()
        const hh = String(resetDate.getHours()).padStart(2, '0')
        const mm = String(resetDate.getMinutes()).padStart(2, '0')
        const dateStr = `${m}/${d}`
        const timeStr = `${hh}:${mm}`
        const fullTimeStr = days > 0 ? `${dateStr} ${timeStr}` : timeStr

        let countdown = ''
        if (days > 0) {
          countdown = `${days} 天${hours > 0 ? ` ${hours} 小时` : ''}后`
        } else if (hours > 0) {
          countdown = `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}后`
        } else {
          countdown = `${minutes} 分钟后`
        }

        return `已用 ${used}% · 预计 ${countdown}重置 (${fullTimeStr})`
      } else {
        return `已用 ${used}% · 即将重置`
      }
    }
  }

  if (win.subtitle && win.subtitle.trim()) {
    return win.subtitle
  }

  return `已用 ${used}%`
}

function renderCircleProgress(remainingPercent        )         {
  const radius = 11
  const circumference = 2 * Math.PI * radius
  const clampedRem = Math.max(0, Math.min(100, Math.round(remainingPercent)))
  const offset = circumference - (clampedRem / 100) * circumference
  const color = getQuotaStatusColor(clampedRem)

  return `
    <div style="position: relative; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; flex: none;">
      <svg width="28" height="28" viewBox="0 0 28 28" shape-rendering="geometricPrecision" style="transform: rotate(-90deg); display: block;">
        <circle cx="14" cy="14" r="${radius}" stroke="var(--dsw-alias-border-l1, rgba(0,0,0,0.08))" stroke-width="2.5" fill="none"/>
        <circle cx="14" cy="14" r="${radius}" stroke="${color}" stroke-width="2.5" fill="none"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
          style="transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;"/>
      </svg>
    </div>
  `
}

/**
 * Pure SVG 7-day sparkline trend chart (Zero external dependencies)
 */
function renderSparklineSvg(points                        , currentRem = 100, width = 80, height = 24)         {
  let finalPoints = points && points.length >= 2 ? points : []

  if (finalPoints.length < 2) {
    const r = Math.max(0, Math.min(100, Math.round(currentRem)))
    const p1 = Math.min(100, r + (r < 95 ? Math.round((100 - r) * 0.25) : 0))
    const p2 = Math.min(100, r + (r < 95 ? Math.round((100 - r) * 0.15) : 0))
    finalPoints = [
      { t: 1, r: p1 },
      { t: 2, r: p2 },
      { t: 3, r: r },
      { t: 4, r: r },
      { t: 5, r: r },
    ]
  }

  const padding = 3
  const drawW = width - padding * 2
  const drawH = height - padding * 2

  const coords = finalPoints.map((p, idx) => {
    const x = padding + (idx / (finalPoints.length - 1)) * drawW
    const clampedR = Math.max(0, Math.min(100, p.r))
    const y = padding + (1 - clampedR / 100) * drawH
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  })

  const pathD = coords.reduce((acc, pt, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`, '')
  const lastPt = coords[coords.length - 1] 
  const firstPt = coords[0] 
  const strokeColor = getQuotaStatusColor(currentRem)
  const areaD = `${pathD} L ${lastPt.x},${height - padding} L ${firstPt.x},${height - padding} Z`

  return `
    <div title="7天额度消耗趋势 · 剩余 ${currentRem}%" class="quota-sparkline-wrap" style="width: ${width}px; height: ${height}px; display: inline-flex; align-items: center; justify-content: center; flex: none;">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; display: block;">
        <path d="${areaD}" fill="${strokeColor}" fill-opacity="0.15" />
        <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${lastPt.x}" cy="${lastPt.y}" r="2.2" fill="${strokeColor}" />
      </svg>
    </div>
  `
}

function renderQuotaApp(container             , controller                 )             {
  const styleEl = document.createElement('style')
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
      color: var(--dsw-alias-label-primary, #1f2328);
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
      max-width: 780px;
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
      color: var(--dsw-alias-brand-primary, #0969da);
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04));
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .quota-tabs {
      display: flex;
      gap: 4px;
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04));
      padding: 3px;
      border-radius: 8px;
    }
    .quota-tab-btn {
      padding: 5px 13px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #57606a);
      transition: background 0.15s, color 0.15s;
    }
    .quota-tab-btn.active {
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-primary, #111);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .quota-btn {
      padding: 6px 14px;
      border-radius: 7px;
      font-size: 12.5px;
      cursor: pointer;
      font-weight: 600;
      border: 1px solid transparent;
      background: var(--dsw-alias-label-primary, #1f2328);
      color: var(--dsw-alias-bg-layer-1, #fff);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.15s, transform 0.1s;
    }
    .quota-btn:hover { opacity: 0.88; }
    .quota-btn:active { transform: scale(0.98); }
    .quota-btn.secondary {
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-primary, #1f2328);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.15));
    }
    .quota-btn.action {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12));
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 6px;
    }
    .quota-btn.danger {
      background: rgba(176, 74, 70, 0.1);
      color: #B04A46;
      border: 1px solid rgba(176, 74, 70, 0.2);
    }
    .quota-btn.danger:hover {
      background: rgba(176, 74, 70, 0.2);
    }

    /* Dashboard Header Summary 4-Grid */
    .dashboard-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .summary-card {
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .summary-card-label {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
    }
    .summary-card-val {
      font-size: 19px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      font-feature-settings: "tnum";
    }

    /* Category Filter Tabs */
    .category-filter-bar {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .category-chip {
      padding: 4px 11px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .category-chip:hover {
      border-color: var(--dsw-alias-brand-primary, #0969da);
      color: var(--dsw-alias-brand-primary, #0969da);
    }
    .category-chip.active {
      background: var(--dsw-alias-label-primary, #1f2328);
      color: var(--dsw-alias-bg-layer-1, #fff);
      border-color: transparent;
      font-weight: 600;
    }

    /* Cards & Sections */
    .quota-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .auth-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .auth-section-title {
      font-size: 15.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .auth-group-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .group-header-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 4px;
      cursor: pointer;
      user-select: none;
    }
    .group-header-title:hover {
      color: var(--dsw-alias-label-primary, #1f2328);
    }

    .official-long-card {
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }
    .card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
      min-height: 56px;
      padding: 0 16px;
      box-sizing: border-box;
    }
    .card-row + .card-row {
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
    }
    .row-left-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 3px;
      min-width: 0;
      flex: 1;
    }
    .row-main-label {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
    }
    .row-sub-label {
      font-size: 12px;
      font-weight: 400;
      color: var(--dsw-alias-label-secondary, #57606a);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
    }
    .row-right-metric {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: none;
      margin-left: 16px;
    }
    .row-percent-number {
      font-size: 14px;
      font-weight: 700;
      font-feature-settings: "tnum";
      min-width: 38px;
      text-align: right;
    }
    .btn-card-refresh {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--dsw-alias-label-tertiary, #8c959f);
      width: 26px;
      height: 26px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: color 0.15s, background 0.15s;
    }
    .btn-card-refresh:hover {
      color: var(--dsw-alias-label-primary, #1f2328);
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));
    }
    .btn-card-refresh.spinning {
      animation: dshQuotaSpin 0.7s linear infinite;
    }
    @keyframes dshQuotaSpin {
      100% { transform: rotate(360deg); }
    }

    /* Settings Form */
    .quota-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .quota-settings-section {
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
      border-radius: 8px;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }
    .settings-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
    }
    .settings-section-title {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .sort-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sort-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 12px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
      border-radius: 6px;
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.02));
    }
    .sort-item-left {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
      cursor: pointer;
    }
    .sort-item-btns {
      display: flex;
      gap: 4px;
    }
    .btn-arrow {
      background: var(--dsw-alias-bg-layer-1, #fff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));
      color: var(--dsw-alias-label-primary, #1f2328);
      border-radius: 4px;
      width: 24px;
      height: 22px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-arrow:hover:not(:disabled) {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));
    }
    .btn-arrow:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .quota-input {
      padding: 7px 11px;
      border-radius: 6px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.15));
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.02));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-size: 12.5px;
      outline: none;
      box-sizing: border-box;
      width: 100%;
      transition: border-color 0.15s, background 0.15s;
    }
    .quota-input:focus {
      border-color: var(--dsw-alias-brand-primary, #0969da);
      background: var(--dsw-alias-bg-layer-1, #ffffff);
    }

    .credential-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 0;
    }
    .credential-item + .credential-item {
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
    }
    .credential-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .credential-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .credential-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .credential-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .test-conn-feedback {
      font-size: 11.5px;
      padding: 2px 6px;
      border-radius: 4px;
      display: none;
    }
    .test-conn-feedback.ok {
      display: inline-block;
      color: #3F7A63;
      background: rgba(63, 122, 99, 0.1);
    }
    .test-conn-feedback.error {
      display: inline-block;
      color: #B04A46;
      background: rgba(176, 74, 70, 0.1);
    }

    /* Multi-account & Custom list */
    .custom-endpoint-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border-radius: 6px;
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08));
    }

    .settings-bottom-bar {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      padding: 4px 0;
    }

    .quota-help-tip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      color: var(--dsw-alias-label-tertiary, #8c959f);
      cursor: help;
      position: relative;
      margin-left: 4px;
    }
    .quota-help-tip:hover { color: var(--dsw-alias-brand-primary, #0969da); }
    .quota-help-tip::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%) translateY(4px);
      background: var(--dsw-alias-bg-layer-1, #ffffff) !important;
      color: var(--dsw-alias-label-primary, #1f2328) !important;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.14)) !important;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.45;
      padding: 7px 11px;
      border-radius: 6px;
      white-space: normal;
      width: max-content;
      max-width: 280px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;
      z-index: 999;
    }
    .quota-help-tip:hover::after {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
    }
  `
  document.head.appendChild(styleEl)

  // Local state for dynamic multi-accounts & custom endpoints in settings
  let localCustomEndpoints                             = []
  let localAccounts                      = []

  function update() {
    const state = controller.getSnapshot()
    if (!state.panelOpen) return

    let contentHtml = ''

    if (state.activeTab === 'overview') {
      // 1. Summary Grid
      const totalServices = state.allCards.length
      const activeServices = state.allCards.filter(c => c.status === 'ok' || c.status === 'warn').length
      const alarmCount = state.alarms.length

      const summaryGridHtml = `
        <div class="dashboard-summary-grid">
          <div class="summary-card">
            <span class="summary-card-label">已监控服务</span>
            <span class="summary-card-val">${totalServices}</span>
          </div>
          <div class="summary-card">
            <span class="summary-card-label">正常运行</span>
            <span class="summary-card-val" style="color: #3F7A63;">${activeServices}</span>
          </div>
          <div class="summary-card">
            <span class="summary-card-label">告警 / 异常</span>
            <span class="summary-card-val" style="color: ${alarmCount > 0 ? '#B04A46' : 'var(--dsw-alias-label-secondary)'};">${alarmCount}</span>
          </div>
          <div class="summary-card">
            <span class="summary-card-label">自动刷新</span>
            <span class="summary-card-val" style="font-size: 14px; margin-top: 4px;">每 ${state.config?.refreshIntervalSeconds ?? 60}s</span>
          </div>
        </div>
      `

      // 2. Category tabs
      const categories                                  = ['all', 'domestic_llm', 'ide', 'official_cloud', 'custom_api']
      const categoryTabsHtml = `
        <div class="category-filter-bar">
          ${categories.map(cat => `
            <button class="category-chip ${state.activeCategory === cat ? 'active' : ''}" data-cat="${cat}">
              ${CATEGORY_NAMES[cat]}
            </button>
          `).join('')}
        </div>
      `

      // 3. Sections list
      const sectionsHtml = state.cards.length === 0
        ? '<div style="text-align: center; color: var(--dsw-alias-label-tertiary, #888); padding: 48px;">当前分类下无服务或未启用，可在「设置」中添加</div>'
        : state.cards.map((card) => {
            const isErr = card.status === 'error' || card.status === 'disabled'
            const isRefreshing = state.refreshingProviders.has(card.id) || state.refreshingProviders.has(card.provider)

            let actionBtn = ''
            if (card.provider === 'codex' && isErr) {
              actionBtn = '<button class="quota-btn action btn-login-codex">登录 OpenAI</button>'
            } else if (card.provider === 'cursor' && isErr) {
              actionBtn = '<button class="quota-btn action btn-login-cursor">连接 Cursor</button>'
            } else if (card.provider === 'antigravity' && isErr) {
              actionBtn = '<button class="quota-btn action btn-login-antigravity">登录 Google</button>'
            }

            let bodyHtml = ''
            if (isErr) {
              bodyHtml = `
                <div class="official-long-card">
                  <div class="card-row">
                    <div class="row-left-content">
                      <span class="row-main-label" style="color: var(--dsw-alias-label-error, #cf222e);">${card.error || '未连接'}</span>
                      <span class="row-sub-label">请在设置中配置凭据或点击连接后查看实时额度</span>
                    </div>
                    <div>${actionBtn}</div>
                  </div>
                </div>
              `
            } else {
              bodyHtml = card.groups.map((group, gIdx) => {
                const groupKey = `${card.id}::${group.title}::${gIdx}`
                const isCollapsed = state.collapsedGroups.has(groupKey)

                const rowsHtml = group.windows.map(win => {
                  const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)))
                  const statusColor = getQuotaStatusColor(rem)
                  const subText = formatWindowSubtitle(win)

                  return `
                    <div class="card-row">
                      <div class="row-left-content">
                        <span class="row-main-label" title="${win.label}">${win.label}</span>
                        <span class="row-sub-label" title="${subText}">${subText}</span>
                      </div>
                      <div class="row-right-metric">
                        ${renderSparklineSvg(card.sparkline, rem, 80, 24)}
                        <span class="row-percent-number" style="color: ${statusColor};">${rem}%</span>
                        ${renderCircleProgress(rem)}
                      </div>
                    </div>
                  `
                }).join('')

                return `
                  <div class="auth-group-block">
                    <div class="group-header-title" data-group-toggle="${groupKey}">
                      <span>${group.title} (${group.windows.length})</span>
                      <span style="font-size: 11px; opacity: 0.7;">${isCollapsed ? '展开 ▸' : '收起 ▾'}</span>
                    </div>
                    <div class="official-long-card" style="display: ${isCollapsed ? 'none' : 'block'};">
                      ${rowsHtml}
                    </div>
                  </div>
                `
              }).join('')
            }

            // Burn rate & estimated badge
            let rateBadge = ''
            if (card.burnRatePerHour && card.burnRatePerHour > 0) {
              rateBadge = `<span style="font-size: 11.5px; color: var(--dsw-alias-label-tertiary);">消耗: ${card.burnRatePerHour}%/h${card.estimatedHoursLeft ? ` · 余约 ${card.estimatedHoursLeft}h` : ''}</span>`
            }

            return `
              <div class="quota-section" data-card-id="${card.id}">
                <div class="auth-title-row">
                  <div class="auth-section-title">
                    <span>${card.name}</span>
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    ${rateBadge}
                    ${card.account ? `<span style="font-size: 12px; color: var(--dsw-alias-label-secondary);">${card.account}</span>` : ''}
                    <button class="btn-card-refresh ${isRefreshing ? 'spinning' : ''}" data-refresh-id="${card.id}" title="独立刷新此服务">↻</button>
                    ${actionBtn}
                  </div>
                </div>
                ${bodyHtml}
              </div>
            `
          }).join('')

      contentHtml = `
        ${summaryGridHtml}
        ${categoryTabsHtml}
        ${sectionsHtml}
      `
    } else {
      // Settings Tab
      const cfg = state.config || {}
      const currentOrder = (cfg.providerOrder && cfg.providerOrder.length > 0) ? cfg.providerOrder : Object.keys(PROVIDER_TITLES)
      const showHud = cfg.showFloatingHud !== false
      const selectedSec = cfg.refreshIntervalSeconds ?? 60
      const alarmThreshold = cfg.alarmThresholdPercent ?? 15
      const enableNotify = cfg.enableNotification !== false

      localCustomEndpoints = cfg.custom_compatible || []
      localAccounts = cfg.accounts || []

      const isProvChecked = (prov        ) => {
        if (cfg.enabledProviders && Array.isArray(cfg.enabledProviders)) {
          return cfg.enabledProviders.includes(prov)
        }
        return (cfg       )[prov]?.enabled !== false
      }

      const orderListHtml = currentOrder.map((prov, idx) => {
        const title = PROVIDER_TITLES[prov] || prov
        const checked = isProvChecked(prov) ? 'checked' : ''
        const isFirst = idx === 0
        const isLast = idx === currentOrder.length - 1

        return `
          <div class="sort-item-row" data-prov-id="${prov}">
            <label class="sort-item-left">
              <input type="checkbox" class="prov-enable-cb" data-prov="${prov}" ${checked} />
              <span>${title}</span>
            </label>
            <div class="sort-item-btns">
              <button type="button" class="btn-arrow btn-move-up" data-idx="${idx}" ${isFirst ? 'disabled' : ''}>↑</button>
              <button type="button" class="btn-arrow btn-move-down" data-idx="${idx}" ${isLast ? 'disabled' : ''}>↓</button>
            </div>
          </div>
        `
      }).join('')

      // Custom endpoints UI list
      const customEndpointsHtml = localCustomEndpoints.map((ep, idx) => `
        <div class="custom-endpoint-card" data-cust-idx="${idx}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <input type="text" class="quota-input cust-name" placeholder="中转站名称 (如: NewAPI 分发池)" value="${ep.name || ''}" style="width: 65%; font-weight: 600;" />
            <button type="button" class="quota-btn action danger btn-del-cust" data-idx="${idx}">删除</button>
          </div>
          <input type="text" class="quota-input cust-base" placeholder="Base URL (如: https://api.my-oneapi.com)" value="${ep.baseUrl || ''}" />
          <input type="password" class="quota-input cust-key" placeholder="API Key (sk-...)" value="${ep.apiKey || ''}" />
        </div>
      `).join('')

      contentHtml = `
        <form id="dsh-quota-form" class="quota-form">
          <!-- 1. 服务展示与排序 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">服务展示与排序</span>
              ${renderHelp('勾选以在概览页显示该服务；点击右侧箭头可自定义卡片在看板中的先后顺序')}
            </div>
            <div class="sort-list">
              ${orderListHtml}
            </div>
          </div>

          <!-- 2. 通用偏好与告警阈值 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">通用偏好、告警与通知</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">桌面悬浮环 (HUD)</span>
                ${renderHelp('在 DSH 界面显示可拖动的圆形额度悬浮窗，支持轮播速览与贴边吸附')}
              </div>
              <input type="checkbox" id="show-floating-hud" ${showHud ? 'checked' : ''} />
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">桌面通知提醒 (Notification)</span>
                ${renderHelp('当额度跌破阈值或服务失效时，触发系统级桌面通知弹窗')}
              </div>
              <input type="checkbox" id="enable-notification" ${enableNotify ? 'checked' : ''} />
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">低额度告警阈值</span>
                ${renderHelp('当剩余额度低于该百分比时触发告警（默认 15%）')}
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input type="range" id="alarm-threshold" min="5" max="50" step="5" value="${alarmThreshold}" style="width: 120px;" />
                <span id="alarm-threshold-val" style="font-size: 12px; font-weight: 700; min-width: 32px;">${alarmThreshold}%</span>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">自动刷新频率</span>
                ${renderHelp('后台定期自动刷新各平台配额与剩余额度')}
              </div>
              <select id="refresh-interval" class="quota-input" style="width: 150px; padding: 5px 8px;">
                <option value="10" ${selectedSec === 10 ? 'selected' : ''}>每 10 秒</option>
                <option value="30" ${selectedSec === 30 ? 'selected' : ''}>每 30 秒</option>
                <option value="60" ${selectedSec === 60 ? 'selected' : ''}>每 1 分钟 (推荐)</option>
                <option value="120" ${selectedSec === 120 ? 'selected' : ''}>每 2 分钟</option>
                <option value="300" ${selectedSec === 300 ? 'selected' : ''}>每 5 分钟</option>
                <option value="600" ${selectedSec === 600 ? 'selected' : ''}>每 10 分钟</option>
              </select>
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <span style="font-size: 13px; font-weight: 600;">网络代理 (HTTP Proxy)</span>
              <input type="text" id="http-proxy" class="quota-input" placeholder="http://127.0.0.1:7890" value="${cfg.httpProxy || ''}" />
            </div>
          </div>

          <!-- 3. 自定义 OneAPI / NewAPI 中转站 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">自定义 OneAPI / NewAPI 中转站</span>
              <button type="button" class="quota-btn action btn-add-custom-ep">+ 添加中转站</button>
            </div>
            <div id="custom-endpoints-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${customEndpointsHtml || '<div style="font-size: 12px; color: var(--dsw-alias-label-tertiary);">暂无自定义中转站，点击右上角添加</div>'}
            </div>
          </div>

          <!-- 4. 平台凭据与全部测活 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="settings-section-title">平台凭据配置</span>
                ${renderHelp('填入各模型/工具的 API Key 或 Session，支持一键并发测活')}
              </div>
              <button type="button" class="quota-btn secondary btn-test-all" style="padding: 3px 10px; font-size: 12px;">
                ${state.testingAll ? '⚡ 测活中...' : '⚡ 一键全部测活'}
              </button>
            </div>

            <!-- DeepSeek -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">DeepSeek 官方 API</span>
                  ${renderHelp('填入 DeepSeek API Key (sk-...) 查询充值与赠金余额')}
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="deepseek"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="deepseek">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-deepseek" class="quota-input" placeholder="sk-..." value="${cfg.deepseek?.apiKey || ''}" />
            </div>

            <!-- Cursor -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Cursor</span>
                  ${renderHelp('自动探测本地 state.vscdb 或填入 WorkosCursorSessionToken')}
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="cursor"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="cursor">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-cursor" class="quota-input" placeholder="WorkosCursorSessionToken" value="${cfg.cursor?.sessionToken || ''}" />
            </div>

            <!-- Google Antigravity -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Google Antigravity</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="antigravity"></span>
                  <button type="button" class="quota-btn action btn-login-antigravity">${cfg.antigravity?.oauth?.accessToken ? '重新授权' : '登录 Google'}</button>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="antigravity">测试连接</button>
                </div>
              </div>
            </div>

            <!-- Codex (OpenAI) -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Codex (ChatGPT Wham)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="codex"></span>
                  <button type="button" class="quota-btn action btn-login-codex">登录 OpenAI</button>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="codex">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-codex" class="quota-input" placeholder="access_token" value="${cfg.codex?.oauth?.accessToken || ''}" />
            </div>

            <!-- GitHub Copilot -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">GitHub Copilot</span>
                  ${renderHelp('自动探测本地 VS Code Copilot 登录态或填入 GitHub Token')}
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="github_copilot"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="github_copilot">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-copilot" class="quota-input" placeholder="gho_... / ghp_..." value="${cfg.github_copilot?.token || ''}" />
            </div>

            <!-- OpenAI Platform Billing -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">OpenAI Platform (API)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="openai_billing"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="openai_billing">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-openai-billing" class="quota-input" placeholder="sk-..." value="${cfg.openai_billing?.apiKey || ''}" />
            </div>

            <!-- Anthropic Claude -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Anthropic Claude</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="claude"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="claude">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-claude" class="quota-input" placeholder="sk-ant-..." value="${cfg.claude?.apiKey || ''}" />
            </div>

            <!-- Moonshot Kimi -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Moonshot Kimi</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="kimi"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="kimi">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-kimi" class="quota-input" placeholder="sk-..." value="${cfg.kimi?.apiKey || ''}" />
            </div>

            <!-- 智谱 GLM -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">智谱清言 (GLM)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="glm"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="glm">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-glm" class="quota-input" placeholder="glm api key" value="${cfg.glm?.apiKey || ''}" />
            </div>

            <!-- 阿里通义千问 -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">阿里通义千问 (百炼)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="qwen"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="qwen">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-qwen" class="quota-input" placeholder="sk-..." value="${cfg.qwen?.apiKey || ''}" />
            </div>

            <!-- 火山方舟 (豆包) -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">火山方舟 (豆包)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="volcengine"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="volcengine">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-volc" class="quota-input" placeholder="ark api key" value="${cfg.volcengine?.apiKey || ''}" />
            </div>

            <!-- OpenCode Go -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">OpenCode Go</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="opencode_go"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="opencode_go">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-opencode" class="quota-input" placeholder="sk-..." value="${cfg.opencode_go?.apiKey || ''}" />
            </div>
          </div>

          <!-- Bottom Action Bar -->
          <div class="settings-bottom-bar">
            <span id="save-status-hint" style="font-size: 12px; color: #3F7A63; font-weight: 600; display: none;">✓ 设置已保存</span>
            <button type="submit" class="quota-btn">保存所有设置</button>
          </div>
        </form>
      `
    }

    container.innerHTML = `
      <div class="quota-container">
        <div class="quota-header">
          <div class="quota-title">
            <span>AI 额度监控</span>
            <span class="quota-version-tag">v0.2.2</span>
            ${state.loading ? '<span style="font-size: 12px; font-weight: normal; color: var(--dsw-alias-brand-primary, #0969da); margin-left: 8px;">正在刷新...</span>' : ''}
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="quota-tabs">
              <button id="tab-overview" class="quota-tab-btn ${state.activeTab === 'overview' ? 'active' : ''}">看板</button>
              <button id="tab-settings" class="quota-tab-btn ${state.activeTab === 'settings' ? 'active' : ''}">设置</button>
            </div>
            <button id="btn-refresh" class="quota-btn secondary">↻ 全部刷新</button>
          </div>
        </div>
        ${contentHtml}
      </div>
    `

    // Event listeners
    container.querySelector('#tab-overview')?.addEventListener('click', () => controller.setTab('overview'))
    container.querySelector('#tab-settings')?.addEventListener('click', () => controller.setTab('settings'))
    container.querySelector('#btn-refresh')?.addEventListener('click', () => controller.refresh(true))

    // Threshold slider input
    const thresholdSlider = container.querySelector('#alarm-threshold')                           
    const thresholdVal = container.querySelector('#alarm-threshold-val')                      
    thresholdSlider?.addEventListener('input', () => {
      if (thresholdVal) thresholdVal.textContent = `${thresholdSlider.value}%`
    })

    // Category filter chips
    container.querySelectorAll('.category-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cat = chip.getAttribute('data-cat')       
        if (cat) controller.setCategory(cat)
      })
    })

    // Group toggle (Accordion)
    container.querySelectorAll('[data-group-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-group-toggle')
        if (key) controller.toggleGroupCollapse(key)
      })
    })

    // Single refresh
    container.querySelectorAll('.btn-card-refresh').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-refresh-id')
        if (id) void controller.refreshSingle(id)
      })
    })

    // Add Custom Endpoint
    container.querySelector('.btn-add-custom-ep')?.addEventListener('click', () => {
      localCustomEndpoints.push({
        id: `custom_${Date.now()}`,
        name: `中转站 #${localCustomEndpoints.length + 1}`,
        baseUrl: 'https://api.openai.com',
        apiKey: '',
        enabled: true,
      })
      const currentCfg = controller.getSnapshot().config || {}
      void controller.saveConfig({ ...currentCfg, custom_compatible: localCustomEndpoints })
    })

    // Delete Custom Endpoint
    container.querySelectorAll('.btn-del-cust').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'))
        if (!isNaN(idx) && idx >= 0 && idx < localCustomEndpoints.length) {
          localCustomEndpoints.splice(idx, 1)
          const currentCfg = controller.getSnapshot().config || {}
          void controller.saveConfig({ ...currentCfg, custom_compatible: localCustomEndpoints })
        }
      })
    })

    // Single Test Connection buttons
    container.querySelectorAll('.btn-test-conn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const prov = btn.getAttribute('data-prov')
        if (!prov) return
        const fbEl = container.querySelector(`[data-fb="${prov}"]`)                      
        if (fbEl) {
          fbEl.className = 'test-conn-feedback'
          fbEl.textContent = '测试中...'
          fbEl.style.display = 'inline-block'
        }

        let keyVal = ''
        if (prov === 'deepseek') keyVal = (container.querySelector('#key-deepseek')                    )?.value
        else if (prov === 'cursor') keyVal = (container.querySelector('#key-cursor')                    )?.value
        else if (prov === 'codex') keyVal = (container.querySelector('#key-codex')                    )?.value
        else if (prov === 'github_copilot') keyVal = (container.querySelector('#key-copilot')                    )?.value
        else if (prov === 'openai_billing') keyVal = (container.querySelector('#key-openai-billing')                    )?.value
        else if (prov === 'claude') keyVal = (container.querySelector('#key-claude')                    )?.value
        else if (prov === 'kimi') keyVal = (container.querySelector('#key-kimi')                    )?.value
        else if (prov === 'glm') keyVal = (container.querySelector('#key-glm')                    )?.value
        else if (prov === 'qwen') keyVal = (container.querySelector('#key-qwen')                    )?.value
        else if (prov === 'volcengine') keyVal = (container.querySelector('#key-volc')                    )?.value
        else if (prov === 'opencode_go') keyVal = (container.querySelector('#key-opencode')                    )?.value

        const accConfig = keyVal ? { id: prov, provider: prov, apiKey: keyVal, sessionToken: keyVal } : undefined
        const res = await controller.testConnection(prov, accConfig)

        if (fbEl) {
          if (res.ok) {
            fbEl.className = 'test-conn-feedback ok'
            fbEl.textContent = `✓ 成功 (${res.latencyMs}ms)`
          } else {
            fbEl.className = 'test-conn-feedback error'
            fbEl.textContent = `✗ ${res.message.slice(0, 30)}`
          }
        }
      })
    })

    // Test All Connections
    container.querySelector('.btn-test-all')?.addEventListener('click', async () => {
      const results = await controller.testAllConnections()
      for (const [id, res] of Object.entries(results)) {
        const fbEl = container.querySelector(`[data-fb="${id}"]`)                      
        if (fbEl) {
          if (res.ok) {
            fbEl.className = 'test-conn-feedback ok'
            fbEl.textContent = `✓ 成功 (${res.latencyMs}ms)`
          } else {
            fbEl.className = 'test-conn-feedback error'
            fbEl.textContent = `✗ ${res.message.slice(0, 30)}`
          }
        }
      }
    })

    // OAuth Logins
    container.querySelector('.btn-login-antigravity')?.addEventListener('click', async () => {
      try {
        const authUrl = await controller.startAntigravityLogin()
        window.open(authUrl, '_blank')
        setTimeout(() => controller.refresh(true), 4000)
      } catch (err     ) {
        alert('启动 Antigravity 登录失败: ' + err.message)
      }
    })

    container.querySelector('.btn-login-codex')?.addEventListener('click', async () => {
      try {
        const authUrl = await controller.startCodexLogin()
        window.open(authUrl, '_blank')
        setTimeout(() => controller.refresh(true), 4000)
      } catch (err     ) {
        alert('启动 Codex 登录失败: ' + err.message)
      }
    })

    // Form submit
    const form = container.querySelector('#dsh-quota-form')
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const httpProxy = (container.querySelector('#http-proxy')                    )?.value?.trim()
        const showFloatingHud = (container.querySelector('#show-floating-hud')                    )?.checked
        const enableNotification = (container.querySelector('#enable-notification')                    )?.checked
        const alarmThresholdPercent = parseInt((container.querySelector('#alarm-threshold')                    )?.value || '15', 10)
        const refreshInterval = parseInt((container.querySelector('#refresh-interval')                     )?.value || '60', 10)

        const enabledProviders           = []
        container.querySelectorAll('.prov-enable-cb').forEach((cb     ) => {
          if (cb.checked) {
            const p = cb.getAttribute('data-prov')
            if (p) enabledProviders.push(p)
          }
        })

        // Collect custom endpoints values from form
        const customCards = container.querySelectorAll('.custom-endpoint-card')
        const updatedCustomEndpoints                             = []
        customCards.forEach((cEl, i) => {
          const name = (cEl.querySelector('.cust-name')                    )?.value?.trim() || `中转站 #${i + 1}`
          const baseUrl = (cEl.querySelector('.cust-base')                    )?.value?.trim() || 'https://api.openai.com'
          const apiKey = (cEl.querySelector('.cust-key')                    )?.value?.trim() || ''
          updatedCustomEndpoints.push({
            id: localCustomEndpoints[i]?.id || `custom_${Date.now()}_${i}`,
            name,
            baseUrl,
            apiKey,
            enabled: true,
          })
        })

        const deepseekKey = (container.querySelector('#key-deepseek')                    )?.value?.trim()
        const cursorToken = (container.querySelector('#key-cursor')                    )?.value?.trim()
        const codexToken = (container.querySelector('#key-codex')                    )?.value?.trim()
        const copilotToken = (container.querySelector('#key-copilot')                    )?.value?.trim()
        const openaiKey = (container.querySelector('#key-openai-billing')                    )?.value?.trim()
        const claudeKey = (container.querySelector('#key-claude')                    )?.value?.trim()
        const kimiKey = (container.querySelector('#key-kimi')                    )?.value?.trim()
        const glmKey = (container.querySelector('#key-glm')                    )?.value?.trim()
        const qwenKey = (container.querySelector('#key-qwen')                    )?.value?.trim()
        const volcKey = (container.querySelector('#key-volc')                    )?.value?.trim()
        const opencodeKey = (container.querySelector('#key-opencode')                    )?.value?.trim()

        const currentCfg = controller.getSnapshot().config || {}

        void controller.saveConfig({
          ...currentCfg,
          httpProxy: httpProxy || undefined,
          showFloatingHud,
          enableNotification,
          alarmThresholdPercent,
          refreshIntervalSeconds: refreshInterval,
          enabledProviders,
          custom_compatible: updatedCustomEndpoints,
          deepseek: { ...currentCfg.deepseek, enabled: enabledProviders.includes('deepseek'), apiKey: deepseekKey },
          cursor: { ...currentCfg.cursor, enabled: enabledProviders.includes('cursor'), autoDetectLocal: true, sessionToken: cursorToken },
          codex: { ...currentCfg.codex, enabled: enabledProviders.includes('codex'), autoDetectLocal: true, oauth: codexToken ? { accessToken: codexToken } : currentCfg.codex?.oauth },
          github_copilot: { ...currentCfg.github_copilot, enabled: enabledProviders.includes('github_copilot'), autoDetectLocal: true, token: copilotToken },
          openai_billing: { ...currentCfg.openai_billing, enabled: enabledProviders.includes('openai_billing'), apiKey: openaiKey },
          claude: { ...currentCfg.claude, enabled: enabledProviders.includes('claude'), apiKey: claudeKey },
          kimi: { ...currentCfg.kimi, enabled: enabledProviders.includes('kimi'), apiKey: kimiKey },
          glm: { ...currentCfg.glm, enabled: enabledProviders.includes('glm'), apiKey: glmKey },
          qwen: { ...currentCfg.qwen, enabled: enabledProviders.includes('qwen'), apiKey: qwenKey },
          volcengine: { ...currentCfg.volcengine, enabled: enabledProviders.includes('volcengine'), apiKey: volcKey },
          opencode_go: { ...currentCfg.opencode_go, enabled: enabledProviders.includes('opencode_go'), apiKey: opencodeKey },
        }).then(() => {
          const hint = container.querySelector('#save-status-hint')                      
          if (hint) {
            hint.style.display = 'inline-block'
            setTimeout(() => { if (hint) hint.style.display = 'none' }, 2500)
          }
        })
      })
    }
  }

  const unsubscribe = controller.subscribe(update)
  update()

  return () => {
    unsubscribe()
    styleEl.remove()
  }
}



                       
           
           
 

const STORAGE_KEY = 'dsh_quota_hud_pos'

function getSavedPosition()              {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const pos = JSON.parse(raw)
      if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        const maxX = Math.max(10, window.innerWidth - 60)
        const maxY = Math.max(10, window.innerHeight - 60)
        return {
          x: Math.min(Math.max(12, pos.x), maxX),
          y: Math.min(Math.max(12, pos.y), maxY),
        }
      }
    }
  } catch {}
  return { x: Math.max(12, window.innerWidth - 64), y: Math.max(60, window.innerHeight - 160) }
}

function savePosition(pos             )       {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
  } catch {}
}

function mountQuotaHud(controller                 )             {
  const hudEl = document.createElement('div')
  hudEl.setAttribute('data-dsh-quota-hud', '')
  hudEl.style.cssText = `
    position: fixed;
    z-index: 990;
    width: 46px;
    height: 46px;
    cursor: grab;
    user-select: none;
    touch-action: none;
    transition: transform 0.16s ease, opacity 0.16s ease;
  `

  const styleEl = document.createElement('style')
  styleEl.textContent = `
    [data-dsh-quota-hud] {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dsh-hud-circle {
      position: relative;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14));
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: visible;
      transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
    }
    .dsh-hud-circle:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    }
    .dsh-hud-circle.docked {
      opacity: 0.72;
    }
    .dsh-hud-circle.docked:hover {
      opacity: 1;
    }
    .dsh-hud-svg {
      position: absolute;
      inset: 0;
      width: 46px;
      height: 46px;
      transform: rotate(-90deg);
      pointer-events: none;
    }
    .dsh-hud-content {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      line-height: 1;
      pointer-events: none;
    }
    .dsh-hud-percent {
      font-size: 11px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      letter-spacing: -0.2px;
    }
    .dsh-hud-tag {
      font-size: 8.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      margin-top: 1.5px;
      text-transform: uppercase;
    }
    .dsh-hud-popover {
      position: absolute;
      width: 240px;
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.15));
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      padding: 10px 12px;
      display: none;
      flex-direction: column;
      gap: 7px;
      pointer-events: none;
      z-index: 1000;
      font-family: inherit;
    }
    .dsh-hud-popover.pop-top {
      bottom: calc(100% + 8px);
    }
    .dsh-hud-popover.pop-bottom {
      top: calc(100% + 8px);
    }
    .dsh-hud-popover.pop-right {
      right: 0;
    }
    .dsh-hud-popover.pop-left {
      left: 0;
    }
    [data-dsh-quota-hud]:hover .dsh-hud-popover {
      display: flex;
    }
    .dsh-hud-popover-title {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08));
      padding-bottom: 5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .dsh-hud-popover-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--dsw-alias-label-secondary, #57606a);
      gap: 8px;
    }
    .dsh-hud-popover-name {
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
      max-width: 145px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsh-hud-popover-val {
      font-weight: 700;
      flex: none;
    }
  `
  document.head.appendChild(styleEl)
  document.body.appendChild(hudEl)

  let pos = getSavedPosition()
  hudEl.style.left = `${pos.x}px`
  hudEl.style.top = `${pos.y}px`

  // Drag interaction
  let isDragging = false
  let startX = 0
  let startY = 0
  let initialLeft = 0
  let initialTop = 0
  let moved = false
  let isHovered = false

  function onPointerDown(e                         ) {
    isDragging = true
    moved = false
    hudEl.style.cursor = 'grabbing'
    hudEl.style.transition = 'none'

    const clientX = 'touches' in e ? e.touches[0] .clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0] .clientY : e.clientY
    startX = clientX
    startY = clientY
    initialLeft = hudEl.offsetLeft
    initialTop = hudEl.offsetTop

    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
    window.addEventListener('touchmove', onPointerMove, { passive: false })
    window.addEventListener('touchend', onPointerUp)
  }

  function onPointerMove(e                         ) {
    if (!isDragging) return
    const clientX = 'touches' in e ? e.touches[0] .clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0] .clientY : e.clientY
    const dx = clientX - startX
    const dy = clientY - startY

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      moved = true
      if ('touches' in e && e.cancelable) e.preventDefault()
    }

    const newX = Math.max(8, Math.min(window.innerWidth - 54, initialLeft + dx))
    const newY = Math.max(8, Math.min(window.innerHeight - 54, initialTop + dy))
    hudEl.style.left = `${newX}px`
    hudEl.style.top = `${newY}px`
  }

  function onPointerUp() {
    if (!isDragging) return
    isDragging = false
    hudEl.style.cursor = 'grab'
    hudEl.style.transition = 'transform 0.16s ease, left 0.2s ease, top 0.2s ease'

    window.removeEventListener('mousemove', onPointerMove)
    window.removeEventListener('mouseup', onPointerUp)
    window.removeEventListener('touchmove', onPointerMove)
    window.removeEventListener('touchend', onPointerUp)

    if (!moved) {
      controller.toggle()
      return
    }

    // Snap to left or right
    const currentLeft = hudEl.offsetLeft
    const currentTop = hudEl.offsetTop
    const snapLeft = currentLeft < window.innerWidth / 2 ? 14 : window.innerWidth - 60
    const clampedTop = Math.max(14, Math.min(window.innerHeight - 60, currentTop))

    pos = { x: snapLeft, y: clampedTop }
    hudEl.style.left = `${pos.x}px`
    hudEl.style.top = `${pos.y}px`
    savePosition(pos)
    render()
  }

  hudEl.addEventListener('mousedown', onPointerDown)
  hudEl.addEventListener('touchstart', onPointerDown, { passive: false })

  hudEl.addEventListener('mouseenter', () => {
    isHovered = true
  })
  hudEl.addEventListener('mouseleave', () => {
    isHovered = false
  })

  // Tag helper
  function getProviderTag(provider        )         {
    const map                         = {
      deepseek: 'DSK',
      antigravity: 'AGY',
      cursor: 'CUR',
      codex: 'CDX',
      github_copilot: 'COP',
      openai_billing: 'OAI',
      claude: 'CLD',
      kimi: 'KMI',
      glm: 'GLM',
      minimax: 'MMX',
      qwen: 'QWN',
      volcengine: 'ARK',
      opencode_go: 'OPN',
      custom_api: 'API',
    }
    return map[provider] || provider.slice(0, 3).toUpperCase()
  }

  function getMetricsList(cards                , selectedMetrics           )         
               
                    
                
               
                            
     {
    const list         
                 
                      
                  
                 
                              
       = []

    for (const card of cards) {
      if (card.status !== 'ok' && card.status !== 'warn') continue
      const tag = getProviderTag(card.provider)

      if (card.groups.length === 0 && card.balance?.total) {
        const rem = card.balance.remaining !== undefined ? Math.round((card.balance.remaining / card.balance.total) * 100) : 100
        const key = makeHudMetricKey(card.provider, 'Balance', card.id)
        if (selectedMetrics === undefined || selectedMetrics.includes(key)) {
          list.push({
            key,
            provider: card.provider,
            name: `${card.name} · 账户余额`,
            tag,
            remainingPercent: Math.max(0, Math.min(100, rem)),
          })
        }
        continue
      }

      for (const group of card.groups) {
        for (const window of group.windows) {
          const key = makeHudMetricKey(card.provider, group.title, window.id)
          if (selectedMetrics !== undefined && !selectedMetrics.includes(key)) continue
          list.push({
            key,
            provider: card.provider,
            name: `${card.name} · ${group.title} · ${window.label}`,
            tag,
            remainingPercent: Math.max(0, Math.min(100, Math.round(window.remainingPercent))),
          })
        }
      }
    }

    return list
  }

  let activeIndex = 0
  let intervalTimer      = null

  function getStatusColor(rem        )         {
    if (rem <= 15) return '#B04A46' // 🔴 茜色
    if (rem <= 35) return '#BA8137' // 🟡 缃黄
    return '#3F7A63' // 🟢 竹青
  }

  function render() {
    const state = controller.getSnapshot()
    const isEnabled = state.config?.showFloatingHud !== false

    if (!isEnabled) {
      hudEl.style.display = 'none'
      return
    }
    hudEl.style.display = 'flex'

    const metrics = getMetricsList(state.cards, state.config?.floatingHudMetrics)

    // Calculate smart collision position for Popover
    const isNearTop = pos.y < 200
    const isNearRight = pos.x > window.innerWidth / 2
    const popoverVClass = isNearTop ? 'pop-bottom' : 'pop-top'
    const popoverHClass = isNearRight ? 'pop-right' : 'pop-left'

    if (metrics.length === 0) {
      const hasMetricSelection = Array.isArray(state.config?.floatingHudMetrics)
      const emptyTitle = hasMetricSelection ? '未选择额度' : '未连接服务'
      const emptyHint = hasMetricSelection ? '请在设置中选择要显示的额度窗口' : '点击打开面板完成服务连接'
      hudEl.innerHTML = `
        <div class="dsh-hud-circle">
          <svg class="dsh-hud-svg" viewBox="0 0 46 46">
            <circle cx="23" cy="23" r="18" stroke="var(--dsw-alias-border-l1, rgba(0,0,0,0.1))" stroke-width="3" fill="none"/>
          </svg>
          <div class="dsh-hud-content">
            <span class="dsh-hud-percent">--</span>
            <span class="dsh-hud-tag">AI</span>
          </div>
          <div class="dsh-hud-popover ${popoverVClass} ${popoverHClass}">
            <div class="dsh-hud-popover-title"><span>AI 额度监控</span><span style="font-weight: normal; font-size: 10px; opacity: 0.7;">${emptyTitle}</span></div>
            <div style="font-size: 11px; color: var(--dsw-alias-label-tertiary, #888);">${emptyHint}</div>
          </div>
        </div>
      `
      return
    }

    if (activeIndex >= metrics.length) activeIndex = 0
    const current = metrics[activeIndex] 

    const radius = 18
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (current.remainingPercent / 100) * circumference
    const strokeColor = getStatusColor(current.remainingPercent)

    const popoverRows = metrics.map(m => {
      const color = getStatusColor(m.remainingPercent)
      return `
        <div class="dsh-hud-popover-row">
          <span class="dsh-hud-popover-name" title="${m.name}">${m.name}</span>
          <span class="dsh-hud-popover-val" style="color: ${color};">${m.remainingPercent}% 剩余</span>
        </div>
      `
    }).join('')

    hudEl.innerHTML = `
      <div class="dsh-hud-circle">
        <svg class="dsh-hud-svg" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="${radius}" stroke="var(--dsw-alias-border-l1, rgba(0,0,0,0.08))" stroke-width="3" fill="none"/>
          <circle cx="23" cy="23" r="${radius}" stroke="${strokeColor}" stroke-width="3" fill="none"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
            style="transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;"/>
        </svg>
        <div class="dsh-hud-content">
          <span class="dsh-hud-percent">${current.remainingPercent}%</span>
          <span class="dsh-hud-tag">${current.tag}</span>
        </div>
        <div class="dsh-hud-popover ${popoverVClass} ${popoverHClass}">
          <div class="dsh-hud-popover-title">
            <span>AI 额度监控</span>
            <span style="font-weight: normal; font-size: 10px; opacity: 0.7;">点击查看详情</span>
          </div>
          ${popoverRows}
        </div>
      </div>
    `
  }

  intervalTimer = setInterval(() => {
    if (isHovered || isDragging) return // Pause carousel on hover or dragging
    const state = controller.getSnapshot()
    const metrics = getMetricsList(state.cards, state.config?.floatingHudMetrics)
    if (metrics.length > 1) {
      activeIndex = (activeIndex + 1) % metrics.length
      render()
    }
  }, 4500)

  const unsubscribe = controller.subscribe(render)
  render()

  return () => {
    if (intervalTimer) clearInterval(intervalTimer)
    unsubscribe()
    hudEl.remove()
    styleEl.remove()
  }
}



const PANEL_VIEW_SELECTOR = '[data-dsh-quota-view]'
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-quota-active'
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'quota'

function conversationColumn()                          {
  return document.querySelector             (CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

function mountPanel(controller                 )             {
  let container                            
  let disposeView                          

  const ensure = ()       => {
    if (container !== undefined) {
      if (container.isConnected) return
      disposeView?.()
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshQuotaView = ''
    container.dataset.dshPlugin = 'quota'
    column.appendChild(container)
    disposeView = renderQuotaApp(container, controller)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = ()       => {
    if (controller.getSnapshot().panelOpen) {
      for (const attr of OTHER_ACTIVE_ATTRS) {
        document.documentElement.removeAttribute(attr)
      }
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }

  const onOtherActivate = (event       )       => {
    const detail = (event               ).detail
    if (detail !== PANEL_NAME && controller.getSnapshot().panelOpen) {
      controller.close()
    }
  }

  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event            )       => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target                      
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }

  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    disposeView?.()
    container?.remove()
    container = undefined
  }
}

/**
 * Client entry for dsh-quota Web UI.
 * @package dsh-quota
 * @version 0.2.2
 */


const VERSION = '0.2.2'
const inject = ['slots', 'sessions', 'workspaces']

let applied = false

function apply(ctx     )       {
  if (applied) return
  applied = true

  const api = new QuotaClientApi()
  const controller = new QuotaController(api)

  try {
    const d1 = mountQuotaSidebarEntry(controller)
    const d2 = mountPanel(controller)
    const d3 = mountQuotaHud(controller)

    // Initialize controller (load config, initial fetch, start background polling & focus listeners)
    void controller.init()

    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => {
        return () => {
          d1()
          d2()
          d3()
          controller.destroy()
          applied = false
        }
      }, 'quota: client cleanup')
    }
  } catch (err) {
    console.error('[dsh-quota] client mount error:', err)
  }
}

// Immediate execution fallback in case ctx.apply isn't triggered by cordis runner immediately
if (typeof window !== 'undefined') {
  setTimeout(() => {
    apply({})
  }, 500)
}


    exports.apply = apply;
    exports.VERSION = VERSION;
    return module.exports;
  }
});