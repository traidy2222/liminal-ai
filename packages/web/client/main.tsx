import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyPersonaDocumentTheme } from "./applyPersonaDocumentTheme.js";
import { readPersonaChromeFromSession } from "./personaChromeSessionCache.js";

const cachedChrome = readPersonaChromeFromSession();
applyPersonaDocumentTheme(cachedChrome?.personaUiTheme ?? null);

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(<App />);
