import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
