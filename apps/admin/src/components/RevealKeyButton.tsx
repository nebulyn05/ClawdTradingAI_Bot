"use client";

import { useState } from "react";
import { revealPrivateKeyAction } from "@/lib/actions";

/**
 * Decrypts and displays a wallet's raw private key inline. Every click is
 * logged to KeyAccessLog (see revealPrivateKeyAction) — this bypasses the
 * bot's normal passphrase-gated /export flow entirely, so the confirm dialog
 * and audit trail are the only safeguards left.
 */
export function RevealKeyButton({ walletId }: { walletId: string }) {
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (revealed) {
    return (
      <div className="space-y-1 rounded-lg border border-red-500/40 bg-red-500/10 p-2">
        <div className="break-all font-mono text-xs">{revealed}</div>
        <button type="button" className="btn btn-secondary text-xs" onClick={() => setRevealed(null)}>
          Hide
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={async () => {
          if (
            !window.confirm(
              "This decrypts and displays the user's raw private key, and is logged to the audit trail. Continue?",
            )
          ) {
            return;
          }
          setPending(true);
          setError(null);
          try {
            const result = await revealPrivateKeyAction(walletId);
            setRevealed(result.rawKey);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to decrypt key");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Decrypting…" : "🔑 Reveal key"}
      </button>
      {error ? <div className="mt-1 text-xs text-red-400">{error}</div> : null}
    </div>
  );
}
