import { useEffect, useMemo, useState } from "react";
import {
  CirclePlay,
  PackageOpen,
  Puzzle,
  ShoppingBag,
  Settings,
  Gauge,
  Boxes,
  Wrench,
  ArchiveRestore,
  Gamepad2,
  RadioTower,
  Check,
  Search,
  X,
  LibraryBig,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { AsterLogo } from "./AsterLogo";
import { useAppStore } from "../store/AppStore";
import type { GameId, PageId } from "../types/launcher";

const minecraftNavigation: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: CirclePlay },
  { id: "modpacks", label: "My Modpacks", icon: PackageOpen },
  { id: "mods", label: "Mods", icon: Puzzle },
  { id: "store", label: "Store", icon: ShoppingBag },
];

const sprocketNavigation: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Sprocket Home", icon: Gauge },
  { id: "modpacks", label: "My Blueprints", icon: Boxes },
  { id: "mods", label: "Mods & Tuning", icon: Wrench },
  { id: "store", label: "Backups", icon: ArchiveRestore },
];

const btd6Navigation: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Bloons TD 6 Home", icon: Gamepad2 },
  { id: "modpacks", label: "My BTD6 Modpacks", icon: PackageOpen },
  { id: "mods", label: "BTD6 Mods", icon: Puzzle },
];

const battlefrontNavigation: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Battlefront II Home", icon: Gamepad2 },
  { id: "mods", label: "Mods", icon: Puzzle },
  { id: "modpacks", label: "Mod Collections", icon: Boxes },
  { id: "store", label: "KYBER Multiplayer", icon: RadioTower },
];

const games: Array<{ id: GameId; name: string; platform: string; detail: string; art: string }> = [
  { id: "minecraft", name: "Minecraft", platform: "Java Edition", detail: "Mods, modpacks and shared worlds", art: "/assets/featured-modpack.png" },
  { id: "sprocket", name: "Sprocket", platform: "Steam", detail: "Blueprints and engineering", art: "/assets/sprocket-hero.png" },
  { id: "btd6", name: "Bloons TD 6", platform: "Steam", detail: "Vanilla and scanned mods", art: "/assets/btd6-logo.png" },
  { id: "battlefront2", name: "Battlefront II", platform: "Steam", detail: "Mods and KYBER multiplayer", art: "/assets/battlefront-hero.png" },
];

// Keep the unfinished workspaces registered so they can be enabled again without
// rebuilding their pages, services or native commands.
const hiddenGames = new Set<GameId>(["sprocket", "battlefront2"]);

export function Sidebar() {
  const { page, setPage, activeGame, setActiveGame } = useAppStore();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [gameQuery, setGameQuery] = useState("");
  const availableGames = useMemo(() => games.filter((game) => !hiddenGames.has(game.id)), []);
  const filteredGames = useMemo(() => {
    const query = gameQuery.trim().toLocaleLowerCase();
    return availableGames.filter((game) =>
      !query || `${game.name} ${game.platform} ${game.detail}`.toLocaleLowerCase().includes(query));
  }, [availableGames, gameQuery]);
  const navigation = activeGame === "minecraft"
    ? minecraftNavigation
    : activeGame === "sprocket"
      ? sprocketNavigation
      : activeGame === "btd6"
        ? btd6Navigation
        : battlefrontNavigation;

  useEffect(() => {
    if (!selectorOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectorOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectorOpen]);

  return (
    <>
      <aside className="launcher-rail">
        <button type="button" className="rail-logo" onClick={() => setSelectorOpen(true)} aria-label="Switch game" title="Switch game">
          <span className="rail-logo-mark"><AsterLogo /></span>
        </button>

        <nav className="rail-navigation" aria-label={`${activeGame} navigation`}>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} className={`rail-button ${page === id ? "is-selected" : ""}`} onClick={() => setPage(id)} aria-label={label} aria-current={page === id ? "page" : undefined} title={label} data-tooltip={label}>
              <Icon size={21} strokeWidth={1.75} />
            </button>
          ))}
        </nav>

        <button type="button" className={`rail-button rail-settings ${page === "settings" ? "is-selected" : ""}`} onClick={() => setPage("settings")} aria-label="Settings" title="Settings" data-tooltip="Settings">
          <Settings size={22} strokeWidth={1.75} />
        </button>
      </aside>

      <AnimatePresence>
        {selectorOpen && (
          <motion.div className="game-switcher-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setSelectorOpen(false)}>
            <motion.section className="game-switcher" role="dialog" aria-modal="true" aria-labelledby="game-library-title" initial={{ opacity: 0, scale: 0.96, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 10 }} transition={{ duration: 0.16 }} onMouseDown={(event) => event.stopPropagation()}>
              <header className="game-switcher-header">
                <span className="game-switcher-heading-icon" aria-hidden="true"><LibraryBig size={22} /></span>
                <div>
                  <h2 id="game-library-title">Game library</h2>
                  <p>Every game keeps its profiles, mods and files isolated.</p>
                </div>
                <button type="button" className="game-switcher-close" onClick={() => setSelectorOpen(false)} aria-label="Close game library"><X size={20} /></button>
              </header>

              <div className="game-switcher-toolbar">
                <label className="game-switcher-search">
                  <Search size={18} aria-hidden="true" />
                  <input value={gameQuery} onChange={(event) => setGameQuery(event.target.value)} placeholder="Search games..." autoFocus aria-label="Search games" />
                  {gameQuery && <button type="button" onClick={() => setGameQuery("")} aria-label="Clear search"><X size={15} /></button>}
                </label>
                <span className="game-switcher-count">{filteredGames.length} of {availableGames.length}</span>
              </div>

              <div className="game-switcher-viewport">
                {filteredGames.length > 0 ? (
                  <div className="game-switcher-grid">
                    {filteredGames.map((game) => (
                      <button type="button" key={game.id} className={`game-switcher-card ${activeGame === game.id ? "is-active" : ""}`} onClick={() => { setActiveGame(game.id); setSelectorOpen(false); }}>
                        <span className={`game-switcher-art game-${game.id}`} aria-hidden="true">
                          <img src={game.art} alt="" />
                          <span className="game-switcher-ready">READY</span>
                          {activeGame === game.id && <span className="game-switcher-current"><Check size={13} /> CURRENT</span>}
                        </span>
                        <span className="game-switcher-copy">
                          <span className="game-switcher-platform">{game.platform}</span>
                          <strong>{game.name}</strong>
                          <small>{game.detail}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="game-switcher-empty">
                    <Search size={28} />
                    <strong>No games found</strong>
                    <span>Try another game name.</span>
                  </div>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
