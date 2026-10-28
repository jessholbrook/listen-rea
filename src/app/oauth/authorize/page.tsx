import type { Metadata } from "next";
import Consent from "./consent";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connect a research tool · Echo Lab",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Authorize() {
  return <Consent />;
}
