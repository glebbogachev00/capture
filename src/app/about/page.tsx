import type { Metadata } from "next";
import { Landing } from "@/app/Landing";

export const metadata: Metadata = {
  title: "capture · thoughts that sort themselves",
  description:
    "Say it however it comes out. It lands as something to do, something you're thinking through, or something you're becoming — and when it lands wrong, you tell it once.",
};

export default function AboutPage() {
  return <Landing />;
}
