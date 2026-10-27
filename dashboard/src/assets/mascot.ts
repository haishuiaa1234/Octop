/**
 * Shared Shi Xiao He mascot (served from ``dashboard/public``).
 * Prefer ``OctopEmptyMascot`` / ``EmptyState variant="mascot"`` over hardcoding.
 */
export const SHIXIAOHE_MASCOT_SRC = `${
  import.meta.env.BASE_URL
}shixiaohe-mascot.png`;
export const OCTOP_EMPTY_MASCOT_SRC = SHIXIAOHE_MASCOT_SRC;

export type DinfectomeMascotVariant =
  | "welcome"
  | "thinking"
  | "connecting"
  | "empty";

const DINFECTOME_MASCOTS: Record<DinfectomeMascotVariant, string> = {
  welcome: `${import.meta.env.BASE_URL}dinfectome-mascot-1.png`,
  thinking: `${import.meta.env.BASE_URL}dinfectome-mascot-2.png`,
  connecting: `${import.meta.env.BASE_URL}dinfectome-mascot-3.png`,
  empty: `${import.meta.env.BASE_URL}dinfectome-mascot-1.png`,
};

export function getDinfectomeMascotSrc(
  variant: DinfectomeMascotVariant,
): string {
  return DINFECTOME_MASCOTS[variant];
}
