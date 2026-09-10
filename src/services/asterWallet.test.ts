import { describe, expect, it } from "vitest";
import {
  COSMETICS_RELEASE_GIFT_AMOUNT,
  claimCosmeticsReleaseGift,
  loadAsterWallet,
} from "./asterWallet";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("Aster wallet", () => {
  it("awards the cosmetics release gift once per account", () => {
    const storage = createMemoryStorage();

    const first = claimCosmeticsReleaseGift("player-one", storage);
    const second = claimCosmeticsReleaseGift("player-one", storage);

    expect(first.claimed).toBe(true);
    expect(first.wallet.balance).toBe(COSMETICS_RELEASE_GIFT_AMOUNT);
    expect(second.claimed).toBe(false);
    expect(second.wallet.balance).toBe(COSMETICS_RELEASE_GIFT_AMOUNT);
  });

  it("keeps wallets separate for different Minecraft accounts", () => {
    const storage = createMemoryStorage();
    claimCosmeticsReleaseGift("player-one", storage);

    expect(loadAsterWallet("player-one", storage).balance).toBe(1_000);
    expect(loadAsterWallet("player-two", storage).balance).toBe(0);
  });
});
