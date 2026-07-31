"use client";

/**
 * MỘT kết nối SSE /api/events dùng chung toàn app (EventsProvider đặt ở layout).
 * Auto-reconnect sau 3s khi đứt. Phân phối event job / joblog / agent
 * cho các subscriber qua context.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentEvent, Job, JobLogEvent, UploadEvent } from "@/lib/api";

type JobHandler = (job: Job) => void;
type JobLogHandler = (e: JobLogEvent) => void;
type AgentHandler = (e: AgentEvent) => void;
type UploadHandler = (e: UploadEvent) => void;

interface EventsContextValue {
  connected: boolean;
  subscribeJob: (h: JobHandler) => () => void;
  subscribeJobLog: (h: JobLogHandler) => () => void;
  subscribeAgent: (h: AgentHandler) => () => void;
  subscribeUpload: (h: UploadHandler) => () => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

const RETRY_MS = 3000;

export function EventsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const jobHandlers = useRef(new Set<JobHandler>());
  const jobLogHandlers = useRef(new Set<JobLogHandler>());
  const agentHandlers = useRef(new Set<AgentHandler>());
  const uploadHandlers = useRef(new Set<UploadHandler>());

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    function dispatch<T>(handlers: Set<(e: T) => void>, raw: string) {
      let data: T;
      try {
        data = JSON.parse(raw) as T;
      } catch {
        return;
      }
      handlers.forEach((h) => {
        try {
          h(data);
        } catch {
          // subscriber lỗi không được làm sập stream
        }
      });
    }

    function connect() {
      if (disposed) return;
      es = new EventSource("/api/events");
      es.onopen = () => setConnected(true);
      es.addEventListener("job", (e) =>
        dispatch(jobHandlers.current, (e as MessageEvent).data)
      );
      es.addEventListener("joblog", (e) =>
        dispatch(jobLogHandlers.current, (e as MessageEvent).data)
      );
      es.addEventListener("agent", (e) =>
        dispatch(agentHandlers.current, (e as MessageEvent).data)
      );
      es.addEventListener("upload", (e) =>
        dispatch(uploadHandlers.current, (e as MessageEvent).data)
      );
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!disposed) timer = setTimeout(connect, RETRY_MS);
      };
    }

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, []);

  const subscribeJob = useCallback((h: JobHandler) => {
    jobHandlers.current.add(h);
    return () => {
      jobHandlers.current.delete(h);
    };
  }, []);

  const subscribeJobLog = useCallback((h: JobLogHandler) => {
    jobLogHandlers.current.add(h);
    return () => {
      jobLogHandlers.current.delete(h);
    };
  }, []);

  const subscribeAgent = useCallback((h: AgentHandler) => {
    agentHandlers.current.add(h);
    return () => {
      agentHandlers.current.delete(h);
    };
  }, []);

  const subscribeUpload = useCallback((h: UploadHandler) => {
    uploadHandlers.current.add(h);
    return () => {
      uploadHandlers.current.delete(h);
    };
  }, []);

  const value = useMemo<EventsContextValue>(
    () => ({ connected, subscribeJob, subscribeJobLog, subscribeAgent, subscribeUpload }),
    [connected, subscribeJob, subscribeJobLog, subscribeAgent, subscribeUpload]
  );

  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
  );
}

export function useEvents(): EventsContextValue {
  const ctx = useContext(EventsContext);
  if (!ctx) {
    throw new Error("useEvents phải được dùng bên trong <EventsProvider>");
  }
  return ctx;
}

/** Đăng ký nhận event `job` — handler luôn là bản mới nhất, không cần memo. */
export function useJobEvents(handler: JobHandler) {
  const { subscribeJob } = useEvents();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () => subscribeJob((job) => ref.current(job)),
    [subscribeJob]
  );
}

/** Đăng ký nhận event `joblog`. */
export function useJobLogEvents(handler: JobLogHandler) {
  const { subscribeJobLog } = useEvents();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () => subscribeJobLog((e) => ref.current(e)),
    [subscribeJobLog]
  );
}

/** Đăng ký nhận event `agent`. */
export function useAgentEvents(handler: AgentHandler) {
  const { subscribeAgent } = useEvents();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () => subscribeAgent((e) => ref.current(e)),
    [subscribeAgent]
  );
}

/** Đăng ký nhận event `upload` — tiến trình server nhận file POST /api/assets. */
export function useUploadEvents(handler: UploadHandler) {
  const { subscribeUpload } = useEvents();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () => subscribeUpload((e) => ref.current(e)),
    [subscribeUpload]
  );
}
