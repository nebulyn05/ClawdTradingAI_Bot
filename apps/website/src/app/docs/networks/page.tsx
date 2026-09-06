import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_networks_content } from "@/content/docs-networks";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_networks_content }} />
    </ScrollReveal>
  );
}
