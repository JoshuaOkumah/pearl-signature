import { BrandStory } from "@/components/home/brand-story";
import { Categories } from "@/components/home/categories";
import { ClosingCta } from "@/components/home/closing-cta";
import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { HowOrderingWorks } from "@/components/home/how-ordering-works";
import { FeaturedFavourites } from "@/components/home/featured-favourites";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Categories />
      <FeaturedFavourites />
      <BrandStory />
      <HowOrderingWorks />
      <ClosingCta />
      <Faq />
    </>
  );
}
