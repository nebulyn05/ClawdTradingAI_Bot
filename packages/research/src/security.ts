import { Connection, PublicKey } from "@solana/web3.js";
import { getSolanaTokenSecurity } from "@clawd/guard";
import type { MarketObservation } from "./types.js";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export interface SolanaSecurityEnrichment {
  top10HolderPct?: number;
  holderCount?: number;
  rugIndicators: string[];
  mintAuthorityPresent?: boolean;
  freezeAuthorityPresent?: boolean;
}

function pct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

async function inspectMint(tokenAddress: string): Promise<Pick<SolanaSecurityEnrichment, "mintAuthorityPresent" | "freezeAuthorityPresent" | "top10HolderPct">> {
  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC, "confirmed");
  const mint = new PublicKey(tokenAddress);

  const [account, supply, largest] = await Promise.all([
    connection.getParsedAccountInfo(mint),
    connection.getTokenSupply(mint),
    connection.getTokenLargestAccounts(mint),
  ]);

  const parsed = account.value?.data;
  if (!parsed || typeof parsed !== "object" || !("parsed" in parsed)) {
    return {};
  }

  const info = (parsed as { parsed?: { info?: { mintAuthority?: string | null; freezeAuthority?: string | null } } }).parsed?.info;
  const total = Number(supply.value.uiAmount ?? 0);
  const top10 = largest.value.slice(0, 10).reduce((sum, item) => sum + Number(item.uiAmount ?? 0), 0);

  return {
    mintAuthorityPresent: Boolean(info?.mintAuthority),
    freezeAuthorityPresent: Boolean(info?.freezeAuthority),
    top10HolderPct: total > 0 ? pct((top10 / total) * 100) : undefined,
  };
}

export async function enrichSolanaSecurity(observation: MarketObservation): Promise<MarketObservation> {
  if (observation.chain !== "solana") return observation;

  const indicators: string[] = [...(observation.rugIndicators ?? [])];
  let result: SolanaSecurityEnrichment = { rugIndicators: indicators };

  try {
    const [goPlus, mint] = await Promise.all([
      getSolanaTokenSecurity(observation.tokenAddress),
      inspectMint(observation.tokenAddress),
    ]);

    const top10Raw = Number(goPlus?.top10_holder_rate ?? NaN);
    const top10GoPlus = Number.isFinite(top10Raw) ? pct(top10Raw * 100) : undefined;
    const top10HolderPct = mint.top10HolderPct ?? top10GoPlus;

    if (mint.mintAuthorityPresent === true || goPlus?.mintable?.status === "1") {
      indicators.push("mint_authority_present");
    }
    if (mint.freezeAuthorityPresent === true || goPlus?.freezable?.status === "1") {
      indicators.push("freeze_authority_present");
    }
    if (goPlus?.balance_mutable_authority?.status === "1") {
      indicators.push("balance_mutable_authority");
    }
    if (goPlus?.closable?.status === "1") {
      indicators.push("token_account_closable");
    }
    if (top10HolderPct !== undefined && top10HolderPct >= 50) {
      indicators.push("top10_holder_concentration_high");
    }

    result = {
      top10HolderPct,
      rugIndicators: [...new Set(indicators)],
      mintAuthorityPresent: mint.mintAuthorityPresent,
      freezeAuthorityPresent: mint.freezeAuthorityPresent,
    };
  } catch {
    // Security enrichment must never make the collector crash. Guard remains
    // the hard safety gate for execution.
    result = { rugIndicators: [...new Set(indicators)] };
  }

  return {
    ...observation,
    top10HolderPct: result.top10HolderPct ?? observation.top10HolderPct,
    rugIndicators: result.rugIndicators,
  };
}
