/**
 * Post-write and pre-append checks for monolithic HTML built via write_file chunks.
 * Catches the common failure mode: multiple ES module script tags + premature </html>.
 */

export type HtmlCoherenceIssueCode =
  | "premature_document_close"
  | "content_after_html_close"
  | "multiple_module_scripts"
  | "module_scope_fragmentation"
  | "document_already_closed";

export type HtmlCoherenceIssue = {
  code: HtmlCoherenceIssueCode;
  message: string;
};

const MODULE_SCRIPT_OPEN = /<script\s+type\s*=\s*["']module["'][^>]*>/gi;

export function isLikelyHtmlFile(filePath: string, content: string): boolean {
  return /\.html?$/i.test(filePath) || /<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content);
}

/** Extract top-level bindings from a module script body (heuristic). */
function extractModuleDefinitions(scriptBody: string): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\bclass\s+([A-Za-z_$][\w$]*)\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(scriptBody)) !== null) {
      names.add(m[1]!);
    }
  }
  return names;
}

/** Top-level call sites in a module body (heuristic — skips method chains). */
function extractModuleCallSites(scriptBody: string): Set<string> {
  const calls = new Set<string>();
  const re = /(?:^|[;\n}\s])([A-Za-z_$][\w$]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scriptBody)) !== null) {
    const name = m[1]!;
    if (!["if", "for", "while", "switch", "catch", "return", "new", "typeof", "void"].includes(name)) {
      calls.add(name);
    }
  }
  return calls;
}

function extractModuleScriptBodies(content: string): string[] {
  const bodies: string[] = [];
  const re = /<script\s+type\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    bodies.push(m[1]!);
  }
  return bodies;
}

export function analyzeHtmlCoherence(content: string): HtmlCoherenceIssue[] {
  const issues: HtmlCoherenceIssue[] = [];
  if (!/<html[\s>]/i.test(content) && !/<!DOCTYPE\s+html/i.test(content)) {
    return issues;
  }

  const htmlCloseIdx = content.search(/<\/html\s*>/i);
  if (htmlCloseIdx >= 0) {
    const after = content.slice(htmlCloseIdx + content.match(/<\/html\s*>/i)![0]!.length).trim();
    if (after.length > 0 && !/^<!--[\s\S]*-->$/.test(after)) {
      issues.push({
        code: "content_after_html_close",
        message:
          "Content exists after </html> (often a second <script> block). Remove premature </body></html> and keep one document shell.",
      });
    }
    const beforeClose = content.slice(0, htmlCloseIdx).trimEnd();
    const bodyCloseIdx = beforeClose.lastIndexOf("</body>");
    if (bodyCloseIdx >= 0) {
      const between = beforeClose.slice(bodyCloseIdx + 7, htmlCloseIdx).trim();
      if (between.length > 0 && /<script/i.test(between)) {
        issues.push({
          code: "premature_document_close",
          message:
            "</body></html> appears before trailing <script> blocks — the browser never runs code after a closed document.",
        });
      }
    }
  }

  const moduleOpens = content.match(MODULE_SCRIPT_OPEN);
  const moduleCount = moduleOpens?.length ?? 0;
  if (moduleCount > 1) {
    issues.push({
      code: "multiple_module_scripts",
      message: `${moduleCount} <script type="module"> blocks — each is an isolated scope; shared helpers (e.g. setProgress) are not visible across blocks.`,
    });

    const bodies = extractModuleScriptBodies(content);
    if (bodies.length > 1) {
      const firstDefs = extractModuleDefinitions(bodies[0]!);
      for (let i = 1; i < bodies.length; i++) {
        const defs = extractModuleDefinitions(bodies[i]!);
        const calls = extractModuleCallSites(bodies[i]!);
        for (const name of calls) {
          if (firstDefs.has(name) && !defs.has(name) && !["console", "document", "window", "Math", "THREE"].includes(name)) {
            issues.push({
              code: "module_scope_fragmentation",
              message: `Module block ${i + 1} calls \`${name}()\` but \`${name}\` is only defined in the first module block.`,
            });
            break;
          }
        }
      }
    }
  }

  return issues;
}

/** Reject dangerous append payloads before they hit disk. */
export function validateHtmlAppendChunk(
  existing: string,
  payload: string,
  resolvedPath: string
): string | null {
  if (!isLikelyHtmlFile(resolvedPath, existing || payload)) return null;

  if (/<\/html\s*>/i.test(existing)) {
    return (
      "Refusing HTML append: document already has </html>. " +
      "Use write_file mode=overwrite or edit_file to fix structure — do not append after a closed document."
    );
  }

  const existingHasModule = /<script\s+type\s*=\s*["']module["']/i.test(existing);
  if (/<script\s+type\s*=\s*["']module["']/i.test(payload) && existingHasModule) {
    return (
      "Refusing HTML append: do not add another <script type=\"module\"> block. " +
      "Each module tag is an isolated ES module — append raw JavaScript only (no new <script> wrapper), " +
      "inside the single open module before its closing </script>. Use one module for the whole app."
    );
  }

  if (/<\/body\s*>/i.test(payload) || /<\/html\s*>/i.test(payload)) {
    const openModules = (existing.match(MODULE_SCRIPT_OPEN) ?? []).length;
    const closedModules = (existing.match(/<\/script>/gi) ?? []).length;
    if (openModules > 0 && openModules > closedModules) {
      return (
        "Refusing HTML append: do not write </body> or </html> while the module <script> is still open. " +
        "Append JavaScript lines, then close </script></body></html> once in the final chunk."
      );
    }
  }

  return null;
}

export function formatHtmlCoherenceFooter(issues: HtmlCoherenceIssue[]): string {
  if (issues.length === 0) return "";
  const codes = [...new Set(issues.map((i) => i.code))].join(",");
  const detail = issues.map((i) => i.message).join(" | ");
  return `html_coherence=warn html_coherence_codes=${codes} html_coherence_detail=${detail}`;
}
