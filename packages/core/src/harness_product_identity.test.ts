import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectEmailPlaceholderViolations } from "./harness_product_identity.js";

describe("detectEmailPlaceholderViolations", () => {
  it("flags template repo URLs", () => {
    assert.ok(
      detectEmailPlaceholderViolations(
        "Repo: https://github.com/GITHUB_USERNAME/REPO_PLACEHOLDER"
      )
    );
  });

  it("allows real liminal repo URL", () => {
    assert.equal(
      detectEmailPlaceholderViolations("Repo: https://github.com/traidy2222/liminal-ai"),
      null
    );
  });
});
