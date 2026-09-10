import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppStoreProvider } from "./store/AppStore";
import "./index.css";
import "./sharedModpacks.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppStoreProvider>
      <App />
    </AppStoreProvider>
  </StrictMode>,
);
