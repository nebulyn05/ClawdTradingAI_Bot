import type { Metadata } from "next";
import "./globals.css";
import { FluidCursor } from "@/components/FluidCursor";
import { ImageAutoLoad } from "@/components/ImageAutoLoad";

export const metadata: Metadata = {
  title: "Clawd Agents — autonomous crypto trading agent on Telegram",
  description:
    "Launch the agent. No install, no code. The AI trades across Solana, Ethereum, BSC, Base, Monad, and Robinhood Chain with five built-in specialists: launch sniping, smart money and KOL tracking, rug screening, cross chain arbitrage, and routing.",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased" style={{ background: "var(--background)", color: "var(--foreground)" }}>
        <FluidCursor />
        <ImageAutoLoad />
        {children}
      </body>
    </html>
  );
}
