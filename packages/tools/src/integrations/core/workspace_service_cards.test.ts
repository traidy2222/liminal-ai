import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGoogleServiceCards, buildMicrosoftServiceCards } from "./workspace_service_cards.js";

describe("workspace_service_cards", () => {
  it("marks gmail connected when MCP and scopes present", () => {
    const cards = buildGoogleServiceCards(
      [
        {
          accountId: "a1",
          email: "u@x.com",
          scopes: ["https://www.googleapis.com/auth/gmail.modify"],
          expiresAt: 0,
        },
      ],
      [
        {
          kind: "mcp",
          name: "google_gmail",
          toolCount: 8,
          sampleTools: [],
          authKind: "oauth",
          attachedAt: 1,
          parentProvider: "google_workspace",
        },
      ]
    );
    const gmail = cards.find((c) => c.serviceId === "gmail");
    assert.equal(gmail?.connected, true);
    assert.equal(gmail?.toolCount, 8);
  });

  it("marks mail connected when graph MCP lists mail service", () => {
    const cards = buildMicrosoftServiceCards(
      [{ accountId: "m1", scopes: ["Mail.ReadWrite", "Mail.Send", "User.Read"], expiresAt: 0 }],
      [
        {
          kind: "mcp",
          name: "microsoft",
          toolCount: 20,
          sampleTools: [],
          authKind: "oauth",
          attachedAt: 1,
          parentProvider: "microsoft_365",
          services: ["mail"],
        },
      ]
    );
    const mail = cards.find((c) => c.serviceId === "mail");
    assert.equal(mail?.connected, true);
  });

  it("keeps both docs and sheets connected on shared google_ext", () => {
    const scopes = [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ];
    const cards = buildGoogleServiceCards(
      [{ accountId: "a1", email: "u@x.com", scopes, expiresAt: 0 }],
      [
        {
          kind: "mcp",
          name: "google_ext",
          toolCount: 24,
          sampleTools: [],
          authKind: "oauth",
          attachedAt: 1,
          parentProvider: "google_workspace",
          services: ["docs", "sheets"],
        },
      ]
    );
    assert.equal(cards.find((c) => c.serviceId === "docs")?.connected, true);
    assert.equal(cards.find((c) => c.serviceId === "sheets")?.connected, true);
  });
});
