import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_content } from "@/content/docs";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_content }} />
    </ScrollReveal>
  );
}
