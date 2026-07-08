import { afterEach, describe, expect, it, vi } from 'vitest'

import { createKycSession, getKycStatus } from './kyc'

const COMMITMENT = 'aa'.repeat(32)

describe('kyc client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates a session and posts the commitment', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session_id: 's1', url: 'https://verify.didit.me/s1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await createKycSession(COMMITMENT)
    expect(result.session_id).toBe('s1')
    expect(result.url).toContain('didit.me')

    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/kyc/session')
    expect(JSON.parse(opts.body)).toEqual({ commitment: COMMITMENT })
  })

  it('throws the API detail message when session creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'KYC provider is not configured' }),
      }),
    )
    await expect(createKycSession(COMMITMENT)).rejects.toThrow('KYC provider is not configured')
  })

  it('polls status by commitment', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        commitment: COMMITMENT,
        status: 'approved',
        kyc_verified: true,
        bind_tx_hash: 'deadbeef',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const status = await getKycStatus(COMMITMENT)
    expect(status.kyc_verified).toBe(true)
    expect(status.bind_tx_hash).toBe('deadbeef')
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/v1/kyc/status/${COMMITMENT}`)
  })
})
