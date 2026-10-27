import { useTranslation } from "react-i18next";
import { useServerBrand } from "../../hooks/useServerBrand";
import styles from "./index.module.less";

interface BrandProps {
  variant?: "navigation" | "auth" | "compact";
}

export default function Brand({ variant = "navigation" }: BrandProps) {
  const { t } = useTranslation();
  const compact = variant === "compact";
  const brand = useServerBrand();
  const logoSrc =
    brand === "dinfectome"
      ? "/dinfectome-logo.webp"
      : compact
      ? "/geneseeq-icon-192.png"
      : "/geneseeq-logo.png";

  return (
    <div className={`${styles.brand} ${styles[variant]}`}>
      <img
        src={logoSrc}
        alt={t(
          brand === "dinfectome" || compact ? "app.name" : "app.companyName",
        )}
        className={styles.logo}
        draggable={false}
      />
      {!compact && <span className={styles.name}>{t("app.name")}</span>}
    </div>
  );
}
