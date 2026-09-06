import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_safety_content } from "@/content/docs-safety";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_safety_content }} />
    </ScrollReveal>
  );
}
