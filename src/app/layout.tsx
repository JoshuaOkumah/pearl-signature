import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { CartProvider } from "@/lib/cart/context";
import { MotionProvider } from "@/components/providers/motion-provider";
import { SiteChrome } from "@/components/layout/site-chrome";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PEARL Signature · Authentic Nigerian Cuisine, Made Beautifully",
    template: "%s · PEARL Signature",
  },
  description:
    "PEARL Signature is a Canadian online kitchen offering authentic Nigerian soups and classics, pastries, snacks and traditional drinks, available to order online for delivery or arranged pickup.",
};

export const viewport: Viewport = {
  themeColor: "#FDFBF7",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${manrope.variable}`}>
      <body className="flex min-h-dvh flex-col bg-cream font-sans text-navy">
        <MotionProvider>
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <CartProvider>
            <SiteChrome header={<Header />} footer={<Footer />}>
              <main id="main-content" className="flex-1">
                {children}
              </main>
            </SiteChrome>
          </CartProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
