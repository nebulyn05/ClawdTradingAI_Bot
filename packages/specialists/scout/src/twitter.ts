import { loadConfig, createLogger } from "@clawd/core";

const log = createLogger("scout:twitter");

export interface TwitterUser {
  id: string;
  username: string;
}

export interface Tweet {
  id: string;
  text: string;
  created_at?: string;
}

const API_BASE = "https://api.twitter.com/2";

async function xFetch<T>(path: string): Promise<T | null> {
  const { TWITTER_BEARER_TOKEN } = loadConfig();
  if (!TWITTER_BEARER_TOKEN) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
    });
    if (!res.ok) {
      log.warn({ status: res.status, path }, "X API request failed");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.warn({ err, path }, "X API request threw");
    return null;
  }
}

/** Resolves @handles to their numeric X user IDs (required for the tweets-lookup endpoint). */
export async function resolveHandles(handles: string[]): Promise<TwitterUser[]> {
  if (handles.length === 0) return [];
  const data = await xFetch<{ data?: TwitterUser[] }>(`/users/by?usernames=${handles.join(",")}`);
  return data?.data ?? [];
}

/** Recent tweets for a user, newest first. `sinceId` excludes anything already seen. */
export async function getRecentTweets(userId: string, sinceId?: string): Promise<Tweet[]> {
  const params = new URLSearchParams({ max_results: "5", "tweet.fields": "created_at" });
  if (sinceId) params.set("since_id", sinceId);
  const data = await xFetch<{ data?: Tweet[] }>(`/users/${userId}/tweets?${params.toString()}`);
  return data?.data ?? [];
}
