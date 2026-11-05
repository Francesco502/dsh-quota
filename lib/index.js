/** Harness-native, credential-safe quota monitoring and usage accounting. */
import { createUsageTracker } from './harness/usage.js'
import { createQuotaMonitor } from './harness/quotas.js'
import { registerQuotaRoutes, parseUsageQuery, usageForTool } from './harness/api.js'

export const VERSION = '0.5.0-secure.1'
// No raw webServer; unavailable Harness services fail activation rather than
// falling back to unguarded routes or independent credential files.
export const inject = ['connection', 'llm', 'credentials', 'sessionQuery', 'sessionProjections', 'storageDomain', 'tools']

/** Shared read interface used by the UI/tool and future routing plugins. */
export function createMonitorService(usage     , quotas     ) {
  const closed = new AbortController()
  return {
    version: 1,
    usage(query                          = {}) { return usage.snapshot(parseUsageQuery(query)) },
    accounts(options                                              = {}) {
      return quotas.snapshot({ ...options, signal: options.signal ? AbortSignal.any([options.signal, closed.signal]) : closed.signal })
    },
    async snapshot(query                          = {}, options                           = {}) {
      const valid = parseUsageQuery(query)
      const [accountState, usageState] = await Promise.all([this.accounts(options), usage.snapshot(valid)])
      return { schemaVersion: 1, generatedAt: Date.now(), accountState, usage: usageState, routingEnabled: false }
    },
    async dispose() { closed.abort(); await Promise.allSettled([usage.dispose(), quotas.dispose()]) },
  }
}

export async function apply(ctx     ) {
  const usage = createUsageTracker(ctx)
  // This is the native Host transport: DSH installs its proxy dispatcher and
  // inspector around global fetch. Do not probe a nonexistent ctx.fetch service.
  const quotas = createQuotaMonitor(ctx, { fetch: (input, init) => globalThis.fetch(input, init) })
  const monitor = createMonitorService(usage, quotas)
  await ctx.effect(async () => {
    const disposers                       = []
    try {
      const stop = await usage.start()
      if (typeof stop === 'function') disposers.push(stop)
      disposers.push(ctx.reflect.provide('quotaMonitor', monitor))
      disposers.push(registerQuotaRoutes(ctx, monitor))
      disposers.push(ctx.tools.register({
        name: 'get_quota_status',
        deferLoading: true,
        description: 'Read account quota/balance or provider-reported Harness token usage by model, provider, session task, hour and day. Unknown quotas remain unknown; does not change models or credentials.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ['accounts', 'usage', 'snapshot', 'diagnostics'], description: 'Default snapshot. accounts reads provider limits; usage reads local token accounting only; diagnostics reads plugin/client revision metadata without account access.' },
            from: { type: 'integer', description: 'Inclusive epoch milliseconds. Defaults to seven days before to; maximum range 366 days.' },
            to: { type: 'integer', description: 'Exclusive epoch milliseconds; defaults to now.' },
            sessionId: { type: 'string', description: 'Optional exact task session; include descendants by default. Omit for all sessions.' },
            includeChildren: { type: 'boolean', description: 'Include task subagent sessions; default true.' },
            timeZone: { type: 'string', description: 'IANA timezone for hour/day buckets; default UTC.' },
            provider: { type: 'string', description: 'Optional exact Harness provider id for token accounting.' },
            model: { type: 'string', description: 'Optional exact model id for token accounting.' },
            groupBy: { type: 'string', enum: ['model', 'provider', 'task', 'session', 'rootSession', 'hour', 'day'], description: 'Detail dimension; default model. task means request purpose; rootSession means a task including subagents.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum detail rows, 1–100; default 20. Totals are never truncated.' },
          },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render(_args         , value         ) { return [{ type: 'text', text: JSON.stringify(value) }] } },
        isConcurrencySafe: () => true,
        async execute(args     , exec     ) {
          exec.signal.throwIfAborted()
          const { action = 'snapshot', groupBy = 'model', limit = 20, ...query } = args ?? {}
          if (!['accounts', 'usage', 'snapshot', 'diagnostics'].includes(action)) throw new Error('Unknown quota action')
          if (action === 'diagnostics') {
            const modules = ctx.get('clientModules')
            const entry = modules?.graph().entries.find((item     ) => item.id === '@francescoli/dsh-quota')
            return { pluginVersion: VERSION, schemaVersion: monitor.version, clientAdvertised: !!entry,
              ...(entry ? { clientRevision: entry.rev, clientDependencies: entry.inject ?? [] } : {}) }
          }
          // Validate independently of the tool transport, including accounts actions.
          parseUsageQuery(query)
          if (action === 'accounts') return monitor.accounts({ signal: exec.signal })
          if (action === 'usage') return usageForTool(await monitor.usage(query), groupBy, limit)
          const result = await monitor.snapshot(query, { signal: exec.signal })
          return { ...result, usage: usageForTool(result.usage, groupBy, limit) }
        },
      }))
      // Publish only an already-built Client artifact. This does not start a
      // watcher/server or promise that source edits build themselves.
      ctx.get('clientModules')?.rebuilt('@francescoli/dsh-quota')
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      await monitor.dispose()
      throw error
    }
    return async () => {
      await monitor.dispose()
      for (const dispose of disposers.reverse()) await dispose()
    }
  }, 'quota: native accounting, service and owner-only API')
}
