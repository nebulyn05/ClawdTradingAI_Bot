import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_protection_content } from "@/content/docs-protection";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_protection_content }} />
    </ScrollReveal>
  );
}
