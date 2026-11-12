import geneseeqLogoUrl from "./assets/geneseeq-logo.png";
import { useEffect } from "react";
import dinfectomeLogoUrl from "./assets/dinfectome-logo.webp";
import mascotUrl from "./assets/shixiaohe-mascot.png";
import dinfectomeMascotUrl from "./assets/dinfectome-mascot-1.png";
import { normalizeShellBrand, shellBrandName } from "../../shared/shell-brand";
import { LinuxWindowControls } from "./linux-window-controls";
import { mount } from "./mount";
import "./base.less";
import styles from "./splash.module.less";

/**
 * Splash of the Early Window (§4). It owns no state: the main process loads the
 * Dashboard into this same window once ``/api/health`` is green, or replaces this
 * page with the failure Result.
 *
 * The sidecar can take ten seconds or more on a cold start, so the page has to
 * read as "working", not as "stuck on a blank screen": the brand logo and
 * mascot above the shared arc and one line saying what is being waited on.
 *
 * 顶部 58px 的拖动热区由 base.less 提供，正文区域不参与窗口拖动。
 */
function Splash() {
  const params = new URLSearchParams(window.location.search);
  const brand = normalizeShellBrand(params.get("brand"));
  const name = shellBrandName(brand);
  useEffect(() => { document.title = name; }, [name]);
  const isZh = (params.get("locale") ?? navigator.language).toLowerCase().startsWith("zh");

  return (
    <main className={styles.splash} role="status" aria-live="polite">
      <LinuxWindowControls />
      <div className={styles.stack}>
        <img
          className={styles.logo}
          src={brand === "dinfectome" ? dinfectomeLogoUrl : geneseeqLogoUrl}
          alt={name}
          height={72}
        />
        <h1 className={styles.name}>{name}</h1>
        <img className={styles.mascot} src={brand === "dinfectome" ? dinfectomeMascotUrl : mascotUrl} alt="" />
        <p className={styles.status}>
          <span className={styles.spinner} aria-hidden="true">
            <span className={styles.track} />
            <span className={styles.ring} />
          </span>
          {isZh ? `正在启动${name}服务…` : `Starting ${name}…`}
        </p>
      </div>
    </main>
  );
}

mount(<Splash />);
