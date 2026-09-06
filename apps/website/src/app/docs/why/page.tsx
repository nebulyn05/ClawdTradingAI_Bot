import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_why_content } from "@/content/docs-why";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_why_content }} />
    </ScrollReveal>
  );
}
