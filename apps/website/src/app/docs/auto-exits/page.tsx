import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_auto_exits_content } from "@/content/docs-auto-exits";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_auto_exits_content }} />
    </ScrollReveal>
  );
}
