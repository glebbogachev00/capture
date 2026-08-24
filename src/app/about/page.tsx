import type { Metadata } from "next";
import { Landing } from "@/app/Landing";

export const metadata: Metadata = {
  title: "capture · notes, before they rot",
  description:
    "Your notes app became a junk drawer. Capture catches the thought before it becomes a pile — say it messy, it comes back with a shape.",
};

export default function AboutPage() {
  return <Landing />;
}
