import type { Metadata } from "next";
import { Suspense } from "react";
import AdminConsole from "@/components/admin/AdminConsole";

export const metadata: Metadata = {
  title: "Admin console - AskUoC",
  description: "Manage the AskUoC assistant: monitor health, update knowledge, tune settings and back up data.",
  robots: { index: false, follow: false }, // staff-only tool: keep it out of search results
};

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminConsole />
    </Suspense>
  );
}
