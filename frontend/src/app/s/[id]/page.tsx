import type { Metadata } from "next";
import SharedChat from "@/components/SharedChat";

export const metadata: Metadata = {
  title: "Shared conversation",
  robots: { index: false, follow: false }, // shared snapshots are for people with the link
};

export default function SharedPage() {
  return <SharedChat />;
}
