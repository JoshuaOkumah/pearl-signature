import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { CartProvider } from "@/lib/cart/context";
import { MotionProvider } from "@/components/providers/motion-provider";
import { SiteChrome } from "@/components/layout/site-chrome";
import { siteUrl } from "@/lib/site-url";
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

const site = siteUrl();
const SITE_TITLE = "CLIVS · Authentic Nigerian Cuisine, Made Beautifully";
const SITE_DESCRIPTION =
  "CLIVS is a Canadian online kitchen offering authentic Nigerian soups and classics, pastries, snacks and traditional drinks, available to order online for pickup, or delivery where the kitchen delivers.";
const SHARE_IMAGE = "/brand/clivs-og.png";

export const metadata: Metadata = {
  // Only advertised when NEXT_PUBLIC_SITE_URL is configured — never invent a domain.
  ...(site ? { metadataBase: new URL(site) } : {}),
  title: {
    default: SITE_TITLE,
    template: "%s · CLIVS",
  },
  description: SITE_DESCRIPTION,
  applicationName: "CLIVS",
  openGraph: {
    type: "website",
    siteName: "CLIVS",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: "CLIVS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

export const viewport: Viewport = {
  themeColor: "#FAFAF5",
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
