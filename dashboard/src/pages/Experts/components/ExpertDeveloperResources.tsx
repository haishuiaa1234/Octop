import { useState } from "react";
import { Button, Drawer, Tooltip } from "antd";
import { BookOpen, Copy, Download, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { copyText } from "../../../utils/copyText";
import { message } from "../../../utils/antdMessage";
import styles from "./ExpertDeveloperResources.module.less";

const REPOSITORY = "http://10.1.3.254/report-group/expert-archives";
const ARCHIVE = `${REPOSITORY}/-/archive/master/expert-archives-master.zip`;

function Command({ title, text }: { title: string; text: string }) {
  const { t } = useTranslation();
  const label = `${t("common.copy")} ${title}`;
  const copy = async () => {
    if (await copyText(text)) message.success(t("common.copied"));
    else message.error(t("common.copyFailed"));
  };
  return (
    <div className={styles.command}>
      <pre>
        <code>{text}</code>
      </pre>
      <Tooltip title={label}>
        <Button
          type="text"
          aria-label={label}
          icon={<Copy size={15} />}
          onClick={() => void copy()}
        />
      </Tooltip>
    </div>
  );
}

export default function ExpertDeveloperResources() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const download = t("experts.development.download");
  const guide = t("experts.development.guide");
  const key = (name: string) => t(`experts.development.${name}`);
  return (
    <>
      <div className={styles.actions}>
        <Tooltip title={download}>
          <Button
            href={ARCHIVE}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={download}
            icon={<Download size={16} />}
          >
            {!isMobile && download}
          </Button>
        </Tooltip>
        <Tooltip title={guide}>
          <Button
            aria-label={guide}
            icon={<BookOpen size={16} />}
            onClick={() => setOpen(true)}
          >
            {!isMobile && guide}
          </Button>
        </Tooltip>
      </div>
      <Drawer
        title={key("title")}
        open={open}
        onClose={() => setOpen(false)}
        width={isMobile ? "100%" : 640}
      >
        <div className={styles.guide}>
          <div className={styles.links}>
            <Button
              type="primary"
              href={ARCHIVE}
              target="_blank"
              rel="noopener noreferrer"
              icon={<Download size={16} />}
            >
              {download}
            </Button>
            <Button
              href={REPOSITORY}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLink size={16} />}
            >
              {key("repository")}
            </Button>
          </div>
          <p className={styles.accessNote}>{key("access")}</p>
          <ol className={styles.steps}>
            <li>
              <h3>{key("prepare")}</h3>
              <p>{key("requirements")}</p>
              <p>{key("zip")}</p>
              <Command
                title={key("prepare")}
                text="python -m pip install -r requirements.txt"
              />
              <details>
                <summary>{key("clone")}</summary>
                <Command
                  title={key("clone")}
                  text={`git clone ${REPOSITORY}.git\ncd expert-archives`}
                />
              </details>
            </li>
            <li>
              <h3>{key("develop")}</h3>
              <Command
                title={key("develop")}
                text={`python manage.py init my-expert --name "${key(
                  "sampleName",
                )}"`}
              />
              <p>{key("files")}</p>
              <Command
                title={key("validate")}
                text="python manage.py validate my-expert"
              />
            </li>
            <li>
              <h3>{key("publish")}</h3>
              <Command title={key("publish")} text=".\publish.cmd" />
              <p>{key("otherPlatforms")}</p>
              <p>{key("login")}</p>
              <p>{key("success")}</p>
            </li>
            <li>
              <h3>{key("update")}</h3>
              <p>{key("updateDetail")}</p>
              <p>{key("receipts")}</p>
              <p>{key("tools")}</p>
            </li>
          </ol>
          <a
            href={`${REPOSITORY}/-/blob/master/README.md`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.readme}
          >
            {key("readme")} <ExternalLink size={14} />
          </a>
        </div>
      </Drawer>
    </>
  );
}
