import { AnimatePresence, motion } from "framer-motion";
import { ModalSystem } from "./components/ModalSystem";
import { ToastViewport } from "./components/Notifications";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { HomePage } from "./pages/HomePage";
import { MyModpacksPage } from "./pages/MyModpacksPage";
import { ModsPage } from "./pages/ModsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StorePage } from "./pages/StorePage";
import { useAppStore } from "./store/AppStore";

const pages = {
  home: HomePage,
  modpacks: MyModpacksPage,
  mods: ModsPage,
  store: StorePage,
  settings: SettingsPage,
};

export default function App() {
  const { page } = useAppStore();
  const Page = pages[page];

  return (
    <div className="launcher-shell">
      <Sidebar />
      <div className="launcher-main">
        <TopBar />
        <main className="page-viewport">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={page}
              className="page-transition"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              <Page />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <ModalSystem />
      <ToastViewport />
    </div>
  );
}
