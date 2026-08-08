import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { ChatProvider } from "./stores/chatStore";
import { AuthProvider } from "./stores/authStore";
import App from "./App";
import { FileProcessingProvider } from "./lib/providers/FileProcessingProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ChatProvider>
          <FileProcessingProvider>
            <App />
          </FileProcessingProvider>
        </ChatProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
