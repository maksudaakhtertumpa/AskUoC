import { Activity, ClipboardCheck, Database, History, LifeBuoy, Settings2, Users, type LucideIcon } from "lucide-react";

export type TabId = "overview" | "data" | "quality" | "settings" | "users" | "snapshots" | "audit";
export type TabDef = { id: TabId; label: string; icon: LucideIcon; admin: boolean };

/** Which console sections exist, and which role can use them (the server enforces the same rules). */
export const TABS: TabDef[] = [
  { id: "overview", label: "Overview", icon: Activity, admin: false },
  { id: "data", label: "Data", icon: Database, admin: false },
  { id: "quality", label: "Quality", icon: ClipboardCheck, admin: false },
  { id: "settings", label: "Settings", icon: Settings2, admin: true },
  { id: "users", label: "Users", icon: Users, admin: true },
  { id: "snapshots", label: "Snapshots", icon: LifeBuoy, admin: true },
  { id: "audit", label: "Audit", icon: History, admin: true },
];

export const isTabId = (v: string | null): v is TabId => TABS.some((t) => t.id === v);
