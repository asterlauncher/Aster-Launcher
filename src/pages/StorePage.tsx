import { Sparkles } from "lucide-react";
import { useState } from "react";
import { AsterCreditIcon } from "../components/AsterCreditIcon";
import { useAppStore } from "../store/AppStore";

type StoreTab = "All" | "Cosmetics" | "Emotes" | "LIMITED";

const storeTabs: StoreTab[] = ["All", "Cosmetics", "Emotes", "LIMITED"];

const comingSoonCopy: Record<StoreTab, { title: string; detail: string }> = {
  All: {
    title: "Cosmetics coming soon",
    detail:
      "Capes, emotes and limited drops are still being prepared for closed alpha.",
  },
  Cosmetics: {
    title: "Cosmetics coming soon",
    detail: "Player cosmetics will appear here when the first collection is ready.",
  },
  Emotes: {
    title: "Emotes coming soon",
    detail: "The emote collection is still being polished for a future launcher update.",
  },
  LIMITED: {
    title: "Limited drops coming soon",
    detail: "Closed-alpha rewards and time-limited cosmetics will be announced here.",
  },
};

export function StorePage() {
  const { openModal } = useAppStore();
  const [activeTab, setActiveTab] = useState<StoreTab>("All");
  const copy = comingSoonCopy[activeTab];

  return (
    <div className="cape-store cosmetics-preview-page">
      <header className="cape-store-header cosmetics-preview-header">
        <nav aria-label="Store categories">
          {storeTabs.map((tab) => (
            <button
              type="button"
              key={tab}
              className={[
                activeTab === tab ? "active" : "",
                tab === "LIMITED" ? "limited-store-tab" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setActiveTab(tab)}
            >
              <span>{tab}</span>
              {tab === "LIMITED" && (
                <span className="limited-pixel-stars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="cosmetics-credit-balance"
          onClick={() => openModal("aster-subscription")}
          aria-label="Aster Credits balance: 0 AC"
          title="View Aster Subscription"
        >
          <AsterCreditIcon size={21} />
          <span>
            <strong>0 AC</strong>
            <small>ASTER CREDITS</small>
          </span>
        </button>
      </header>

      <section className="cosmetics-coming-soon" aria-live="polite">
        <div className="cosmetics-coming-soon-icon" aria-hidden="true">
          <Sparkles size={28} strokeWidth={1.6} />
        </div>
        <span className="cosmetics-coming-soon-eyebrow">ASTER COSMETICS</span>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <div className="cosmetics-coming-soon-status">
          <span />
          IN DEVELOPMENT
        </div>
      </section>
    </div>
  );
}
