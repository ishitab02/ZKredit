import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout.tsx'
import { Home } from '@/pages/Home.tsx'
import { Wallet } from '@/pages/Wallet.tsx'
import { Lending } from '@/pages/Lending.tsx'
import { Identity } from '@/pages/Identity.tsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="wallet/:address" element={<Wallet />} />
          <Route path="lending" element={<Lending />} />
          <Route path="identity" element={<Identity />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
