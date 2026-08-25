import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

// A rejected promise that nothing awaits (e.g. a fire-and-forget invoke() call) otherwise fails
// completely silently in a production WebView2 build — no devtools, no console visible to the
// user. Surface it the same way a render crash is surfaced, instead of leaving the UI looking
// frozen/unresponsive with no signal anything went wrong.
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;bottom:16px;left:16px;right:16px;z-index:9999;background:#450a0a;border:1px solid #991b1b;color:#fecaca;padding:10px 14px;border-radius:8px;font:13px system-ui;max-width:520px;";
  banner.textContent = `Background error: ${message}`;
  document.body.appendChild(banner);
  window.setTimeout(() => banner.remove(), 10000);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
