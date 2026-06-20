import assert from "node:assert/strict";
import test from "node:test";
import {
  absorbIdaToolOutput,
  getIdaActiveDatabase,
  injectIdaDatabaseArgs,
  resetIdaActiveDatabase,
  setIdaActiveDatabase,
} from "./ida_session.js";

test("injectIdaDatabaseArgs fills database and session_id from active session", () => {
  resetIdaActiveDatabase();
  setIdaActiveDatabase("C:\\bins\\foo.i64");
  const args = injectIdaDatabaseArgs("survey_binary", {});
  assert.equal(args.database, "C:\\bins\\foo.i64");
  assert.equal(args.session_id, "C:\\bins\\foo.i64");
});

test("injectIdaDatabaseArgs skips idb_list and preserves explicit database", () => {
  resetIdaActiveDatabase();
  setIdaActiveDatabase("cached.i64");
  assert.deepEqual(injectIdaDatabaseArgs("idb_list", {}), {});
  assert.deepEqual(injectIdaDatabaseArgs("list_funcs", { database: "explicit" }), {
    database: "explicit",
  });
});

test("absorbIdaToolOutput picks singleton idb_list session input_path when session_id empty", () => {
  resetIdaActiveDatabase();
  absorbIdaToolOutput(
    "idb_list",
    {},
    JSON.stringify({
      sessions: [
        {
          session_id: "",
          input_path: "C:\\Users\\traid\\cantcrack.exe.i64",
          filename: "cantcrack.exe.i64",
          is_active: true,
        },
      ],
    })
  );
  assert.equal(getIdaActiveDatabase(), "C:\\Users\\traid\\cantcrack.exe.i64");
});

test("absorbIdaToolOutput records idb_open session_id", () => {
  resetIdaActiveDatabase();
  absorbIdaToolOutput(
    "idb_open",
    { input_path: "C:\\bins\\foo.exe" },
    JSON.stringify({
      success: true,
      session: {
        session_id: "4781f39b",
        input_path: "C:\\bins\\foo.i64",
        filename: "foo.i64",
      },
    })
  );
  assert.equal(getIdaActiveDatabase(), "4781f39b");
});
