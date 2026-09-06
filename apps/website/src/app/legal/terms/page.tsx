import { ScrollReveal } from "@/components/ScrollReveal";
import { legal_terms_content } from "@/content/legal-terms";

export default function LegalPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: legal_terms_content }} />
    </ScrollReveal>
  );
}
