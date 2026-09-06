import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_funding_content } from "@/content/docs-funding";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_funding_content }} />
    </ScrollReveal>
  );
}
