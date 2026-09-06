import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_wallet_content } from "@/content/docs-wallet";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_wallet_content }} />
    </ScrollReveal>
  );
}
