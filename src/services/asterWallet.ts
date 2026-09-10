export const COSMETICS_RELEASE_GIFT_ID = "cosmetics-release-gift-v1";
export const COSMETICS_RELEASE_GIFT_AMOUNT = 1_000;

export interface AsterWallet {
  balance: number;
  claimedRewardIds: string[];
  updatedAt: string | null;
}

const WALLET_STORAGE_PREFIX = "aster-launcher.wallet.v1";

export const emptyAsterWallet: AsterWallet = {
  balance: 0,
  claimedRewardIds: [],
  updatedAt: null,
};

function walletStorageKey(accountId: string) {
  return `${WALLET_STORAGE_PREFIX}:${encodeURIComponent(accountId)}`;
}

function getDefaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function normalizeWallet(value: unknown): AsterWallet {
  if (!value || typeof value !== "object") return { ...emptyAsterWallet };

  const candidate = value as Partial<AsterWallet>;
  const balance =
    typeof candidate.balance === "number" &&
    Number.isFinite(candidate.balance) &&
    candidate.balance >= 0
      ? Math.floor(candidate.balance)
      : 0;
  const claimedRewardIds = Array.isArray(candidate.claimedRewardIds)
    ? [...new Set(candidate.claimedRewardIds.filter((id): id is string => typeof id === "string"))]
    : [];

  return {
    balance,
    claimedRewardIds,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
  };
}

export function loadAsterWallet(
  accountId: string,
  storage: Storage | null = getDefaultStorage(),
): AsterWallet {
  if (!accountId || !storage) return { ...emptyAsterWallet };

  try {
    return normalizeWallet(
      JSON.parse(storage.getItem(walletStorageKey(accountId)) ?? "null"),
    );
  } catch {
    return { ...emptyAsterWallet };
  }
}

export function hasClaimedCosmeticsReleaseGift(wallet: AsterWallet) {
  return wallet.claimedRewardIds.includes(COSMETICS_RELEASE_GIFT_ID);
}

export function claimCosmeticsReleaseGift(
  accountId: string,
  storage: Storage | null = getDefaultStorage(),
): { claimed: boolean; wallet: AsterWallet } {
  const current = loadAsterWallet(accountId, storage);
  if (!accountId || hasClaimedCosmeticsReleaseGift(current)) {
    return { claimed: false, wallet: current };
  }

  const wallet: AsterWallet = {
    balance: current.balance + COSMETICS_RELEASE_GIFT_AMOUNT,
    claimedRewardIds: [
      ...current.claimedRewardIds,
      COSMETICS_RELEASE_GIFT_ID,
    ],
    updatedAt: new Date().toISOString(),
  };

  storage?.setItem(walletStorageKey(accountId), JSON.stringify(wallet));
  return { claimed: true, wallet };
}
