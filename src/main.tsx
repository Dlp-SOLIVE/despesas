import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Depois de um deploy novo, uma página aberta há algum tempo pede ficheiros que já não existem
// (ex.: "Failed to fetch dynamically imported module …exceljs…"). Recarrega a página uma vez.
window.addEventListener("vite:preloadError", (e) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem("exp-reloaded") ?? 0); } catch { /* sem storage */ }
  if (Date.now() - last < 30000) return; // já recarregou há pouco: deixa o erro aparecer
  e.preventDefault();
  try { sessionStorage.setItem("exp-reloaded", String(Date.now())); } catch { /* sem storage */ }
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
