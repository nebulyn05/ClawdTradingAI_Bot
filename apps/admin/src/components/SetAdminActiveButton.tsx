"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAdminActiveAction } from "@/lib/actions";

export function SetAdminActiveButton({
  adminUserId,
  active,
  username,
}: {
  adminUserId: string;
  active: boolean;
  username: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className={active ? "btn btn-danger" : "btn btn-secondary"}
      disabled={pending}
      onClick={async () => {
        if (active && !window.confirm(`Deactivate ${username}? They'll be signed out and unable to log in again until reactivated.`)) {
          return;
        }
        setPending(true);
        try {
          await setAdminActiveAction(adminUserId, !active);
          router.refresh();
        } catch (err) {
          window.alert(err instanceof Error ? err.message : "Failed");
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "…" : active ? "Deactivate" : "Reactivate"}
    </button>
  );
}
