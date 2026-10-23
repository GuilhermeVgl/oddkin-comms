import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <h1>ODDKIN</h1>
      <p>Pequenos passos. Grandes entregas.</p>
      <p>Em desenvolvimento.</p>
    </main>
  );
}

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element is missing");
}
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
