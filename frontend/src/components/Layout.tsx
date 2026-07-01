import { Link, Outlet } from 'react-router-dom'

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
        <nav className="mx-auto flex max-w-5xl items-center justify-between">
          <Link to="/" className="text-xl font-semibold text-purple-600">
            ZKredit
          </Link>
          <div className="flex gap-6 text-sm font-medium">
            <Link to="/" className="hover:text-purple-600">
              Wallet Lookup
            </Link>
            <Link to="/lending" className="hover:text-purple-600">
              Lending Demo
            </Link>
            <Link to="/identity" className="hover:text-purple-600">
              Identity
            </Link>
          </div>
        </nav>
      </header>
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
      <footer className="border-t border-gray-200 px-6 py-4 text-xs text-gray-500 dark:border-gray-700">
        <div className="mx-auto max-w-5xl">
          ZKredit is a Stellar BuildStation project. On-chain storage contains only risk buckets,
          confidence, model hashes, and proof hashes — never raw wallet history.
        </div>
      </footer>
    </div>
  )
}
