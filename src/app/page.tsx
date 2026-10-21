import { BrandStory } from "@/components/home/brand-story";
import { Categories } from "@/components/home/categories";
import { ClosingCta } from "@/components/home/closing-cta";
import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { HowOrderingWorks } from "@/components/home/how-ordering-works";
import { SignatureFavourites } from "@/components/home/signature-favourites";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Categories />
      <SignatureFavourites />
      <BrandStory />
      <HowOrderingWorks />
      <ClosingCta />
      <Faq />
    </>
  );
}
