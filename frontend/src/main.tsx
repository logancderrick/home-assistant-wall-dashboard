import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { routerFutureFlags } from "./lib/routerFutureFlags";
import { AppProvider } from "./contexts/AppContext";
import { SkydarkDataProvider } from "./contexts/SkydarkDataContext";
import { ViewportSimulatorProvider } from "./contexts/ViewportSimulatorContext";
import { VoiceProvider } from "./contexts/VoiceContext";
import ErrorBoundary from "./components/Common/ErrorBoundary";
import AppBootstrapGate from "./components/AppBootstrapGate";
import App from "./App";
import "./index.css";
import { hideHaChromeWhenReady } from "./lib/hideHaChrome";

// Hide HA sidebar + panel header from within the iframe so voice satellite
// and other HA-level dialogs continue working normally.
hideHaChromeWhenReady();

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    "<div style=\"display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:'Nunito',system-ui,sans-serif;padding:2rem;text-align:center;\"><h2>SkyDark: missing root element</h2><p>This app expects a <code>#root</code> element. Check that the correct HTML is being served.</p></div>";
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <HashRouter future={routerFutureFlags}>
          <SkydarkDataProvider>
            <AppProvider>
              <VoiceProvider>
                <AppBootstrapGate>
                  <ViewportSimulatorProvider>
                    <App />
                  </ViewportSimulatorProvider>
                </AppBootstrapGate>
              </VoiceProvider>
            </AppProvider>
          </SkydarkDataProvider>
        </HashRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
