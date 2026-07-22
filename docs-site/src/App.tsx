import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import DocsBackground from "./components/DocsBackground";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import DocPage from "./pages/DocPage";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <DocsBackground />
      <Header menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((v) => !v)} />

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-ink-900/70 backdrop-blur-sm lg:hidden"
            onClick={() => setMenuOpen(false)}
          >
            <motion.div
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="glass ml-3 mt-[4.75rem] h-[calc(100vh-5.5rem)] w-72 overflow-y-auto rounded-2xl p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar onNavigate={() => setMenuOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="container-page pt-24 md:pt-28">
        <div className="flex gap-10">
          <aside className="sticky top-28 hidden h-[calc(100vh-8rem)] w-60 shrink-0 overflow-y-auto lg:block">
            <Sidebar />
          </aside>
          <main className="min-w-0 flex-1">
            <Routes>
              <Route path="/*" element={<DocPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}
