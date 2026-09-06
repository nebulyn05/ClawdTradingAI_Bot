import { ScrollReveal } from "@/components/ScrollReveal";
import { docs_bot_commands_content } from "@/content/docs-bot-commands";

export default function DocsPage() {
  return (
    <ScrollReveal>
      <div className="site-fade-in" dangerouslySetInnerHTML={{ __html: docs_bot_commands_content }} />
    </ScrollReveal>
  );
}
