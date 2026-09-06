"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteUserAction } from "@/lib/actions";

export function DeleteUserButton({ userId, label }: { userId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-danger"
      disabled={pending}
      onClick={async () => {
        if (
          !window.confirm(
            `Delete ${label}? This permanently deletes their wallets, positions, trades, and fee history. This cannot be undone.`,
          )
        ) {
          return;
        }
        setPending(true);
        await deleteUserAction(userId);
        router.refresh();
      }}
    >
      {pending ? "Deleting…" : "Delete user"}
    </button>
  );
}
