import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { LucideProvider } from "lucide-react";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import "./globals.css";

// Self-hosted por next/font. El tema (globals.css) apunta a esta variable
// desde --font-heading y --font-body.
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
      {/* suppressHydrationWarning: extensiones del navegador (p. ej. ColorZilla
          con cz-shortcut-listen) añaden atributos al body antes de hidratar.
          Solo afecta a los atributos del propio body, no a sus hijos. */}
      <body suppressHydrationWarning className="bg-neutral-100 text-neutral-800 font-body antialiased min-h-screen flex flex-col">
        {/* Grosor de todos los iconos de Lucide. Paper los dibuja a 1px y
            Lucide trae 2; 1.5 es el punto medio acordado. Único lugar donde
            se define: ningún icono lleva strokeWidth propio. */}
        <LucideProvider strokeWidth={1.5}>
          <SiteHeader />
          {/* Solo ancho máximo y centrado: cada pantalla define su propio
              espaciado. En columna para que una pantalla pueda ocupar el
              alto libre entre header y footer (el Loading en móvil). */}
          <main className="flex-1 w-full max-w-content mx-auto flex flex-col">
            {children}
          </main>
          <SiteFooter />
        </LucideProvider>
      </body>
    </html>
  );
}
