# Provider 扩展开发指南

本文档介绍如何在 **@francescoli/dsh-quota** 中接入新的 AI 服务提供商。

---

## 1. Provider 接口契约

所有 Provider 类必须实现 `QuotaProvider` 接口：

```typescript
export interface QuotaProvider {
  readonly id: string
  readonly name: string
  fetchQuota(config: QuotaConfig): Promise<ProviderQuotaResult>
}
```

---

## 2. 标准返回结构 (`ProviderQuotaResult`)

```typescript
export interface ProviderQuotaResult {
  id: string
  name: string
  status: 'ok' | 'warning' | 'error'
  metrics: QuotaMetric[]
  resetAt?: number
  updatedAt: number
  error?: string
}
```

---

## 3. 注册流程

1. 在 `src/providers/` 目录下新建 `your-provider.ts`；
2. 在 `src/core/manager.ts` 的 `registerDefaultProviders()` 中实例化并注册；
3. 运行 `npm test` 与 `npm run build` 进行验证。
