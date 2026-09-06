import { requireAdminSession } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminSession();

  return (
    <div className="flex min-h-screen">
      <Sidebar session={session} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
