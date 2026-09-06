import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_referrals_content } from "@/content/docs-referrals";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_referrals_content }} />
    </ScrollReveal>
  );
}
