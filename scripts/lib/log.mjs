/** @param {"info"|"warn"|"error"|"ok"} level */
export function log(level, message) {
  const prefix =
    level === "error"
      ? "error:"
      : level === "warn"
        ? "warn:"
        : level === "ok"
          ? "ok:"
          : "";
  const line = prefix ? `${prefix} ${message}` : message;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function printHeader(title) {
  console.log(`\n=== ${title} ===\n`);
}
