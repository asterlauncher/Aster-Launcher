import {
  CirclePlay,
  PackageOpen,
  Puzzle,
  ShoppingBag,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { AsterLogo } from "./AsterLogo";
import { useAppStore } from "../store/AppStore";
import type { PageId } from "../types/launcher";

const navigation: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: CirclePlay },
  { id: "modpacks", label: "My Modpacks", icon: PackageOpen },
  { id: "mods", label: "Mods", icon: Puzzle },
  { id: "store", label: "Store", icon: ShoppingBag },
];

export function Sidebar() {
  const { page, setPage } = useAppStore();

  return (
    <aside className="launcher-rail">
      <button
        type="button"
        className="rail-logo"
        onClick={() => setPage("home")}
        aria-label="Launcher home"
        title="Launcher"
      >
        <span className="rail-logo-mark">
          <AsterLogo />
        </span>
      </button>

      <nav className="rail-navigation" aria-label="Primary navigation">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={`rail-button ${page === id ? "is-selected" : ""}`}
            onClick={() => setPage(id)}
            aria-label={label}
            aria-current={page === id ? "page" : undefined}
            title={label}
            data-tooltip={label}
          >
            <Icon size={21} strokeWidth={1.75} />
          </button>
        ))}
      </nav>

      <button
        type="button"
        className={`rail-button rail-settings ${page === "settings" ? "is-selected" : ""}`}
        onClick={() => setPage("settings")}
        aria-label="Settings"
        title="Settings"
        data-tooltip="Settings"
      >
        <Settings size={22} strokeWidth={1.75} />
      </button>
    </aside>
  );
}
