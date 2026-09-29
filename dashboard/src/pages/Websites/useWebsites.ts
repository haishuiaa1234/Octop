import { useEffect, useState } from "react";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import {
  websiteApi,
  WEBSITES_CHANGED,
  type WebsiteLink,
} from "../../api/modules/websites";

/** Revalidate on focus and every 30s so permission changes reach open dashboards. */
export function useWebsites(): WebsiteLink[] {
  const userId = useCurrentUser()?.id;
  const [state, setState] = useState<{ userId?: number; links: WebsiteLink[] }>(
    { links: [] },
  );
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let sequence = 0;
    const refresh = async () => {
      const current = ++sequence;
      try {
        const links = await websiteApi.list();
        if (alive && current === sequence) setState({ userId, links });
      } catch {
        if (alive && current === sequence) setState({ userId, links: [] });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(WEBSITES_CHANGED, refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(WEBSITES_CHANGED, refresh);
    };
  }, [userId]);
  return state.userId === userId ? state.links : [];
}
