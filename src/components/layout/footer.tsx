import Link from "next/link";
import { cacheLife } from "next/cache";
import { categories } from "@/data/categories";
import { navItems } from "@/data/navigation";
import { Wordmark } from "@/components/shared/wordmark";

/**
 * The copyright year is computed once at build time and cached into the
 * static shell (Cache Components guards `new Date()` during prerendering).
 */
async function CopyrightYear() {
  "use cache";
  cacheLife("weeks");
  return <>{new Date().getFullYear()}</>;
}

export function Footer() {
  return (
    <footer className="bg-navy text-cream/75">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 md:px-8">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Wordmark tone="cream" />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-cream/70">
              PEARL Signature is a Canadian online kitchen celebrating authentic Nigerian cuisine, from
              traditional soups and classics to golden pastries and refreshing drinks, prepared with care
              and ordered online.
            </p>
          </div>

          <nav aria-label="Footer, explore">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-cream">Explore</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {navItems.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="focus-gold rounded-sm transition-colors hover:text-cream">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/#how-ordering" className="focus-gold rounded-sm transition-colors hover:text-cream">
                  How ordering works
                </Link>
              </li>
              <li>
                <Link href="/#faq" className="focus-gold rounded-sm transition-colors hover:text-cream">
                  FAQ
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Footer, the menu">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-cream">The Menu</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`/menu?category=${category.slug}`}
                    className="focus-gold rounded-sm transition-colors hover:text-cream"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-cream/15 pt-6 text-xs text-cream/55 md:flex-row md:items-center md:justify-between">
          <p>
            © <CopyrightYear /> PEARL Signature. All rights reserved.
          </p>
          <p>Verified contact and social details will be published before launch.</p>
        </div>
      </div>
    </footer>
  );
}
