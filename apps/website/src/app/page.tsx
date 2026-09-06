import { Header } from "@/components/Header";
import { ScrollReveal } from "@/components/ScrollReveal";
import { homeContent } from "@/content/home-content";

export default function HomePage() {
  return (
    <>
      <Header />
      <ScrollReveal>
        <div
          className="site-fade-in"
          dangerouslySetInnerHTML={{ __html: homeContent }}
        />
      </ScrollReveal>
    </>
  );
}
