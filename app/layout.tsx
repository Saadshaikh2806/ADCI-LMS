import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import Script from "next/script";
import "@zoom/meetingsdk/dist/ui/zoom-meetingsdk.css";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-body" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "ADCI Learning Hub",
  description: "Your learning, classes, assessments and progress in one place."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
      </head>
      <body className={`${dmSans.variable} ${manrope.variable}`}>
        {children}
        <div id="zmmtg-root" style={{ display: "none" }} />
      </body>
    </html>
  );
}
