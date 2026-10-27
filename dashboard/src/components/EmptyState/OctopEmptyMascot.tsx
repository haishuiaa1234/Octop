import { useServerBrand } from "../../hooks/useServerBrand";
import {
  getDinfectomeMascotSrc,
  OCTOP_EMPTY_MASCOT_SRC,
} from "../../assets/mascot";
import styles from "./EmptyState.module.less";

interface OctopEmptyMascotProps {
  className?: string;
  /** Square edge in px; default 160. */
  size?: number;
}

/**
 * Octop empty-state mascot image with shared sizing.
 * Use inside custom empty UIs or pass as ``EmptyState`` icon /
 * antd ``Empty`` ``image``.
 */
export function OctopEmptyMascot({
  className,
  size = 160,
}: OctopEmptyMascotProps) {
  const brand = useServerBrand();
  const src =
    brand === "dinfectome"
      ? getDinfectomeMascotSrc("empty")
      : OCTOP_EMPTY_MASCOT_SRC;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={className ? `${styles.mascot} ${className}` : styles.mascot}
      style={size === 160 ? undefined : { width: size, height: size }}
    />
  );
}
