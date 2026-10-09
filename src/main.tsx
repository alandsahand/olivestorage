import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { CrashGuard, ErrorBanner } from "./components/ErrorGuard";
import { ShopProvider } from "./shop";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Development-only preview of the invoice layout with sample data (this branch is removed from the shipped app).
if (import.meta.env.DEV && location.hash.startsWith("#/__invoice-demo")) {
  const { default: InvoiceDemo } = await import("./dev/InvoiceDemo");
  root.render(
    <I18nProvider>
      <ShopProvider>
        <InvoiceDemo />
      </ShopProvider>
    </I18nProvider>,
  );
} else {
  root.render(
    <React.StrictMode>
      <I18nProvider>
        <CrashGuard>
          <ShopProvider>
            <App />
          </ShopProvider>
        </CrashGuard>
        <ErrorBanner />
      </I18nProvider>
    </React.StrictMode>,
  );
}
