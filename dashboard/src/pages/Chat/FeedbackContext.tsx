import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  feedbackApi,
  type Feedback,
  type FeedbackInput,
} from "../../api/modules/feedback";

interface FeedbackContextValue {
  items: Record<string, Feedback>;
  loading: boolean;
  error: boolean;
  reload: () => void;
  refreshAnswer?: () => void;
  save: (body: FeedbackInput) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
}
const FeedbackContext = createContext<FeedbackContextValue | null>(null);
export const useFeedback = () => useContext(FeedbackContext);

/** A keyed inner provider isolates reads and pending writes across conversations. */
export function FeedbackProvider({
  agentId,
  threadId,
  children,
  onRefresh,
}: {
  agentId?: string | null;
  threadId?: string | null;
  children: ReactNode;
  onRefresh?: () => void;
}) {
  if (!agentId || !threadId) return <>{children}</>;
  return (
    <ThreadFeedbackProvider
      key={`${agentId}:${threadId}`}
      agentId={agentId}
      threadId={threadId}
      onRefresh={onRefresh}
    >
      {children}
    </ThreadFeedbackProvider>
  );
}

function ThreadFeedbackProvider({
  agentId,
  threadId,
  children,
  onRefresh,
}: {
  agentId: string;
  threadId: string;
  children: ReactNode;
  onRefresh?: () => void;
}) {
  const [items, setItems] = useState<Record<string, Feedback>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    feedbackApi
      .list(agentId, threadId)
      .then((result) => {
        if (active)
          setItems(
            Object.fromEntries(
              result.items.map((item) => [item.message_id, item]),
            ),
          );
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agentId, threadId, revision]);
  const save = useCallback(
    async (body: FeedbackInput) => {
      const item = await feedbackApi.save(agentId, threadId, body);
      setItems((current) => ({ ...current, [item.message_id]: item }));
    },
    [agentId, threadId],
  );
  const remove = useCallback(
    async (messageId: string) => {
      await feedbackApi.remove(agentId, threadId, messageId);
      setItems((current) => {
        const next = { ...current };
        delete next[messageId];
        return next;
      });
    },
    [agentId, threadId],
  );
  const value = useMemo(
    () => ({
      items,
      loading,
      error,
      reload,
      save,
      remove,
      refreshAnswer: onRefresh,
    }),
    [items, loading, error, reload, save, remove, onRefresh],
  );
  return (
    <FeedbackContext.Provider value={value}>
      {children}
    </FeedbackContext.Provider>
  );
}
