import { ScrollReveal } from "@/components/ScrollReveal";
import { legal_risk_content } from "@/content/legal-risk";

export default function LegalPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: legal_risk_content }} />
    </ScrollReveal>
  );
}
