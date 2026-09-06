import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_settings_content } from "@/content/docs-settings";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_settings_content }} />
    </ScrollReveal>
  );
}
