import { QuotaManager } from './core/manager.ts'

const manager = new QuotaManager()
console.log('Loaded config:', manager.getConfig())

const res = await manager.getQuota(true)
console.log('Fetched quota items:', JSON.stringify(res, null, 2))
