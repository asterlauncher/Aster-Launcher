import {
  AlertCircle,
  Check,
  FolderOpen,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../store/AppStore";
import type { GameInstance } from "../types/launcher";

function LibraryInstance({ instance }: { instance: GameInstance }) {
  const { updateInstance, notify, openModal } = useAppStore();

  const play = () => {
    if (instance.status === "failed") {
      openModal("installation-failure");
      return;
    }
    updateInstance(instance.id, { status: "launching" });
    window.setTimeout(() => {
      updateInstance(instance.id, { status: "ready" });
      notify({
        title: `${instance.name} started`,
        message: "The game process is running.",
        tone: "success",
      });
    }, 1500);
  };

  return (
    <article className={`instance-tile-card state-${instance.status}`}>
      <div className="instance-thumbnail">
        <img src="/placeholders/instance.svg" alt="" />
        <span>{instance.version}</span>
        <button type="button" aria-label={`${instance.name} options`}>
          <MoreHorizontal size={17} />
        </button>
      </div>
      <div className="instance-tile-content">
        <div>
          <h2>{instance.name}</h2>
          <p>
            {instance.loader} · {instance.mods} mods
          </p>
        </div>
        <div className="instance-tile-actions">
          <button
            type="button"
            className="instance-folder"
            aria-label={`Open ${instance.name} folder`}
          >
            <FolderOpen size={15} />
          </button>
          <button
            type="button"
            className={
              instance.status === "failed"
                ? "instance-error-button"
                : "instance-play-button"
            }
            onClick={play}
            disabled={
              instance.status === "launching" ||
              instance.status === "updating"
            }
          >
            {instance.status === "failed" ? (
              <>
                <AlertCircle size={14} />
                Error
              </>
            ) : instance.status === "updating" ? (
              <>Updating {instance.progress}%</>
            ) : instance.status === "launching" ? (
              <>Launching…</>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                Play
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

export function LibraryPage() {
  const { instances, emptyLibrary, setEmptyLibrary, notify } = useAppStore();
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      instances.filter((instance) =>
        instance.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [instances, query],
  );

  return (
    <div className="compact-page">
      <header className="compact-page-header">
        <div>
          <h1>Instances</h1>
          <p>{instances.length} local Minecraft installations</p>
        </div>
        <button
          type="button"
          className="purple-action"
          onClick={() =>
            notify({
              title: "New instance",
              message: "Instance creation is ready for native backend wiring.",
              tone: "info",
            })
          }
        >
          <Plus size={16} />
          New Instance
        </button>
      </header>

      <div className="compact-toolbar">
        <label>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search instances"
          />
        </label>
        <button type="button">
          <SlidersHorizontal size={15} />
          Filter
        </button>
        <button
          type="button"
          className="toolbar-text-action"
          onClick={() => setEmptyLibrary(!emptyLibrary)}
        >
          {emptyLibrary ? "Restore library" : "Preview empty"}
        </button>
      </div>

      {emptyLibrary || filtered.length === 0 ? (
        <div className="launcher-empty-state">
          <span>
            <Check size={24} />
          </span>
          <h2>{query ? "No matching instances" : "No instances installed"}</h2>
          <p>Create a profile or install a modpack to begin.</p>
          <button type="button" className="purple-action">
            <Plus size={15} /> Create Instance
          </button>
        </div>
      ) : (
        <div className="instance-tile-grid">
          {filtered.map((instance) => (
            <LibraryInstance key={instance.id} instance={instance} />
          ))}
        </div>
      )}
    </div>
  );
}
