// Polyfill Buffer for the browser: @stellar/stellar-sdk uses Node's Buffer
// internally (XDR encoding, signing), which is undefined in browsers. Must run
// before any stellar-sdk code. See https://github.com/stellar/js-stellar-sdk
import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
