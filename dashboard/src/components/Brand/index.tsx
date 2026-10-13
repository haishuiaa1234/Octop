import { useTranslation } from "react-i18next";
import styles from "./index.module.less";

interface BrandProps {
  variant?: "navigation" | "auth" | "compact";
}

export default function Brand({ variant = "navigation" }: BrandProps) {
  const { t } = useTranslation();
  const compact = variant === "compact";

  return (
    <div className={`${styles.brand} ${styles[variant]}`}>
      <img
        src={compact ? "/geneseeq-icon-192.png" : "/geneseeq-logo.png"}
        alt={t(compact ? "app.name" : "app.companyName")}
        className={styles.logo}
        draggable={false}
      />
      {!compact && <span className={styles.name}>{t("app.name")}</span>}
    </div>
  );
}
