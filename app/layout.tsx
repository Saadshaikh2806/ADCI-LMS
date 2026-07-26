import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-body" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "ADCI Learning Hub",
  description: "Your learning, classes, assessments and progress in one place."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${manrope.variable}`}>{children}</body>
    </html>
  );
}
