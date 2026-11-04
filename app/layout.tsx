import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { LucideProvider } from "lucide-react";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import "./globals.css";

// Self-hosted by next/font; globals.css points --font-heading and --font-body at this variable.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "Spector",
  description: "UX journey predictor powered by AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add body attributes before hydration. */}
      <body suppressHydrationWarning className="bg-neutral-100 text-neutral-800 font-body antialiased min-h-screen flex flex-col">
        {/* The only place Lucide's stroke width is set: Paper draws 1px, Lucide ships 2, 1.5 was agreed. */}
        <LucideProvider strokeWidth={1.5}>
          <SiteHeader />
          {/* Column layout so a screen can fill the height between header and footer (mobile Loading). */}
          <main className="flex-1 w-full max-w-content mx-auto flex flex-col">
            {children}
          </main>
          <SiteFooter />
        </LucideProvider>
      </body>
    </html>
  );
}
