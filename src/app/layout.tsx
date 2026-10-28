import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Echo Lab · Research, grounded",
  description:
    "A private research workspace for thoughtful interviews and source-backed findings.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
