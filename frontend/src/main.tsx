import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as Sentry from "@sentry/react";
import "./index.css";
import { ChatProvider } from "./stores/chatStore";
import { AuthProvider } from "./stores/authStore";
import App from "./App";
import { FileProcessingProvider } from "./lib/providers/FileProcessingProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Sentry：DSN 未配置（VITE_SENTRY_DSN 为空）则跳过，本地开发零影响。
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn });
}

createRoot(document.getElementById("root")!).render(
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
