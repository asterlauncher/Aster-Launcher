import {
  Check,
  ChevronDown,
  Download,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { catalog } from "../data/mock";
import { useAppStore } from "../store/AppStore";
import type { CatalogItem } from "../types/launcher";

const discoveryImages = [
  "/placeholders/news-update.svg",
  "/placeholders/news-mod.svg",
  "/placeholders/news-launcher.svg",
  "/placeholders/news-cosmetic.svg",
];

function ProjectTile({
  item,
  image,
}: {
  item: CatalogItem;
  image: string;
}) {
  const { offline, openModal, notify } = useAppStore();
  const [installed, setInstalled] = useState(Boolean(item.installed));
  const [installing, setInstalling] = useState(false);

  const install = () => {
    if (offline) {
      notify({
        title: "Offline",
        message: "Reconnect before downloading new content.",
        tone: "warning",
      });
      return;
    }
    if (item.conflict) {
      openModal("mod-conflict");
      return;
    }
    setInstalling(true);
    window.setTimeout(() => {
      setInstalling(false);
      setInstalled(true);
      notify({
        title: `${item.title} installed`,
        message: "Added to Minecraft 1.21.1.",
        tone: "success",
      });
    }, 1200);
  };

  return (
    <article className="project-tile">
      <div className="project-image">
        <img src={image} alt="" />
        <span>{item.type}</span>
      </div>
      <div className="project-info">
        <div>
          <h2>{item.title}</h2>
          <p>by {item.author}</p>
        </div>
        <p className="project-description">{item.description}</p>
        <div className="project-footer">
          <span>
            <Download size={13} />
            {item.downloads}
          </span>
          <button
            type="button"
            onClick={install}
            disabled={installing || installed}
          >
            {installed ? (
              <>
                <Check size={14} /> Installed
              </>
            ) : installing ? (
              <>Installing…</>
            ) : (
              <>
                <Plus size={14} /> Install
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

export function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | "Modpacks" | "Mods">("All");
  const { offline } = useAppStore();

  const projects = useMemo(
    () =>
      catalog.filter((item) => {
        const matchesFilter =
          filter === "All" ||
          (filter === "Modpacks" && item.type === "Modpack") ||
          (filter === "Mods" && item.type === "Mod");
        return (
          matchesFilter &&
          `${item.title} ${item.author}`
            .toLowerCase()
            .includes(query.toLowerCase())
        );
      }),
    [filter, query],
  );

  return (
    <div className="compact-page">
      <header className="compact-page-header">
        <div>
          <h1>Discover</h1>
          <p>Browse mods and modpacks</p>
        </div>
        {offline && <span className="offline-chip">Offline</span>}
      </header>

      <div className="compact-toolbar discover-controls">
        <label>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
          />
        </label>
        {(["All", "Modpacks", "Mods"] as const).map((option) => (
          <button
            type="button"
            key={option}
            className={filter === option ? "active-filter" : ""}
            onClick={() => setFilter(option)}
          >
            {option}
          </button>
        ))}
        <button type="button">
          <SlidersHorizontal size={15} />
          Filters
        </button>
        <button type="button">
          Popular <ChevronDown size={14} />
        </button>
      </div>

      {offline ? (
        <div className="launcher-empty-state">
          <h2>Discovery is unavailable offline</h2>
          <p>Your installed content is still available from Instances.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((item, index) => (
            <ProjectTile
              key={item.id}
              item={item}
              image={discoveryImages[index % discoveryImages.length]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
