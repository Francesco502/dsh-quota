import { formatStamp, sinceUpdate, untilReset } from './format-time.ts'
import { beijingClock, isPeakTime } from './peak-hours.ts'
/** A real Sidebar tab. No DOM scraping, HTML templates, keys or editable URLs. */
const en = {
  title: 'Usage & quotas', description: 'Harness token accounting and official account limits',
  refresh: 'Refresh quotas', loading: 'Loading…', error: 'Unable to load usage. Try again.',
  accounts: 'Account quotas', usage: 'Token usage', noAccounts: 'No accounts available',
  hour: 'Last hour', today: 'Today', week: 'Last 7 days', month: 'Last 30 days',
  current: 'This task + subagents', all: 'All tasks', provider: 'Provider', model: 'Model',
  allProviders: 'All providers', allModels: 'All models', total: 'Total tokens', input: 'Input',
  output: 'Output', cache: 'Cache read', cacheWrite: 'Cache write', reasoning: 'Reasoning', calls: 'Calls',
  unknown: 'Calls without usage', tasks: 'Tasks', purposes: 'Call purposes', hourly: 'Hourly', daily: 'Daily',
  byModel: 'By model', byProvider: 'By provider', name: 'Group', noData: 'No reported token usage in this range.',
  coverage: 'Coverage', indexed: 'Sessions indexed', partial: 'Partial coverage: older auxiliary calls may be missing.',
  details: 'About these numbers',
  jevAccountLabel: 'Jev (TypeSafe)', jevNoQuota: 'Not supported', jevNoBalance: 'Balance is not available: TypeSafe exposes no balance endpoint. Token counts are those this Harness spent.', jevNoQuotaApi: 'TypeSafe reports no quota here; only calls made by this Harness are counted.',
  jevTitle: 'Jev triage', jevCalls: 'Jev calls', jevFailures: 'Failed calls',
  jevInput: 'Jev input', jevOutput: 'Jev output', jevModel: 'Model', jevMode: 'Mode',
  jevHint: 'Jev calls bypass the Harness LLM seam, so they never appear in the token totals above.',
  indexing: 'Indexing historical sessions…', limits: 'Availability is not a promise that a request will succeed.',
  money: 'Provider-reported tokens, not a money estimate. Input is uncached; cache read/write are separate input buckets. Reasoning is an output subset.',
  taskHint: 'Task = root Harness session, including its subagents; call purposes are shown separately.',
  ok: 'Available', unavailable: 'Unavailable', unsupported: 'Not supported', failure: 'Error', stale: 'Cached / stale',
  reset: 'Resets', updated: 'Updated', remaining: 'remaining', balance: 'Balance', more: 'More groups are available through the read API.',
  retry: 'Retry', ago: 'ago', emptyWindow: 'Provider does not report a quota percentage.',
  peak: 'Peak hours', offPeak: 'Off-peak',
  peakHint: 'DeepSeek bills twice the off-peak rate on weekdays 09:00–12:00 and 14:00–18:00 Beijing time (UTC+8). Everything else, weekends included, is half price. Chinese statutory holidays are not accounted for.',
}
const ru = {
  ...en, title: 'Расход и квоты', description: 'Учёт токенов Harness и официальные лимиты аккаунтов',
  refresh: 'Обновить квоты', loading: 'Загрузка…', error: 'Не удалось загрузить статистику. Повтори запрос.',
  accounts: 'Квоты аккаунтов', usage: 'Расход токенов', noAccounts: 'Аккаунты недоступны',
  hour: 'Последний час', today: 'Сегодня', week: '7 дней', month: '30 дней',
  current: 'Эта задача + подагенты', all: 'Все задачи', provider: 'Провайдер', model: 'Модель',
  allProviders: 'Все провайдеры', allModels: 'Все модели', total: 'Всего токенов', input: 'Вход',
  output: 'Выход', cache: 'Чтение кэша', cacheWrite: 'Запись кэша', reasoning: 'Рассуждения', calls: 'Запросы', unknown: 'Без данных о расходе',
  tasks: 'Задачи', purposes: 'Назначение запросов', hourly: 'По часам', daily: 'По дням',
  byModel: 'По моделям', byProvider: 'По провайдерам', name: 'Группа', noData: 'За этот период расход токенов не зарегистрирован.',
  coverage: 'Покрытие', indexed: 'Сессий обработано', partial: 'Неполное покрытие: старые служебные запросы могут отсутствовать.',
  details: 'О точности учёта',
  jevAccountLabel: 'Jev (TypeSafe)', jevNoQuota: 'Не поддерживается', jevNoBalance: 'Баланс недоступен: TypeSafe не отдаёт его через API. Показаны токены, которые потратил этот Harness.', jevNoQuotaApi: 'TypeSafe не отдаёт квоту в эту панель; считаются только вызовы, сделанные Harness.',
  jevTitle: 'Jev — оценка запросов', jevCalls: 'Вызовов Jev', jevFailures: 'Неудачных вызовов',
  jevInput: 'Вход Jev', jevOutput: 'Выход Jev', jevModel: 'Модель', jevMode: 'Режим',
  jevHint: 'Вызовы Jev идут мимо LLM-слоя Harness, поэтому их нет в общей сумме токенов.',
  indexing: 'Индексируются старые сессии…', limits: 'Остаток квоты не гарантирует успешный запрос.',
  money: 'Токены из ответов провайдеров, не оценка денег. Вход — без кэша; чтение и запись кэша считаются отдельно. Reasoning входит в выход.',
  taskHint: 'Задача — корневая сессия Harness вместе с подагентами; служебные запросы показаны отдельно.',
  ok: 'Доступно', unavailable: 'Недоступно', unsupported: 'Не поддерживается', failure: 'Ошибка', stale: 'Устаревший кэш',
  reset: 'Сброс', updated: 'Обновлено', remaining: 'осталось', balance: 'Баланс', more: 'Остальные группы доступны через API чтения.',
  retry: 'Повторить', emptyWindow: 'Провайдер не сообщает процент квоты.',
  peak: 'Пиковые часы', offPeak: 'Низкий тариф',
  peakHint: 'DeepSeek берёт вдвое больше в пиковые часы: по будням 09:00–12:00 и 14:00–18:00 по Пекину (UTC+8). В остальное время, включая выходные, — половина цены. Китайские праздники не учитываются.',
}
export const dictionaries = { en, ru }

function createClient(require     ) {
  const React = require('react')
  const h = React.createElement
  const { useState, useEffect, useCallback, useSyncExternalStore } = React
  const ID = '@francescoli/dsh-quota'
  const CSS = `
.dq-page{height:100%;min-height:0;overflow:auto;padding:16px;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;line-height:1.5}
.dq-page *{box-sizing:border-box}.dq-page h1{font-size:19px;margin:0}.dq-page h2{font-size:15px;margin:0 0 10px}.dq-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dq-between{justify-content:space-between}.dq-muted{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dq-note{font-size:12px;padding:8px;border-left:3px solid var(--dsw-alias-border-l1);margin:8px 0}
.dq-control{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:6px 9px;min-width:0}.dq-control:disabled{opacity:.55}.dq-control:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dq-button{cursor:pointer}.dq-button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-secondary)}
.dq-section{margin-top:18px}.dq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px}.dq-card{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:12px;min-width:0;background:var(--dsw-alias-bg-layer-1)}.dq-number{font-size:23px;font-weight:650;font-variant-numeric:tabular-nums}.dq-card progress{width:100%;height:8px;accent-color:var(--dsw-alias-brand-primary)}.dq-window{margin-top:8px}.dq-status{font-size:11px;color:var(--dsw-alias-label-secondary)}.dq-error{color:var(--dsw-alias-state-error-primary)}
.dq-scroll{overflow-x:auto;margin-top:8px}.dq-table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}.dq-table th,.dq-table td{padding:7px 8px;text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}.dq-table th:first-child,.dq-table td:first-child{text-align:left;white-space:normal;overflow-wrap:anywhere;max-width:420px}.dq-table th{font-weight:600;color:var(--dsw-alias-label-secondary)}.dq-value{white-space:nowrap}.dq-page code{font:inherit;overflow-wrap:anywhere}.dq-select{max-width:100%;flex:1 1 170px}.dq-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:12px}
.dq-details>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:6px}.dq-details[open]>summary{margin-bottom:4px}
.dq-badge{display:inline-block;font-size:11px;line-height:1.6;border-radius:999px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dq-badge[data-peak=true]{border-color:var(--dsw-static-amber-500);color:var(--dsw-static-amber-500)}
`
  async function request(path        , init      = {}) {
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
    const response = await fetch(`/api/dsh-quota/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init, signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  function Icon(props      = {}) {
    return h('svg', { width: props.size ?? 18, height: props.size ?? 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M4 19V9m5 10V5m6 14v-7m5 7V3M2 21h20', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
  }
  let locale
  function Panel(props     ) {
    const localeSnapshot = useSyncExternalStore(locale.subscribe.bind(locale), locale.getSnapshot.bind(locale))
    const language = localeSnapshot.active ?? 'en'
    const t = locale.bind('dshQuota')
    const fmt = (value         ) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat(language).format(value) : '—'
    const date = (value     ) => formatStamp(value)
    const tabInfo = props.useTabInfo()
    const sessions = props.useSessions((state     ) => state.byId)
    const visible = tabInfo.tab.visible
    const [range, setRange] = useState('today'), [scope, setScope] = useState('all')
    const [group, setGroup] = useState('byModel'), [provider, setProvider] = useState(''), [model, setModel] = useState('')
    const [usage, setUsage] = useState(null       ), [accounts, setAccounts] = useState(null       )
    const [jev, setJev] = useState(null       )
    const [loading, setLoading] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('')
    const [revision, setRevision] = useState(0), [refreshRevision, setRefreshRevision] = useState(0)
    const [now, setNow] = useState(Date.now())
    const [providerOptions, setProviderOptions] = useState([]            ), [modelOptions, setModelOptions] = useState([]            )
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    // Relative labels stay live without refetching provider data.
    useEffect(() => {
      if (!visible) return
      setNow(Date.now())
      const timer = setInterval(() => setNow(Date.now()), 30000)
      return () => clearInterval(timer)
    }, [visible])
    useEffect(() => {
      if (!visible) return
      const controller = new AbortController()
      let stopped = false, timer
      async function load() {
        if (stopped) return
        setLoading(true)
        const now = Date.now()
        const midnight = new Date(now); midnight.setHours(0, 0, 0, 0)
        const from = range === 'today' ? midnight.getTime() : now - (range === 'hour' ? 3600000 : range === 'week' ? 7 * 86400000 : 30 * 86400000)
        const query = new URLSearchParams({ from: String(from), to: String(now), timeZone: zone })
        if (scope !== 'all') query.set('sessionId', scope === 'current' ? props.sessionId : scope)
        if (provider) query.set('provider', provider)
        if (model) query.set('model', model)
        try {
          const result = await request(`usage?${query}`, { signal: controller.signal })
          if (!stopped) {
            setUsage(result); setError('')
            if (!provider && !model) {
              setProviderOptions((result.byProvider ?? []).map((row     ) => row.provider ?? row.key))
              setModelOptions([...new Set((result.byModel ?? []).map((row     ) => row.model ?? row.key))]            )
            }
          }
        } catch { if (!stopped) setError(t('error')) }
        finally { if (!stopped) { setLoading(false); timer = setTimeout(load, 20000) } }
      }
      void load()
      return () => { stopped = true; controller.abort(); clearTimeout(timer) }
    }, [visible, props.sessionId, range, scope, provider, model, zone, revision])
    useEffect(() => {
      if (!visible) return
      const controller = new AbortController()
      let stopped = false, timer
      async function load() {
        try {
          const result = await request('accounts', { signal: controller.signal }); if (!stopped) setAccounts(result)
          // Read the coordinator directly: its route answers even when the
          // service is not visible from this plugin's scope.
          try {
            const direct = await fetch('/api/dsh-coordinator/status', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
            if (direct.ok) {
              const state      = await direct.json()
              if (!stopped) setJev({ available: true, ...state })
            } else {
              const fallback = await request('jev', { signal: controller.signal })
              if (!stopped) setJev(fallback)
            }
          } catch { /* coordinator not installed */ }
        }
        catch { if (!stopped) setError(t('error')) }
        finally { if (!stopped) timer = setTimeout(load, 60000) }
      }
      void load()
      return () => { stopped = true; controller.abort(); clearTimeout(timer) }
    }, [visible, refreshRevision])
    const refresh = useCallback(async () => {
      setRefreshing(true)
      try {
        const result = await request('refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: tabInfo.tab.signal })
        setAccounts(result); setError(''); setRevision((x        ) => x + 1); setRefreshRevision((x        ) => x + 1)
      } catch { setError(t('error')) }
      finally { setRefreshing(false) }
    }, [language, tabInfo.tab.signal])
    const select = (label        , value        , onChange                     , options                         ) =>
      h('select', { className: 'dq-control dq-select', 'aria-label': label, value, onChange: (e     ) => onChange(e.target.value) },
        ...options.map(([id, title]) => h('option', { key: id, value: id }, title)))
    const groups = [['byModel', 'byModel'], ['byProvider', 'byProvider'], ['byRootSession', 'tasks'], ['byHour', 'hourly'], ['byDay', 'daily'], ['byTask', 'purposes']]
    const rows = [...(usage?.[group] ?? [])].sort((a, b) => group === 'byHour' || group === 'byDay'
      ? Date.parse(b.bucket ?? b.key) - Date.parse(a.bucket ?? a.key) : b.totalTokens - a.totalTokens || a.key.localeCompare(b.key))
    const taskOptions                          = Object.values(sessions).filter((s     ) => !s.parentId)
      .sort((a     , b     ) => b.updatedAt - a.updatedAt).map((s     ) => [s.id, s.displayTitle])
    const totals = usage?.totals
    return h('section', { className: 'dq-page', 'data-quota-monitor': '' },
      h('style', null, CSS),
      h('header', { className: 'dq-row dq-between' }, h('h1', null, t('title')),
        h('button', { type: 'button', className: 'dq-control dq-button', disabled: refreshing, onClick: refresh }, refreshing ? t('loading') : t('refresh'))),
      error ? h('div', { role: 'alert', className: 'dq-note dq-error' }, error, ' ', h('button', { type: 'button', className: 'dq-control dq-button', onClick: () => setRevision((x        ) => x + 1) }, t('retry'))) : null,
      h('section', { className: 'dq-section' }, h('h2', null, t('accounts')),
        !accounts ? h('p', { className: 'dq-muted' }, t('loading')) : h('div', { className: 'dq-grid' },
          ...(accounts.accounts ?? []).map((account     ) => h('article', { className: 'dq-card', key: account.id },
            h('div', { className: 'dq-row dq-between' }, h('strong', null, account.label), h('span', { className: 'dq-status' }, t(account.status === 'error' ? 'failure' : account.status))),
            h('div', { className: 'dq-row' },
              h('span', { className: 'dq-muted' }, account.provider),
              account.provider === 'deepseek-api' || account.provider === 'deepseek-account'
                ? h('span', {
                  className: 'dq-badge',
                  'data-peak': String(isPeakTime(now)),
                  title: `${t('peakHint')} ${beijingClock(now)} (UTC+8)`,
                }, isPeakTime(now) ? t('peak') : t('offPeak'))
                : null),
            account.balance ? h('div', { className: 'dq-number' }, `${account.balance.amount} ${account.balance.currency}`) : null,
            ...(account.windows ?? []).map((win     ) => h('div', { key: win.id, className: 'dq-window' },
              h('div', { className: 'dq-row dq-between' }, h('span', null, win.label), h('span', { className: 'dq-value' }, typeof win.remainingPercent === 'number' ? `${fmt(win.remainingPercent)}% ${t('remaining')}` : '—')),
              typeof win.remainingPercent === 'number' ? h('progress', { max: 100, value: win.remainingPercent, 'aria-label': win.label }) : null,
              win.resetsAt ? h('div', { className: 'dq-muted' }, `${t('reset')}: ${date(win.resetsAt)} (${untilReset(win.resetsAt, now)})`) : null)),
            account.reason ? h('p', { className: 'dq-muted' }, account.reason) : null,
            account.stale ? h('div', { className: 'dq-muted' }, t('stale')) : null,
            account.fetchedAt ? h('div', { className: 'dq-muted' }, `${t('updated')}: ${date(account.fetchedAt)} (${sinceUpdate(account.fetchedAt, now)} ${t('ago')})`) : null)),
          ...(jev?.available ? [h('article', { className: 'dq-card', key: 'jev' },
            h('div', { className: 'dq-row dq-between' }, h('strong', null, t('jevAccountLabel')), h('span', { className: 'dq-status' }, t('jevNoQuota'))),
            h('div', { className: 'dq-muted' }, `${jev.model ?? 'jev-latest'} · ${t('jevMode')}: ${jev.mode ?? '—'}`),
            h('div', { className: 'dq-number' }, fmt(jev.calls ?? 0)),
            h('div', { className: 'dq-muted' }, t('jevCalls')),
            h('div', { className: 'dq-muted' }, `${t('jevInput')}: ${fmt(jev.inputTokens ?? 0)} · ${t('jevOutput')}: ${fmt(jev.outputTokens ?? 0)}`),
            h('p', { className: 'dq-muted' }, t('jevNoBalance')))] : [])),
        h('p', { className: 'dq-muted' }, t('limits'))),
      h('section', { className: 'dq-section', 'aria-busy': loading }, h('h2', null, t('usage')),
        h('div', { className: 'dq-row' },
          select(t('usage'), range, setRange, ['hour', 'today', 'week', 'month'].map(id => [id, t(id)])),
          select(t('tasks'), scope, setScope, [['all', t('all')], ['current', t('current')], ...taskOptions]),
          select(t('provider'), provider, (v        ) => { setProvider(v); setModel('') }, [['', t('allProviders')], ...providerOptions.map(v => [v, v]                    )]),
          select(t('model'), model, setModel, [['', t('allModels')], ...modelOptions.map(v => [v, v]                    )])),
        h('p', { className: 'dq-muted' }, zone, ' · ', t('taskHint')),
        totals ? h('div', { className: 'dq-summary' }, ...[['totalTokens', 'total'], ['inputTokens', 'input'], ['outputTokens', 'output'], ['cacheReadTokens', 'cache'], ['cacheWriteTokens', 'cacheWrite'], ['calls', 'calls'], ['unknownCalls', 'unknown']].map(([key, label]) =>
          h('div', { className: 'dq-card', key }, h('div', { className: 'dq-muted' }, t(label)), h('div', { className: 'dq-number' }, fmt(totals[key]))))) : h('p', { className: 'dq-muted' }, t('loading')),
        h('p', { className: 'dq-muted' }, t('money')),
        h('div', { className: 'dq-row', role: 'group', 'aria-label': t('usage') }, ...groups.map(([key, label]) => h('button', { key, type: 'button', className: 'dq-control dq-button', 'aria-pressed': group === key, onClick: () => setGroup(key) }, t(label)))),
        h('div', { className: 'dq-scroll' }, h('table', { className: 'dq-table' },
          h('thead', null, h('tr', null, ...['name', 'calls', 'input', 'cache', 'cacheWrite', 'output', 'reasoning', 'total', 'unknown'].map(key => h('th', { key, scope: 'col' }, t(key))))),
          h('tbody', null, ...rows.slice(0, 200).map((row     ) => h('tr', { key: row.key },
            h('td', null, row.model ? `${row.provider} / ${row.model}` : row.bucket ?? row.provider ?? row.label ?? row.task ?? sessions[row.sessionId ?? row.rootSessionId]?.displayTitle ?? row.sessionId ?? row.rootSessionId ?? row.key),
            ...['calls', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens', 'totalTokens', 'unknownCalls'].map(key => h('td', { key }, fmt(row[key]))))),
            !rows.length ? h('tr', null, h('td', { colSpan: 9, className: 'dq-muted' }, t('noData'))) : null))),
        rows.length > 200 ? h('p', { className: 'dq-muted' }, t('more')) : null,
        jev && jev.available === false ? h('p', { className: 'dq-muted' }, `${t('jevTitle')}: ${jev.reason ?? t('noData')}`) : null,
        jev?.available ? h('section', { className: 'dq-section' }, h('h2', null, t('jevTitle')),
          h('div', { className: 'dq-grid' }, ...[
            ['jevCalls', fmt(jev.calls)], ['jevFailures', fmt(jev.failures)],
            ['jevInput', fmt(jev.inputTokens)], ['jevOutput', fmt(jev.outputTokens)],
          ].map(([label, value]) => h('div', { className: 'dq-card', key: label },
            h('div', { className: 'dq-muted' }, t(label)), h('div', { className: 'dq-number' }, value)))),
          h('p', { className: 'dq-muted' }, `${t('jevModel')}: ${jev.model ?? '—'} · ${t('jevMode')}: ${jev.mode ?? '—'}`),
          h('p', { className: 'dq-muted' }, t('jevHint'))) : null,
        usage?.coverage ? h('div', { className: 'dq-note' },
          h('div', null, h('strong', null, t('coverage')), ' · ', `${t('indexed')}: ${fmt(usage.coverage.sessionsIndexed)} / ${fmt(usage.coverage.sessionsConsidered)}`),
          usage.indexing?.status !== 'ready' ? h('div', { className: 'dq-muted' }, t('indexing')) : null,
          !usage.coverage.complete ? h('div', { className: 'dq-muted' }, t('partial')) : null,
          (usage.limitations ?? []).length
            ? h('details', { className: 'dq-details' },
              h('summary', null, t('details')),
              ...(usage.limitations ?? []).map((line        ) => h('div', { className: 'dq-muted', key: line }, line)))
            : null) : null))
  }
  return {
    inject: ['slots', 'sidebarRightTabs', 'locale'],
    apply(ctx     ) {
      locale = ctx.locale
      ctx.effect(() => ctx.locale.register('dshQuota', { en, ru, zh: en, ja: en, es: en, fr: en, de: en, pt: en }), 'quota: dictionaries')
      const t = ctx.locale.bind('dshQuota')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: ID, kind: 'quota-monitor', keepMounted: true, title: () => t('title'),
        guide: [{ id: 'quota-monitor', order: 35, title: () => t('title'), description: () => t('description'), icon: Icon }],
      }), 'quota: sidebar type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Panel)), 'quota: sidebar body')
    },
  }
}
