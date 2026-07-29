import { loadConfig, eventBus, createLogger } from "@clawd/core";
import { detectChainForToken } from "@clawd/pricing";
import { resolveHandles, getRecentTweets } from "./twitter.js";
import { interpretTweet } from "./interpret.js";

const log = createLogger("scout:kol");

const MIN_CONVICTION = 0.5;

/**
 * Polls each configured KOL's recent tweets, interprets them with an LLM
 * (packages/ai — a no-op when AI features are disabled), and emits
 * `scout.kolSignal` for any bullish, high-conviction call whose contract
 * address resolves to one of our supported chains. Requires both
 * TWITTER_BEARER_TOKEN and KOL_TWITTER_HANDLES — logs and no-ops if either
 * is missing rather than failing the whole worker process.
 */
export function startKolTracking(): () => void {
  const cfg = loadConfig();
  const handles = cfg.KOL_TWITTER_HANDLES.split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (handles.length === 0 || !cfg.TWITTER_BEARER_TOKEN) {
    log.info("KOL tracking not configured (no handles and/or bearer token) — skipping");
    return () => {};
  }

  const lastSeenId = new Map<string, string>();
  let stopped = false;

  const tick = async () => {
    const users = await resolveHandles(handles);
    for (const user of users) {
      if (stopped) return;
      try {
        const tweets = await getRecentTweets(user.id, lastSeenId.get(user.id));
        if (tweets.length === 0) continue;
        lastSeenId.set(user.id, tweets[0]!.id); // API returns newest first

        for (const tweet of tweets) {
          const interpretation = await interpretTweet(tweet.text);
          if (!interpretation?.contractAddress) continue;
          if (interpretation.sentiment !== "bullish" || interpretation.conviction < MIN_CONVICTION) continue;

          const chain = await detectChainForToken(interpretation.contractAddress).catch(() => null);
          if (!chain) {
            log.info(
              { handle: user.username, tokenAddress: interpretation.contractAddress },
              "KOL call — couldn't resolve a supported chain, skipping",
            );
            continue;
          }

          eventBus.emit("scout.kolSignal", {
            chain,
            tokenAddress: interpretation.contractAddress,
            handle: user.username,
            sentiment: interpretation.sentiment,
            conviction: interpretation.conviction,
            tweetText: tweet.text,
            detectedAt: Date.now(),
          });
        }
      } catch (err) {
        log.warn({ err, handle: user.username }, "Failed to process tweets for handle");
      }
    }
  };

  const timer = setInterval(() => {
    tick().catch((err) => log.error({ err }, "KOL tracking tick failed"));
  }, cfg.TWITTER_POLL_INTERVAL_MS);
  void tick(); // run once immediately rather than waiting a full interval

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
