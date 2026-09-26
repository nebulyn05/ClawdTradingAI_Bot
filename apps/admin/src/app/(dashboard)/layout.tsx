import { requireAdminSession } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminSession();

  return (
    <div className="min-h-screen md:flex">
      <Sidebar session={session} />
      <div className="min-w-0 flex-1 pt-16 md:pt-0">{children}</div>
    </div>
  );
}
