import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { __testing_specToOperations, __testing_deriveBaseUrl } from "./api_connect.js";

describe("api_connect spec parsing", () => {
  it("ingests a minimal OpenAPI 3 spec into typed operation records", () => {
    const spec = {
      openapi: "3.0.0",
      servers: [{ url: "https://api.example.com/v1" }],
      paths: {
        "/issues/{id}": {
          get: {
            operationId: "issuesGet",
            summary: "Read one issue",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string" } },
              { name: "fields", in: "query", schema: { type: "string", description: "csv" } },
            ],
          },
        },
        "/issues": {
          post: {
            operationId: "issuesCreate",
            summary: "Create issue",
            requestBody: {
              required: true,
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    };
    const ops = __testing_specToOperations(spec, "linear");
    assert.equal(ops.length, 2);

    const getOp = ops.find((o) => o.method === "get");
    assert.ok(getOp);
    assert.equal(getOp!.toolName, "api_linear_issuesget");
    assert.equal(getOp!.pathTemplate, "/issues/{id}");
    assert.equal(getOp!.parameters.length, 2);
    assert.equal(getOp!.parameters[0]!.in, "path");
    assert.equal(getOp!.parameters[0]!.required, true);
    assert.equal(getOp!.requestBody, undefined);

    const postOp = ops.find((o) => o.method === "post");
    assert.ok(postOp);
    assert.equal(postOp!.toolName, "api_linear_issuescreate");
    assert.ok(postOp!.requestBody);
    assert.equal(postOp!.requestBody!.required, true);
    assert.equal(postOp!.requestBody!.contentType, "application/json");
  });

  it("synthesizes a tool name from method+path when operationId is absent", () => {
    const spec = {
      openapi: "3.0.0",
      paths: { "/users/me": { get: { summary: "self" } } },
    };
    const ops = __testing_specToOperations(spec, "demo");
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.toolName, "api_demo_get_users_me");
  });

  it("derives base URL from servers[0].url, falling back to the spec URL host", () => {
    const withServers = __testing_deriveBaseUrl(
      { openapi: "3.0.0", servers: [{ url: "https://api.example.com/v1" }] },
      "https://docs.example.com/openapi.json"
    );
    assert.equal(withServers, "https://api.example.com/v1");

    const fallback = __testing_deriveBaseUrl(
      { openapi: "3.0.0" },
      "https://api.example.com/openapi.json"
    );
    assert.equal(fallback, "https://api.example.com");
  });

  it("resolves a relative server URL against the spec URL", () => {
    const out = __testing_deriveBaseUrl(
      { openapi: "3.0.0", servers: [{ url: "/v2" }] },
      "https://api.example.com/openapi.json"
    );
    assert.equal(out, "https://api.example.com/v2");
  });

  it("handles Swagger 2.0 host/basePath/schemes", () => {
    const out = __testing_deriveBaseUrl(
      { swagger: "2.0", host: "petstore.swagger.io", basePath: "/v2", schemes: ["https"] },
      "https://petstore.swagger.io/v2/swagger.json"
    );
    assert.equal(out, "https://petstore.swagger.io/v2");
  });
});
