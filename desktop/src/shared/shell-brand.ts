export type ShellBrand = "default" | "dinfectome";

export function normalizeShellBrand(value: unknown): ShellBrand {
  return value === "dinfectome" ? "dinfectome" : "default";
}

export function shellBrandName(brand: ShellBrand): string {
  return brand === "dinfectome" ? "Dinfectome" : "智能工作台";
}
