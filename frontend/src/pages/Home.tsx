import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function Home() {
  const [address, setAddress] = useState('')
  const navigate = useNavigate()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (address.trim()) {
      navigate(`/wallet/${address.trim()}`)
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Private credit scoring for Stellar
        </h1>
        <p className="mx-auto max-w-2xl text-gray-600 dark:text-gray-400">
          Prove your wallet history without revealing it. ZKredit issues on-chain risk
          attestations using a zk-SNARK distilled model.
        </p>
      </section>

      <form
        onSubmit={handleSubmit}
        className="mx-auto flex max-w-xl flex-col gap-4 sm:flex-row"
      >
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter a Stellar address (G...)"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-purple-500 dark:border-gray-700 dark:bg-gray-800"
        />
        <button
          type="submit"
          className="rounded-lg bg-purple-600 px-6 py-3 font-medium text-white hover:bg-purple-700"
        >
          Lookup Risk
        </button>
      </form>

      <div className="mx-auto max-w-xl rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
        <strong>What is proven?</strong> The distilled model inference is ZK-verified off-chain and
        either verified on-chain or hash-anchored. The full 200-dimensional feature model and raw
        transaction data are never placed on-chain.
      </div>
    </div>
  )
}
