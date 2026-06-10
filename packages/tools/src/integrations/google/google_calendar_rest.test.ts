import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarRestEnabled } from "./google_calendar_rest.js";

test("calendarRestEnabled defaults on when env unset", () => {
  const prev = process.env.AGENT_GOOGLE_CALENDAR_REST;
  delete process.env.AGENT_GOOGLE_CALENDAR_REST;
  try {
    assert.equal(calendarRestEnabled(), true);
  } finally {
    if (prev !== undefined) process.env.AGENT_GOOGLE_CALENDAR_REST = prev;
    else delete process.env.AGENT_GOOGLE_CALENDAR_REST;
  }
});

test("calendarRestEnabled respects AGENT_GOOGLE_CALENDAR_REST=0", () => {
  const prev = process.env.AGENT_GOOGLE_CALENDAR_REST;
  process.env.AGENT_GOOGLE_CALENDAR_REST = "0";
  try {
    assert.equal(calendarRestEnabled(), false);
  } finally {
    if (prev !== undefined) process.env.AGENT_GOOGLE_CALENDAR_REST = prev;
    else delete process.env.AGENT_GOOGLE_CALENDAR_REST;
  }
});
