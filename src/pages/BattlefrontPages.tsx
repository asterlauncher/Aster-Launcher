import {
  Boxes,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  Gamepad2,
  Globe2,
  Layers3,
  LockKeyhole,
  PackageOpen,
  Play,
  Puzzle,
  RadioTower,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAppStore } from "../store/AppStore";
import type { PageId } from "../types/launcher";

const homeCards: Array<{
  image: string;
  category: string;
  title: string;
  page: PageId;
}> = [
  {
    image: "/assets/battlefront-mods.png",
    category: "MOD SUPPORT",
    title: "Discover and manage Frostbite mods",
    page: "mods",
  },
  {
    image: "/assets/battlefront-collections.png",
    category: "COLLECTIONS",
    title: "Share one synchronized mod setup",
    page: "modpacks",
  },
  {
    image: "/assets/battlefront-multiplayer.png",
    category: "KYBER MULTIPLAYER",
    title: "Play modded matches with friends",
    page: "store",
  },
  {
    image: "/assets/battlefront-servers.png",
    category: "COMMUNITY SERVERS",
    title: "Browse private and dedicated servers",
    page: "store",
  },
  {
    image: "/assets/battlefront-vanilla.png",
    category: "SAFE LAUNCH",
    title: "Keep official multiplayer vanilla",
    page: "mods",
  },
];

const previewMods = [
  { name: "Battlefront Plus", type: "Gameplay overhaul", status: "Collection ready" },
  { name: "Instant Action Overhaul", type: "Offline expansion", status: "Compatible" },
  { name: "Cinematic Lighting", type: "Visual preset", status: "Cosmetic" },
];

const previewServers = [
  { name: "Aster Friends Night", mode: "Galactic Assault · Modded", players: "8 / 40", ping: "PRIVATE" },
  { name: "KYBER Conquest EU", mode: "Conquest · Battlefront Plus", players: "31 / 40", ping: "24/7" },
  { name: "Heroes Unleashed", mode: "Heroes vs Villains", players: "6 / 16", ping: "COMMUNITY" },
];

function ComingSoonBadge() {
  return <span className="battlefront-coming-soon"><Sparkles size={12} /> COMING SOON</span>;
}

function PreviewHeader({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <header className="sprocket-page-header battlefront-page-header">
      <div>
        <span className="battlefront-header-kicker">{icon} STAR WARS BATTLEFRONT II</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div>
        <ComingSoonBadge />
        <button type="button" className="mc-button" disabled>
          <Download size={14} /> NOT AVAILABLE YET
        </button>
      </div>
    </header>
  );
}

export function BattlefrontHomePage() {
  const { setPage } = useAppStore();

  return (
    <div className="launcher-home battlefront-home">
      <section className="home-feature-row battlefront-home-feature-row">
        <div className="featured-game battlefront-featured-game">
          <img
            src="/assets/battlefront-hero.png"
            alt=""
            className="featured-background battlefront-featured-background"
          />
          <div className="featured-shade" />
          <div className="featured-content">
            <span className="battlefront-kicker"><Gamepad2 size={14} /> ASTER GAME PREVIEW</span>
            <h1>Battlefront II</h1>
            <span className="featured-badge">Coming Soon</span>
            <p>
              Build mod collections, keep load orders synchronized and play
              private modded multiplayer through KYBER—all from Aster.
            </p>
            <div className="launch-controls">
              <button type="button" className="launch-button battlefront-launch" disabled>
                <Play size={17} fill="currentColor" />
                <span>COMING SOON<small>PREVIEW AVAILABLE NOW</small></span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="home-news-panel battlefront-feature-cards">
        <div className="news-track" aria-label="Battlefront II planned features">
          <div className="news-marquee-track">
            {[...homeCards, ...homeCards].map((item, index) => (
              <article
                className="compact-news-card"
                key={`${item.category}-${index}`}
                aria-hidden={index >= homeCards.length}
              >
                <div className="compact-news-image battlefront-card-art">
                  <img src={item.image} alt="" />
                  <span>{item.category}</span>
                </div>
                <div className="compact-news-copy">
                  <h3>{item.title}</h3>
                  <button
                    type="button"
                    tabIndex={index >= homeCards.length ? -1 : 0}
                    aria-label={`Preview ${item.title}`}
                    onClick={() => setPage(item.page)}
                  >
                    <ExternalLink size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function BattlefrontModsPage() {
  return (
    <div className="sprocket-page battlefront-page">
      <PreviewHeader
        title="Mods"
        description="The planned scan-first browser for Battlefront II mods."
        icon={<Puzzle size={15} />}
      />

      <section className="battlefront-showcase">
        <div className="battlefront-showcase-art">
          <img src="/assets/battlefront-mods.png" alt="" />
          <div><ComingSoonBadge /><h2>One clean mod workspace</h2><p>Aster will handle imports, compatibility and launch preparation.</p></div>
        </div>
        <div className="battlefront-plan-list">
          <article><ShieldCheck size={20} /><span><strong>Scan before install</strong><small>Quarantine and inspect every downloaded archive.</small></span></article>
          <article><Layers3 size={20} /><span><strong>Conflict detection</strong><small>Warn about duplicated bundles and incompatible load orders.</small></span></article>
          <article><Globe2 size={20} /><span><strong>Nexus discovery</strong><small>Browse compatible releases without leaving Aster.</small></span></article>
        </div>
      </section>

      <section className="battlefront-preview-panel">
        <header><span><Puzzle size={15} /> MOD LIBRARY PREVIEW</span><small>CONTROLS DISABLED</small></header>
        <div className="battlefront-preview-list">
          {previewMods.map((mod) => (
            <article key={mod.name}>
              <span className="battlefront-row-icon"><PackageOpen size={19} /></span>
              <span><strong>{mod.name}</strong><small>{mod.type}</small></span>
              <em>{mod.status}</em>
              <button type="button" className="mc-button" disabled>INSTALL</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function BattlefrontCollectionsPage() {
  return (
    <div className="sprocket-page battlefront-page">
      <PreviewHeader
        title="Mod Collections"
        description="Create one compatible setup and keep every friend synchronized."
        icon={<Boxes size={15} />}
      />

      <section className="battlefront-collection-grid">
        <article className="battlefront-collection-hero">
          <img src="/assets/battlefront-collections.png" alt="" />
          <div>
            <ComingSoonBadge />
            <h2>Battlefront Plus Night</h2>
            <p>12 mods · KYBER compatible · Shared with 4 friends</p>
            <button type="button" className="mc-button purple" disabled><Play size={13} /> LAUNCH COLLECTION</button>
          </div>
        </article>
        <aside className="battlefront-stack-preview">
          <header><Layers3 size={16} /><span><strong>LOAD ORDER</strong><small>Automatic dependencies</small></span></header>
          {["Core fixes", "Battlefront Plus", "Custom maps", "UI & audio"].map((name, index) => (
            <div key={name}><b>{String(index + 1).padStart(2, "0")}</b><span>{name}</span><Check size={14} /></div>
          ))}
        </aside>
      </section>

      <section className="battlefront-capability-grid">
        <article><Users size={21} /><strong>Share with friends</strong><p>Invite friends and deliver the exact same collection.</p><button type="button" disabled>PREVIEW ONLY <ChevronRight size={13} /></button></article>
        <article><Download size={21} /><strong>Automatic updates</strong><p>Update every member when the owner publishes a revision.</p><button type="button" disabled>PREVIEW ONLY <ChevronRight size={13} /></button></article>
        <article><ShieldCheck size={21} /><strong>Version lock</strong><p>Prevent mismatched mods before anyone joins the server.</p><button type="button" disabled>PREVIEW ONLY <ChevronRight size={13} /></button></article>
      </section>
    </div>
  );
}

export function BattlefrontMultiplayerPage() {
  return (
    <div className="sprocket-page battlefront-page">
      <PreviewHeader
        title="KYBER Multiplayer"
        description="Private games, community servers and synchronized mods with friends."
        icon={<RadioTower size={15} />}
      />

      <section className="battlefront-multiplayer-layout">
        <div className="battlefront-server-browser">
          <header>
            <span><Server size={16} /><strong>SERVER BROWSER</strong></span>
            <span className="battlefront-live-dot">PLANNED</span>
          </header>
          <div className="battlefront-server-list">
            {previewServers.map((server) => (
              <article key={server.name}>
                <span className="battlefront-server-image"><img src="/assets/battlefront-servers.png" alt="" /></span>
                <span><strong>{server.name}</strong><small>{server.mode}</small></span>
                <em>{server.players}</em>
                <b>{server.ping}</b>
                <button type="button" className="mc-button" disabled>JOIN</button>
              </article>
            ))}
          </div>
        </div>

        <aside className="battlefront-party-card">
          <img src="/assets/battlefront-multiplayer.png" alt="" />
          <div className="battlefront-party-copy">
            <ComingSoonBadge />
            <h2>Private game</h2>
            <p>Invite Aster friends, select a collection and host through KYBER.</p>
            <div><Users size={15} /><span><strong>Your party</strong><small>0 / 40 players</small></span></div>
            <div><LockKeyhole size={15} /><span><strong>Friend-only lobby</strong><small>Password and visibility controls</small></span></div>
            <button type="button" className="mc-button purple" disabled><Gamepad2 size={13} /> CREATE PRIVATE GAME</button>
          </div>
        </aside>
      </section>

      <div className="battlefront-notice">
        <ShieldCheck size={18} />
        <span><strong>Modded matches stay on KYBER</strong><small>A separate vanilla launch will remain available for official EA multiplayer.</small></span>
      </div>
    </div>
  );
}
