import { useEffect, useState } from "react";
import { octopSettingsApi } from "../api/modules/settings";

export type ServerBrand = "default" | "dinfectome";

let cachedBrand: ServerBrand | null = null;
let inflight: Promise<ServerBrand> | null = null;

function normalizeBrand(value: unknown): ServerBrand {
  return value === "dinfectome" ? "dinfectome" : "default";
}

async function fetchServerBrand(): Promise<ServerBrand> {
  if (cachedBrand) return cachedBrand;
  if (!inflight) {
    inflight = octopSettingsApi
      .branding()
      .then(({ brand }) => normalizeBrand(brand))
      .catch(() => "default" as const)
      .then((brand) => {
        cachedBrand = brand;
        return brand;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useServerBrand(): ServerBrand {
  const [brand, setBrand] = useState<ServerBrand>(cachedBrand ?? "default");

  useEffect(() => {
    void fetchServerBrand().then(setBrand);
  }, []);

  return brand;
}

/** Keep the tab icon in sync with the brand used by page logos and mascots. */
export function useBrandFavicon(): void {
  const brand = useServerBrand();

  useEffect(() => {
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) return;
    const dinfectome = brand === "dinfectome";
    favicon.type = dinfectome ? "image/svg+xml" : "image/x-icon";
    favicon.href = dinfectome
      ? "/dinfectome-favicon.svg"
      : "/geneseeq-favicon.ico";
  }, [brand]);
}
