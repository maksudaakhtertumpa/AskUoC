import type { Metadata } from "next";
import ProfileView from "@/components/ProfileView";

export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };

export default function ProfilePage() {
  return <ProfileView />;
}
