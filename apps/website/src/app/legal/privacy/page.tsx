import { ScrollReveal } from "@/components/ScrollReveal";
import { legal_privacy_content } from "@/content/legal-privacy";

export default function LegalPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: legal_privacy_content }} />
    </ScrollReveal>
  );
}
