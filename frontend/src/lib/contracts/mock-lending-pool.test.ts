import { afterEach, describe, expect, it, vi } from 'vitest'

// The lending pool is skipped on the minimal mainnet deploy, so getLoanTerms
// must honestly report "not deployed" (null) rather than fabricate terms.
describe('mock-lending-pool deployment gating', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns null / not-deployed when no lending contract id is configured', async () => {
    vi.resetModules()
    vi.doMock('./config', () => ({ NETWORK: { contractIds: { mockLendingPool: '' } } }))
    const mod = await import('./mock-lending-pool')
    expect(mod.isLendingDeployed()).toBe(false)
    expect(await mod.getLoanTerms('G' + 'A'.repeat(55))).toBeNull()
  })

  it('reports deployed when a lending contract id is present', async () => {
    vi.resetModules()
    vi.doMock('./config', () => ({ NETWORK: { contractIds: { mockLendingPool: 'CABCDEF' } } }))
    const mod = await import('./mock-lending-pool')
    expect(mod.isLendingDeployed()).toBe(true)
  })
})
