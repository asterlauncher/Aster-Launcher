import { AnimatePresence, motion } from "framer-motion";
import { AsterGiftInbox } from "./components/AsterGiftInbox";
import { CosmeticsReleaseGift } from "./components/CosmeticsReleaseGift";
import { ModalSystem } from "./components/ModalSystem";
import { ToastViewport } from "./components/Notifications";
import { Sidebar } from "./components/Sidebar";
import { SocialNotificationBridge } from "./components/SocialNotificationBridge";
import { TopBar } from "./components/TopBar";
import { HomePage } from "./pages/HomePage";
import { MyModpacksPage } from "./pages/MyModpacksPage";
import { ModsPage } from "./pages/ModsPage";
import { Btd6SettingsPage, LauncherOnlySettingsPage, SettingsPage } from "./pages/SettingsPage";
import { StorePage } from "./pages/StorePage";
import { SprocketHomePage } from "./pages/SprocketHomePage";
import { SprocketLibraryPage } from "./pages/SprocketLibraryPage";
import { SprocketWorkbenchPage } from "./pages/SprocketWorkbenchPage";
import { SprocketBackupsPage } from "./pages/SprocketBackupsPage";
import { Btd6HomePage } from "./pages/Btd6HomePage";
import { Btd6ModpacksPage, Btd6ModsPage } from "./pages/Btd6ModsPage";
import { Btd6SafetyPage } from "./pages/Btd6SafetyPage";
import {
  BattlefrontCollectionsPage,
  BattlefrontHomePage,
  BattlefrontModsPage,
  BattlefrontMultiplayerPage,
} from "./pages/BattlefrontPages";
import { useAppStore } from "./store/AppStore";

const pages = {
  home: HomePage,
  modpacks: MyModpacksPage,
  mods: ModsPage,
  store: StorePage,
  settings: SettingsPage,
};

const sprocketPages = {
  home: SprocketHomePage,
  modpacks: SprocketLibraryPage,
  mods: SprocketWorkbenchPage,
  store: SprocketBackupsPage,
  settings: LauncherOnlySettingsPage,
};

const btd6Pages = {
  home: Btd6HomePage,
  modpacks: Btd6ModpacksPage,
  mods: Btd6ModsPage,
  store: Btd6SafetyPage,
  settings: Btd6SettingsPage,
};

const battlefrontPages = {
  home: BattlefrontHomePage,
  modpacks: BattlefrontCollectionsPage,
  mods: BattlefrontModsPage,
  store: BattlefrontMultiplayerPage,
  settings: LauncherOnlySettingsPage,
};

export default function App() {
  const { page, activeGame } = useAppStore();
  const Page = activeGame === "sprocket"
    ? sprocketPages[page]
    : activeGame === "btd6"
      ? btd6Pages[page]
      : activeGame === "battlefront2"
        ? battlefrontPages[page]
        : pages[page];

  return (
    <div className="launcher-shell">
      <Sidebar />
      <div className="launcher-main">
        <TopBar />
        <main className="page-viewport">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${activeGame}-${page}`}
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
      <CosmeticsReleaseGift />
      <AsterGiftInbox />
      <ToastViewport />
      <SocialNotificationBridge />
    </div>
  );
}
