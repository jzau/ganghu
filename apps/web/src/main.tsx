import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/AdminPage";
import { ChatPage } from "./pages/ChatPage";
import { LegalPage } from "./pages/LegalPage";
import { SharedConversationPage } from "./pages/SharedConversationPage";
import "./styles.css";
import "./design.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:conversationId" element={<ChatPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/terms-of-use" element={<LegalPage kind="terms" />} />
          <Route path="/privacy-policy" element={<LegalPage kind="privacy" />} />
          <Route path="/share/:token" element={<SharedConversationPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
