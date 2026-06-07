import type { AppCacheEntry, LiminalAppSpec } from "./app_spec.js";
import { readAppHtml } from "./app_html_store.js";
import { repairWidgetHtmlDocument } from "./widget_html_merge.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function liminalBootstrapScript(spec: LiminalAppSpec, cache: AppCacheEntry | null): string {
  const payload = {
    spec: { id: spec.id, type: spec.type, title: spec.title, props: spec.props },
    cache: cache ?? { fetched_at: Date.now(), ok: true, data: {} },
    refresh: spec.refresh?.interval_min ?? 45,
  };
  return `<script>
window.__LIMINAL__ = ${JSON.stringify(payload)};
window.__LIMINAL__.onData = window.__LIMINAL__.onData || function(){};
window.__LIMINAL__.applyData = function(next) {
  window.__LIMINAL__.cache = next;
  try { window.__LIMINAL__.onData(next); } catch (e) {}
};
</script>`;
}

function wrapDocument(body: string, spec: LiminalAppSpec, cache: AppCacheEntry | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(spec.title)}</title>
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; background: #0a0e14; color: #e6edf3; font-family: system-ui, sans-serif; }
  * { box-sizing: border-box; }
</style>
${liminalBootstrapScript(spec, cache)}
</head>
<body>${body}</body>
</html>`;
}

function renderMarkdownBody(md: string): string {
  const lines = md.split("\n");
  const parts: string[] = [];
  let inPre = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inPre = !inPre;
      if (inPre) parts.push("<pre><code>");
      else parts.push("</code></pre>");
      continue;
    }
    if (inPre) {
      parts.push(escapeHtml(line));
      continue;
    }
    if (line.startsWith("### ")) {
      parts.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      parts.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      parts.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.trim() === "") {
      parts.push("<br/>");
    } else {
      parts.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  return `<main style="padding:16px;line-height:1.5;">${parts.join("\n")}</main>`;
}

function renderChartBody(props: Record<string, unknown>, cache: AppCacheEntry | null): string {
  const chart = String(props["chart"] ?? "bar");
  const labels = Array.isArray(props["labels"]) ? props["labels"].map(String) : [];
  const seriesRaw = props["series"];
  const series: { name: string; values: number[] }[] = [];
  if (Array.isArray(seriesRaw)) {
    for (const s of seriesRaw) {
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        series.push({
          name: String(o["name"] ?? "Series"),
          values: Array.isArray(o["values"])
            ? o["values"].map((v) => Number(v)).filter((n) => Number.isFinite(n))
            : [],
        });
      }
    }
  }
  const data = cache?.ok ? cache.data : null;
  const canvasId = "liminal_chart";
  const payload = JSON.stringify({ chart, labels, series, data });
  return `<main style="padding:16px;">
<h2 style="margin:0 0 12px;font-size:1rem;">${escapeHtml(String(props["title"] ?? "Chart"))}</h2>
<canvas id="${canvasId}" width="640" height="320" style="max-width:100%;background:#111820;border-radius:8px;"></canvas>
<script>
(function(){
  var cfg = ${payload};
  var c = document.getElementById("${canvasId}");
  if (!c) return;
  var ctx = c.getContext("2d");
  var labels = cfg.labels || [];
  var vals = (cfg.series[0] && cfg.series[0].values) || [];
  var max = Math.max.apply(null, vals.concat([1]));
  var w = c.width, h = c.height, pad = 32;
  ctx.fillStyle = "#111820"; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = "#6ee7b7"; ctx.lineWidth = 2;
  if (cfg.chart === "line") {
    ctx.beginPath();
    for (var i=0;i<vals.length;i++) {
      var x = pad + (i * (w - pad*2) / Math.max(1, vals.length-1));
      var y = h - pad - (vals[i]/max)*(h-pad*2);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  } else {
    var bw = (w - pad*2) / Math.max(1, vals.length);
    ctx.fillStyle = "#6ee7b7";
    for (var j=0;j<vals.length;j++) {
      var bh = (vals[j]/max)*(h-pad*2);
      ctx.fillRect(pad + j*bw + 4, h - pad - bh, bw - 8, bh);
    }
  }
  ctx.fillStyle = "#8b949e"; ctx.font = "11px system-ui";
  labels.forEach(function(lb, i) {
    var lx = pad + (i * (w - pad*2) / Math.max(1, labels.length-1));
    ctx.fillText(String(lb).slice(0,12), lx, h - 8);
  });
})();
</script>
</main>`;
}

function renderTableBody(props: Record<string, unknown>): string {
  const columns = Array.isArray(props["columns"]) ? props["columns"].map(String) : [];
  const rows = Array.isArray(props["rows"]) ? props["rows"] : [];
  const sortable = props["sortable"] === true;
  let thead = columns.map((c) => `<th style="text-align:left;padding:8px;border-bottom:1px solid #30363d;">${escapeHtml(c)}</th>`).join("");
  let tbody = "";
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    tbody += "<tr>" + row.map((cell) => `<td style="padding:8px;border-bottom:1px solid #21262d;">${escapeHtml(String(cell ?? ""))}</td>`).join("") + "</tr>";
  }
  const sortScript = sortable
    ? `<script>
document.querySelectorAll("th").forEach(function(th, col) {
  th.style.cursor = "pointer";
  th.onclick = function() {
    var table = th.closest("table");
    var tbody = table.querySelector("tbody");
    var rows = Array.from(tbody.querySelectorAll("tr"));
    rows.sort(function(a,b){
      var av = (a.children[col] && a.children[col].textContent) || "";
      var bv = (b.children[col] && b.children[col].textContent) || "";
      return av.localeCompare(bv, undefined, {numeric:true});
    });
    rows.forEach(function(r){ tbody.appendChild(r); });
  };
});
</script>`
    : "";
  return `<main style="padding:12px;overflow:auto;">
<table style="width:100%;border-collapse:collapse;font-size:13px;">
<thead><tr>${thead}</tr></thead>
<tbody>${tbody}</tbody>
</table>
${sortScript}
</main>`;
}

function renderIframeBody(props: Record<string, unknown>): string {
  const src = String(props["src"] ?? "").trim();
  if (!src.startsWith("https://")) {
    return `<main style="padding:16px;color:#f85149;">iframe src must be https://</main>`;
  }
  return `<iframe src="${escapeHtml(src)}" style="width:100%;height:100vh;border:0;" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`;
}

function renderHtmlBody(props: Record<string, unknown>, inlineHtml: string | null): string {
  const html = repairWidgetHtmlDocument(inlineHtml ?? String(props["html"] ?? "").trim());
  if (!html) return `<main style="padding:16px;color:#8b949e;">No HTML content.</main>`;
  if (html.includes("<html") || html.includes("<!DOCTYPE")) return html;
  return `<main style="padding:0;">${html}</main>`;
}

export async function resolveAppBodyHtml(
  spec: LiminalAppSpec,
  cache: AppCacheEntry | null
): Promise<string> {
  const props = spec.props;
  let body = "";
  switch (spec.type) {
    case "html": {
      const stored = props["html_ref"] === true || !props["html"]
        ? await readAppHtml(spec.id)
        : null;
      body = renderHtmlBody(props, stored);
      break;
    }
    case "markdown":
      body = renderMarkdownBody(String(props["markdown"] ?? props["content"] ?? ""));
      break;
    case "chart":
      body = renderChartBody(props, cache);
      break;
    case "table":
      body = renderTableBody(props);
      break;
    case "iframe":
      body = renderIframeBody(props);
      break;
    default:
      body = `<main style="padding:16px;">Unsupported render type: ${escapeHtml(spec.type)}</main>`;
  }
  if (body.includes("<!DOCTYPE") || body.includes("<html")) return body;
  return wrapDocument(body, spec, cache);
}
