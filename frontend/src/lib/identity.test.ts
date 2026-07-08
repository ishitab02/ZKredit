import { afterEach, describe, expect, it, vi } from 'vitest'

import { recordMembership } from './identity'

const WALLET = 'G' + 'A'.repeat(55)
const COMMITMENT = 'cc'.repeat(32)

describe('identity membership client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('posts wallet + commitment and returns the member list', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        wallet_address: WALLET,
        commitment: COMMITMENT,
        members: [WALLET],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await recordMembership(WALLET, COMMITMENT)
    expect(result.members).toEqual([WALLET])

    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/identity/membership')
    expect(JSON.parse(opts.body)).toEqual({
      wallet_address: WALLET,
      commitment: COMMITMENT,
    })
  })

  it('throws the API detail message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ detail: 'bad commitment' }),
      }),
    )
    await expect(recordMembership(WALLET, COMMITMENT)).rejects.toThrow('bad commitment')
  })
})
