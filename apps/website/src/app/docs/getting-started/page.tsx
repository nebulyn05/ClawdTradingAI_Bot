import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_getting_started_content } from "@/content/docs-getting-started";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_getting_started_content }} />
    </ScrollReveal>
  );
}
