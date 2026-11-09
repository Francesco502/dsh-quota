/**
 * Minimal ambient types for the host packages this plugin imports type-only.
 *
 * The plugin is a bundle, not a library against the host: it only needs the
 * shapes it touches (`ctx.systemPrompt.section`, `ctx.webServer.register`, …).
 * The real declarations ship inside a DSH installation and are not published as
 * standalone npm packages, so keeping local shims is what lets `tsc --noEmit`
 * run in CI without a DSH checkout.
 */

declare module '@deepseek-ai/cordis' {
  export interface HostEffect {
    (): (() => void) | void
  }

  export interface HostRoute {
    kind: string
    path: string
    handler(req: any, res: any): Promise<void> | void
  }

  export interface HostWebServer {
    register(route: HostRoute): () => void
  }

  export interface HostSystemPrompt {
    section(options: { name: string; order?: number; text: string }): () => void
  }

  export interface HostToolRegistry {
    register?(tool: Record<string, unknown>): () => void
    registerTool?(tool: Record<string, unknown>): () => void
  }

  /**
   * The subset of the Cordis context used by this plugin. Host contexts are
   * service proxies, so unknown keys are reachable at runtime; the index
   * signature keeps those call sites honest enough for a type check.
   */
  export interface Context {
    [key: string]: any
    effect(fn: HostEffect, label?: string): any
    webServer: HostWebServer
    systemPrompt: HostSystemPrompt
    tools?: HostToolRegistry
    agent?: HostToolRegistry
    inject?(names: string[], callback: (scoped: any) => void): any
  }
}

declare module '@deepseek-ai/dsh-agent' {}
declare module '@deepseek-ai/dsh-system-prompt' {}
declare module '@deepseek-ai/dsh-host-webserver' {}
