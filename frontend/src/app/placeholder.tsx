import { PagePlaceholder } from "@/components/pro/page-placeholder";
import { PAGE_META } from "@/config/routes";

export function DomainPage({ path }: { path: keyof typeof PAGE_META }) {
  const meta = PAGE_META[path];
  return <PagePlaceholder title={meta.title} description={meta.description} />;
}
