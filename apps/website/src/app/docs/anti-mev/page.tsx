import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_anti_mev_content } from "@/content/docs-anti-mev";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_anti_mev_content }} />
    </ScrollReveal>
  );
}
