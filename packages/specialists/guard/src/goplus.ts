import { createLogger } from "@clawd/core";

const log = createLogger("guard:goplus");

export interface EvmTokenSecurity {
  is_honeypot?: string;
  is_mintable?: string;
  is_open_source?: string;
  owner_address?: string;
  hidden_owner?: string;
  can_take_back_ownership?: string;
  buy_tax?: string;
  sell_tax?: string;
  holder_count?: string;
  lp_holders?: Array<{ address: string; percent: string; is_locked: number }>;
}

export interface SolanaTokenSecurity {
  mintable?: { status: string };
  freezable?: { status: string };
  balance_mutable_authority?: { status: string };
  closable?: { status: string };
  top10_holder_rate?: string;
}

/**
 * EVM chain IDs GoPlus expects. Mainnet only (little/no testnet coverage),
 * and only for chains GoPlus actually indexes — Monad and Robinhood Chain
 * are too new/niche to have an entry, so they're absent rather than guessed.
 */
export const GOPLUS_EVM_CHAIN_IDS: Partial<Record<"ethereum" | "bsc" | "base" | "monad" | "robinhood", number>> = {
  ethereum: 1,
  bsc: 56,
  base: 8453,
};

/** Free, keyless token-security lookup (GoPlus Security API) for EVM chains. Null if unavailable. */
export async function getEvmTokenSecurity(
  chainId: number | undefined,
  tokenAddress: string,
): Promise<EvmTokenSecurity | null> {
  if (chainId === undefined) return null;
  try {
    const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { code: number; result?: Record<string, EvmTokenSecurity> };
    if (data.code !== 1 || !data.result) return null;
    return data.result[tokenAddress.toLowerCase()] ?? null;
  } catch (err) {
    log.warn({ err, chainId, tokenAddress }, "GoPlus EVM lookup failed");
    return null;
  }
}

/** Free, keyless token-security lookup (GoPlus Security API) for Solana. Null if unavailable. */
export async function getSolanaTokenSecurity(tokenAddress: string): Promise<SolanaTokenSecurity | null> {
  try {
    const url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${tokenAddress}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { code: number; result?: Record<string, SolanaTokenSecurity> };
    if (data.code !== 1 || !data.result) return null;
    return data.result[tokenAddress] ?? null;
  } catch (err) {
    log.warn({ err, tokenAddress }, "GoPlus Solana lookup failed");
    return null;
  }
}
