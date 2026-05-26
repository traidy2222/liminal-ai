import React from "react";
import { createRoot } from "react-dom/client";
import { MarketingApp } from "./MarketingApp.js";
import { applyPersonaDocumentTheme } from "../applyPersonaDocumentTheme.js";
import { DEFAULT_PERSONA_UI_THEME } from "@liminal/core/persona-ui-theme";

applyPersonaDocumentTheme(DEFAULT_PERSONA_UI_THEME);

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(<MarketingApp />);
