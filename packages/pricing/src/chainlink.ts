import { createPublicClient, http } from "viem";
import { mainnet, bsc, base } from "viem/chains";
import { loadConfig, createLogger } from "@clawd/core";

const log = createLogger("pricing:chainlink");

const AGGREGATOR_V3_ABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

type ChainlinkChain = "ethereum" | "bsc" | "base";
type ChainlinkPair = "ETH/USD" | "BTC/USD" | "BNB/USD";

/**
 * Chainlink price feed addresses, mainnet only. Widely-reused constants, but
 * verify against https://docs.chain.link/data-feeds/price-feeds/addresses
 * before trusting them with real size — this session couldn't fetch
 * Chainlink's docs live to double-check (network access is blocked here).
 */
const FEED_ADDRESSES: Partial<Record<ChainlinkChain, Partial<Record<ChainlinkPair, `0x${string}`>>>> = {
  ethereum: {
    "ETH/USD": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    "BTC/USD": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  },
  bsc: {
    "BNB/USD": "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
  },
  base: {
    "ETH/USD": "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  },
};

function rpcFor(chain: ChainlinkChain) {
  const cfg = loadConfig();
  switch (chain) {
    case "ethereum":
      return {
        viemChain: mainnet,
        rpcUrl:
          cfg.ETHEREUM_MAINNET_RPC_URL ||
          (cfg.ALCHEMY_API_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${cfg.ALCHEMY_API_KEY}` : ""),
      };
    case "bsc":
      return { viemChain: bsc, rpcUrl: cfg.QUICKNODE_BSC_URL };
    case "base":
      return { viemChain: base, rpcUrl: cfg.QUICKNODE_BASE_URL };
  }
}

/** Live price for a major asset via a Chainlink on-chain feed (mainnet only). Null if unavailable. */
export async function getChainlinkPrice(chain: ChainlinkChain, pair: ChainlinkPair): Promise<number | null> {
  const address = FEED_ADDRESSES[chain]?.[pair];
  if (!address) return null;

  const { viemChain, rpcUrl } = rpcFor(chain);
  if (!rpcUrl) return null;

  try {
    const client = createPublicClient({ chain: viemChain, transport: http(rpcUrl) });
    const [decimals, roundData] = await Promise.all([
      client.readContract({ address, abi: AGGREGATOR_V3_ABI, functionName: "decimals" }),
      client.readContract({ address, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" }),
    ]);
    const answer = roundData[1];
    return Number(answer) / 10 ** decimals;
  } catch (err) {
    log.warn({ err, chain, pair }, "Chainlink feed read failed");
    return null;
  }
}
