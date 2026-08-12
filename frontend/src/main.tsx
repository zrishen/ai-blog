import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as Sentry from "@sentry/react";

import "./index.css";
import { ChatProvider } from "./stores/chatStore";
import { AuthProvider } from "./stores/authStore";
import App from "./App";
import { FileProcessingProvider } from "./features/workspace/providers/FileProcessingProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { logError } from "./api/logger";

// 全局错误捕获：脚本异常 + 未 catch 的 Promise，上报后端 app.log（经 logger 节流）。
// 放 Sentry.init 之前注册，保证最先拿到 error；Sentry 无 DSN 时 no-op，不冲突。
window.addEventListener("error", (e) => {
  logError(e.error ?? e.message, {
    source: "window",
    filename: e.filename,
    line: e.lineno,
    column: e.colno,
  });
});
window.addEventListener("unhandledrejection", (e) => {
  logError(e.reason, { source: "unhandledrejection" });
});

// Sentry：DSN 未配置（VITE_SENTRY_DSN 为空）则跳过，本地开发零影响。
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn });
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <ChatProvider>
              <FileProcessingProvider>
                <App />
              </FileProcessingProvider>
            </ChatProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}
