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
