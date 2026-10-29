import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: [
    { path: "./fonts/Inter-Regular.otf", weight: "400" },
    { path: "./fonts/Inter-Medium.otf", weight: "500" },
    { path: "./fonts/Inter-SemiBold.otf", weight: "600" },
    { path: "./fonts/Inter-Bold.otf", weight: "700" },
    { path: "./fonts/Inter-ExtraBold.otf", weight: "800" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "BLINK Academy", template: "%s · BLINK Academy" },
  description: "Controle de treinamentos POD e PNR — BLINK Logística Inteligente",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#006080" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
