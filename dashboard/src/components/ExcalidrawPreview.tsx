import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "antd";
import { Download, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Excalidraw, MainMenu, restore } from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { apiErrorMessage, isNotFoundApiError } from "../utils/apiError";
import DocumentPreviewLoading from "./DocumentPreviewLoading";
import type { DocumentPreviewCoreProps } from "./DocumentPreviewCore";
import styles from "./ExcalidrawPreview.module.less";

Object.assign(window, { EXCALIDRAW_ASSET_PATH: "/excalidraw-assets/" });

type Props = Pick<
  DocumentPreviewCoreProps,
  "filename" | "fetchBlob" | "onDownload"
>;

export default function ExcalidrawPreview({
  filename,
  fetchBlob,
  onDownload,
}: Props) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<ExcalidrawInitialDataState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const setApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !data) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      // Let the viewer update its canvas dimensions before fitting the scene.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(
          () =>
            apiRef.current?.scrollToContent(undefined, {
              fitToContent: true,
              animate: false,
            }),
        );
      });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [data]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setData(null);
    setError(null);

    void (async () => {
      let blob: Blob;
      try {
        blob = await fetchBlob(undefined, controller.signal);
      } catch (err) {
        if (!cancelled)
          setError(
            isNotFoundApiError(err)
              ? t("workspace.fileUnavailable")
              : apiErrorMessage(err, t("workspace.readFailed"), t),
          );
        return;
      }
      if (cancelled) return;
      try {
        const scene = JSON.parse(await blob.text());
        if (
          !scene ||
          scene.type !== "excalidraw" ||
          !Array.isArray(scene.elements)
        ) {
          throw new Error("invalid diagram");
        }
        const restored = restore(scene, null, null);
        // Do not activate external embeds or fetch remote images from a document.
        const elements = restored.elements.filter(
          (element) =>
            !element.isDeleted &&
            element.type !== "embeddable" &&
            element.type !== "iframe",
        );
        const files = Object.fromEntries(
          Object.entries(restored.files).filter(
            ([, file]) =>
              typeof file?.dataURL === "string" &&
              /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(
                file.dataURL,
              ),
          ),
        );
        if (!cancelled) {
          if (!elements.length) {
            setError(t("workspace.emptyFile"));
            return;
          }
          setData({
            elements,
            files,
            appState: {
              viewBackgroundColor: restored.appState.viewBackgroundColor,
            },
            scrollToContent: true,
          });
        }
      } catch {
        if (!cancelled) setError(t("workspace.diagramInvalid"));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchBlob, retry, t]);

  if (error)
    return (
      <div className={styles.fallback} role="alert">
        <p>{error}</p>
        <div>
          <Button
            icon={<RefreshCw size={15} />}
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("workspace.retryPreview")}
          </Button>
          {onDownload && (
            <Button icon={<Download size={15} />} onClick={onDownload}>
              {t("common.download")}
            </Button>
          )}
        </div>
      </div>
    );
  if (!data) return <DocumentPreviewLoading phase="file" />;

  return (
    <div className={styles.viewer} ref={hostRef}>
      <Excalidraw
        key={filename + retry}
        name={filename}
        initialData={data}
        excalidrawAPI={setApi}
        viewModeEnabled
        langCode={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
        handleKeyboardGlobally={false}
        autoFocus={false}
        aiEnabled={false}
        validateEmbeddable={false}
        onLinkOpen={(_element, event) => event.preventDefault()}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveAsImage: false,
            clearCanvas: false,
            changeViewBackgroundColor: false,
            toggleTheme: false,
          },
        }}
      >
        <MainMenu />
      </Excalidraw>
    </div>
  );
}
