import { Globe, Settings2 } from "lucide-react";
import type { WebsiteLink } from "../../api/modules/websites";
import type { NavSection } from "../../layouts/sidebarNav";

export function websiteNavSections(
  links: WebsiteLink[],
  admin: boolean,
): NavSection[] {
  const items = links.map((site) => ({
    key: `website-${site.website_id}`,
    path: `/websites/${site.website_id}`,
    label: site.name,
    labelKey: "websites.title",
    icon: <Globe size={16} strokeWidth={1.8} />,
  }));
  if (admin)
    items.push({
      key: "admin-websites",
      path: "/admin/websites",
      label: "",
      labelKey: "websites.manage",
      icon: <Settings2 size={16} strokeWidth={1.8} />,
    });
  return items.length ? [{ groupKey: "websites.title", items }] : [];
}
