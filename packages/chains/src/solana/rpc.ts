import { Connection } from "@solana/web3.js";
import { loadConfig, networkForChain } from "@clawd/core";

export function getSolanaConnection(): Connection {
  const cfg = loadConfig();
  const network = networkForChain("solana");

  if (network === "mainnet") {
    const rpcUrl =
      cfg.SOLANA_MAINNET_RPC_URL ||
      (cfg.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${cfg.HELIUS_API_KEY}` : "");
    if (!rpcUrl) {
      throw new Error(
        "Solana is set to mainnet but neither SOLANA_MAINNET_RPC_URL nor HELIUS_API_KEY is set.",
      );
    }
    return new Connection(rpcUrl, "confirmed");
  }

  return new Connection(cfg.SOLANA_DEVNET_RPC_URL, "confirmed");
}
