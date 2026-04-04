/**
 * Generates single-file static HTML visualizations for gitsema commands.
 *
 * Strategy for embedding JavaScript:
 *   - All static JS code blocks are TypeScript template literals with NO ${...} interpolations.
 *   - Dynamic data (JSON) is injected at the top of each <script> block via TypeScript interpolation.
 *   - All JS strings use "double quotes" to avoid conflicts with outer TypeScript template literals.
 *   - No backtick strings are used inside the embedded JS.
 */

import type { ClusterReport, TemporalClusterReport, ClusterTimelineReport } from '../search/clustering.js'
import type { ConceptEvolutionEntry, EvolutionEntry } from '../search/evolution.js'
import type { ConceptChangePointReport, FileChangePointReport } from '../search/changePoints.js'
import type { ClusterChangePointReport } from '../search/clustering.js'
import type { DeadConceptResult } from '../search/deadConcepts.js'
import type { SemanticCollisionReport } from '../search/mergeAudit.js'
import type { BranchSummaryResult } from '../search/branchSummary.js'

// ─── Shared constants ─────────────────────────────────────────────────────────

const PALETTE = [
  '#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7',
  '#7dcfff', '#ff9e64', '#73daca', '#c0caf5', '#db4b4b',
  '#2ac3de', '#41a6b5', '#b4f9f8', '#ff75a0', '#a9b1d6', '#6ebb9e',
]

function escHtml(s: unknown): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Serializes data as JSON safe for embedding inside a <script> block.
 * Replaces `<`, `>`, `&`, and the Unicode line/paragraph separators with their
 * unicode escapes so the browser HTML parser cannot see `</script>` or `<!--`
 * in the source, preventing script injection.
 * The JSON value is still valid and will be parsed correctly by the JS engine.
 */
function safeJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// ─── Data sanitizers (strip heavy centroid arrays) ────────────────────────────

function sanitizeCluster(c: { id: number; label: string; size: number; representativePaths: string[]; topKeywords: string[]; enhancedKeywords: string[] }) {
  return {
    id: c.id,
    label: c.label,
    size: c.size,
    representativePaths: c.representativePaths ?? [],
    topKeywords: c.topKeywords ?? [],
    enhancedKeywords: c.enhancedKeywords ?? [],
  }
}

function sanitizeClusterReport(r: ClusterReport) {
  return {
    k: r.k,
    clusteredAt: r.clusteredAt,
    totalBlobs: r.totalBlobs,
    clusters: r.clusters.map(sanitizeCluster),
    edges: (r.edges ?? []).map((e) => ({ fromId: e.fromId, toId: e.toId, similarity: e.similarity })),
  }
}

function sanitizeTemporalReport(r: TemporalClusterReport) {
  const sanitizeChange = (ch: typeof r.changes[number]) => ({
    afterCluster: ch.afterCluster ? sanitizeCluster(ch.afterCluster) : null,
    beforeCluster: ch.beforeCluster ? sanitizeCluster(ch.beforeCluster) : null,
    centroidDrift: ch.centroidDrift,
    stable: ch.stable,
    newBlobs: ch.newBlobs,
    removedBlobs: ch.removedBlobs,
    inflows: ch.inflows ?? [],
    outflows: ch.outflows ?? [],
  })
  return {
    ref1: r.ref1,
    ref2: r.ref2,
    newBlobsTotal: r.newBlobsTotal,
    removedBlobsTotal: r.removedBlobsTotal,
    movedBlobsTotal: r.movedBlobsTotal,
    stableBlobsTotal: r.stableBlobsTotal,
    before: sanitizeClusterReport(r.before),
    after: sanitizeClusterReport(r.after),
    changes: (r.changes ?? []).map(sanitizeChange),
  }
}

function sanitizeTimelineReport(r: ClusterTimelineReport) {
  return {
    k: r.k,
    since: r.since,
    until: r.until,
    steps: (r.steps ?? []).map((s) => ({
      ref: s.ref,
      timestamp: s.timestamp,
      blobCount: s.blobCount,
      clusters: (s.clusters ?? []).map(sanitizeCluster),
      stats: s.stats ?? null,
      prevRef: s.prevRef ?? null,
      changes: (s.changes ?? []).map((ch) => ({
        afterCluster: ch.afterCluster ? sanitizeCluster(ch.afterCluster) : null,
        beforeCluster: ch.beforeCluster ? sanitizeCluster(ch.beforeCluster) : null,
        centroidDrift: ch.centroidDrift,
        inflows: ch.inflows ?? [],
        outflows: ch.outflows ?? [],
      })),
    })),
  }
}

// ─── Shared CSS ───────────────────────────────────────────────────────────────

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1b26;color:#c0caf5;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5}
.hdr{padding:10px 16px;background:#24283b;border-bottom:1px solid #2f3451;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hdr h1{font-size:16px;font-weight:600;color:#7aa2f7}
.stat{background:#2f3451;padding:2px 9px;border-radius:10px;font-size:12px;color:#a9b1d6}
.stat b{color:#7aa2f7}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:#1a1b26}
::-webkit-scrollbar-thumb{background:#2f3451;border-radius:3px}
`

// ─── Shared JS helper (no ${} in this block) ─────────────────────────────────

const COMMON_JS = `
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function shortHash(h) { return String(h).slice(0, 7); }
`

// ─── Cluster force simulation JS (no ${} in this block) ──────────────────────

const CLUSTER_SIM_JS = `
function initSim(W, H) {
  var nodes = DATA.clusters.map(function(c, i) {
    var angle = (i / DATA.clusters.length) * Math.PI * 2;
    var rad = Math.min(W, H) * 0.3;
    return {
      id: c.id,
      label: c.label,
      r: Math.max(22, Math.sqrt(c.size) * 5),
      color: PALETTE[i % PALETTE.length],
      data: c,
      x: W / 2 + Math.cos(angle) * rad,
      y: H / 2 + Math.sin(angle) * rad,
      vx: 0, vy: 0
    };
  });
  var links = DATA.edges.map(function(e) {
    var src = nodes.find(function(n) { return n.id === e.fromId; });
    var tgt = nodes.find(function(n) { return n.id === e.toId; });
    if (!src || !tgt) return null;
    return { source: src, target: tgt, sim: e.similarity };
  }).filter(Boolean);
  return { nodes: nodes, links: links };
}

function simTick(sim, W, H) {
  var cx = W / 2, cy = H / 2;
  var nodes = sim.nodes, links = sim.links;
  var i, j, n, l, dx, dy, dist, dsq, f;

  for (i = 0; i < nodes.length; i++) {
    nodes[i].vx += (cx - nodes[i].x) * 0.0008;
    nodes[i].vy += (cy - nodes[i].y) * 0.0008;
  }
  for (i = 0; i < links.length; i++) {
    l = links[i];
    dx = l.target.x - l.source.x;
    dy = l.target.y - l.source.y;
    dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var ideal = 220 - l.sim * 60;
    f = (dist - ideal) * 0.004 * l.sim;
    l.source.vx += dx / dist * f; l.source.vy += dy / dist * f;
    l.target.vx -= dx / dist * f; l.target.vy -= dy / dist * f;
  }
  for (i = 0; i < nodes.length; i++) {
    for (j = i + 1; j < nodes.length; j++) {
      dx = nodes[j].x - nodes[i].x;
      dy = nodes[j].y - nodes[i].y;
      dsq = dx * dx + dy * dy || 1;
      f = 14000 / dsq;
      nodes[i].vx -= dx * f; nodes[j].vx += dx * f;
      nodes[i].vy -= dy * f; nodes[j].vy += dy * f;
    }
  }
  for (i = 0; i < nodes.length; i++) {
    n = nodes[i];
    n.vx *= 0.86; n.vy *= 0.86;
    n.x += n.vx; n.y += n.vy;
    n.x = Math.max(n.r + 2, Math.min(W - n.r - 2, n.x));
    n.y = Math.max(n.r + 2, Math.min(H - n.r - 2, n.y));
  }
}

function simDraw(ctx, sim, selectedId, W, H) {
  ctx.clearRect(0, 0, W, H);
  var nodes = sim.nodes, links = sim.links;

  links.forEach(function(l) {
    var alpha = 0.1 + l.sim * 0.5;
    ctx.beginPath();
    ctx.moveTo(l.source.x, l.source.y);
    ctx.lineTo(l.target.x, l.target.y);
    ctx.strokeStyle = "rgba(122,162,247," + alpha + ")";
    ctx.lineWidth = 1 + l.sim * 2.5;
    ctx.stroke();
  });

  nodes.forEach(function(n) {
    var sel = n.id === selectedId;
    if (sel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 8, 0, Math.PI * 2);
      ctx.fillStyle = n.color + "22";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = n.color + (sel ? "cc" : "66");
    ctx.fill();
    ctx.strokeStyle = n.color;
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.stroke();
    var fs = Math.max(9, Math.min(13, n.r * 0.45));
    ctx.fillStyle = "#e0e4f4";
    ctx.font = "600 " + fs + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var words = n.label.split(" ");
    if (words.length === 1 || ctx.measureText(n.label).width < n.r * 2 - 6) {
      ctx.fillText(n.label, n.x, n.y);
    } else {
      ctx.fillText(words[0], n.x, n.y - fs * 0.65);
      ctx.fillText(words.slice(1).join(" "), n.x, n.y + fs * 0.65);
    }
  });
}

window.addEventListener("load", function() {
  var canvas = document.getElementById("viz-canvas");
  var ctx = canvas.getContext("2d");
  var sidebar = document.getElementById("cluster-list");
  var tip = document.getElementById("gsviz-tip");
  var W = 0, H = 0;
  var sim = null;
  var selectedId = -1;
  var drag = null;

  function resize() {
    W = canvas.offsetWidth;
    H = canvas.offsetHeight;
    canvas.width = W * (window.devicePixelRatio || 1);
    canvas.height = H * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    if (!sim) {
      sim = initSim(W, H);
      buildSidebar();
    }
  }

  function buildSidebar() {
    sidebar.innerHTML = "";
    DATA.clusters.forEach(function(c, i) {
      var el = document.createElement("div");
      el.className = "ci";
      el.setAttribute("data-id", String(c.id));
      el.innerHTML =
        "<div class=\"ci-dot\" style=\"background:" + PALETTE[i % PALETTE.length] + "\"></div>" +
        "<div><div class=\"ci-name\">" + esc(c.label) + "</div>" +
        "<div class=\"ci-meta\">" + c.size + " blobs · " + esc(c.topKeywords.slice(0, 3).join(", ")) + "</div>" +
        (c.enhancedKeywords.length > 0 ? "<div class=\"ci-enh\">" + esc(c.enhancedKeywords.slice(0, 3).join(", ")) + "</div>" : "") +
        "<div class=\"ci-paths\">" + esc(c.representativePaths.slice(0, 2).join(", ")) + "</div>" +
        "</div>";
      el.addEventListener("click", function() { selectNode(c.id); });
      sidebar.appendChild(el);
    });
  }

  function selectNode(id) {
    selectedId = id;
    var items = sidebar.querySelectorAll(".ci");
    for (var k = 0; k < items.length; k++) {
      var matches = parseInt(items[k].getAttribute("data-id"), 10) === id;
      items[k].classList.toggle("active", matches);
      if (matches) items[k].scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  canvas.addEventListener("pointerdown", function(e) {
    if (!sim) return;
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    for (var i = 0; i < sim.nodes.length; i++) {
      var n = sim.nodes[i];
      if (Math.hypot(mx - n.x, my - n.y) < n.r) {
        drag = { node: n, ox: mx - n.x, oy: my - n.y };
        canvas.setPointerCapture(e.pointerId);
        selectNode(n.id);
        break;
      }
    }
  });
  canvas.addEventListener("pointermove", function(e) {
    if (!drag) return;
    var r = canvas.getBoundingClientRect();
    drag.node.x = e.clientX - r.left - drag.ox;
    drag.node.y = e.clientY - r.top - drag.oy;
    drag.node.vx = 0; drag.node.vy = 0;
  });
  canvas.addEventListener("pointerup", function(e) {
    if (drag) { canvas.releasePointerCapture(e.pointerId); drag = null; }
  });

  canvas.addEventListener("mousemove", function(e) {
    if (!sim) return;
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var hit = null;
    for (var i = 0; i < sim.nodes.length; i++) {
      if (Math.hypot(mx - sim.nodes[i].x, my - sim.nodes[i].y) < sim.nodes[i].r) {
        hit = sim.nodes[i]; break;
      }
    }
    if (hit) {
      tip.style.display = "block";
      tip.style.left = Math.min(e.clientX + 16, window.innerWidth - 240) + "px";
      tip.style.top = Math.min(e.clientY - 10, window.innerHeight - 160) + "px";
      tip.innerHTML =
        "<b style=\"color:" + hit.color + "\">" + esc(hit.data.label) + "</b>" +
        " <span style=\"color:#565f89\">" + hit.data.size + " blobs</span><br>" +
        "<span style=\"color:#a9b1d6\">" + esc(hit.data.topKeywords.join(", ")) + "</span><br>" +
        "<span style=\"color:#9ece6a\">" + esc(hit.data.representativePaths.slice(0, 2).join(", ")) + "</span>";
    } else {
      tip.style.display = "none";
    }
  });
  canvas.addEventListener("mouseleave", function() { tip.style.display = "none"; drag = null; });
  window.addEventListener("resize", resize);

  function loop() {
    if (sim) { simTick(sim, W, H); simDraw(ctx, sim, selectedId, W, H); }
    requestAnimationFrame(loop);
  }
  resize();
  loop();
});
`

// ─── renderClustersHtml ───────────────────────────────────────────────────────

export function renderClustersHtml(report: ClusterReport): string {
  const data = sanitizeClusterReport(report)
  const headerDate = new Date(data.clusteredAt * 1000).toISOString().slice(0, 10)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Semantic Clusters</title>
<style>
${BASE_CSS}
.layout{display:flex;height:calc(100vh - 45px);overflow:hidden}
#viz-canvas{flex:1;display:block;cursor:grab;background:#13141f}
#viz-canvas:active{cursor:grabbing}
#cluster-list{width:270px;overflow-y:auto;padding:10px;background:#1e2030;border-left:1px solid #2f3451;flex-shrink:0}
#cluster-list h2{font-size:13px;font-weight:600;color:#7dcfff;margin-bottom:8px}
.ci{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:6px;margin-bottom:7px;cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;background:#24283b}
.ci:hover,.ci.active{border-color:#7aa2f7}
.ci-dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex-shrink:0}
.ci-name{font-weight:600;font-size:13px;color:#c0caf5}
.ci-meta{font-size:11px;color:#565f89;margin-top:1px}
.ci-enh{font-size:11px;color:#e0af68;margin-top:1px}
.ci-paths{font-size:11px;color:#9ece6a;margin-top:2px}
#gsviz-tip{position:fixed;background:#24283b;border:1px solid #414868;border-radius:6px;padding:8px 10px;pointer-events:none;display:none;z-index:100;font-size:12px;max-width:230px;line-height:1.6}
</style>
</head>
<body>
<div class="hdr">
  <h1>Semantic Clusters</h1>
  <div class="stat">clusters: <b>${escHtml(data.clusters.length)}</b></div>
  <div class="stat">blobs: <b>${escHtml(data.totalBlobs)}</b></div>
  <div class="stat">computed: <b>${escHtml(headerDate)}</b></div>
</div>
<div class="layout">
  <canvas id="viz-canvas"></canvas>
  <div id="cluster-list"><h2>Clusters</h2></div>
</div>
<div id="gsviz-tip"></div>
<script>
var DATA = ${safeJson(data)};
var PALETTE = ${safeJson(PALETTE)};
${COMMON_JS}
${CLUSTER_SIM_JS}
</script>
</body>
</html>`
}

// ─── renderClusterDiffHtml ────────────────────────────────────────────────────

// Static JS for cluster diff (no ${} interpolations in this block)
const CLUSTER_DIFF_JS = `
function driftColor(drift) {
  if (drift < 0) return "#565f89";
  if (drift < 0.05) return "#9ece6a";
  if (drift < 0.15) return "#e0af68";
  if (drift < 0.3) return "#ff9e64";
  return "#f7768e";
}
function driftLabel(drift) {
  if (drift < 0) return "n/a";
  if (drift < 0.05) return "stable";
  if (drift < 0.15) return "minor shift";
  if (drift < 0.3) return "moderate shift";
  return "large shift";
}

window.addEventListener("load", function() {
  var beforeEl = document.getElementById("diff-before");
  var afterEl = document.getElementById("diff-after");
  var svgEl = document.getElementById("diff-svg");

  function renderCluster(c, i, changeEntry) {
    var col = PALETTE[i % PALETTE.length];
    var driftStr = "";
    var badge = "";
    if (changeEntry) {
      if (changeEntry.afterCluster && changeEntry.beforeCluster) {
        var drift = changeEntry.centroidDrift;
        driftStr = "<span style=\"color:" + driftColor(drift) + "\"> · drift " + drift.toFixed(3) + " (" + driftLabel(drift) + ")</span>";
        if (changeEntry.afterCluster.label !== changeEntry.beforeCluster.label) {
          badge = "<div class=\"badge badge-relabeled\">← was " + esc(changeEntry.beforeCluster.label) + "</div>";
        }
      } else if (!changeEntry.beforeCluster) {
        badge = "<div class=\"badge badge-new\">NEW</div>";
      }
    }
    var inflows = (changeEntry && changeEntry.inflows || []).map(function(f) {
      return f.count + " from " + esc(f.fromClusterLabel);
    }).join(", ");
    var outflows = (changeEntry && changeEntry.outflows || []).map(function(f) {
      return f.count + " to " + esc(f.toClusterLabel);
    }).join(", ");
    return "<div class=\"dc\" data-id=\"" + c.id + "\">" +
      "<div class=\"dc-hd\">" +
        "<span class=\"dc-dot\" style=\"background:" + col + "\"></span>" +
        "<span class=\"dc-label\">" + esc(c.label) + "</span>" +
        "<span class=\"dc-size\">" + c.size + " blobs</span>" +
        driftStr +
      "</div>" +
      badge +
      (c.topKeywords.length > 0 ? "<div class=\"dc-kw\">" + esc(c.topKeywords.join(", ")) + "</div>" : "") +
      (c.representativePaths.length > 0 ? "<div class=\"dc-paths\">" + esc(c.representativePaths.slice(0, 3).join(", ")) + "</div>" : "") +
      (inflows ? "<div class=\"dc-flow in\">In: " + inflows + "</div>" : "") +
      (outflows ? "<div class=\"dc-flow out\">Out: " + outflows + "</div>" : "") +
      "</div>";
  }

  DATA.before.clusters.forEach(function(c, i) {
    beforeEl.innerHTML += renderCluster(c, i, null);
  });
  DATA.after.clusters.forEach(function(c, i) {
    var change = DATA.changes.find(function(ch) {
      return ch.afterCluster && ch.afterCluster.id === c.id;
    }) || null;
    afterEl.innerHTML += renderCluster(c, i, change);
  });

  DATA.changes.filter(function(ch) { return !ch.afterCluster && ch.beforeCluster; }).forEach(function(ch) {
    afterEl.innerHTML += "<div class=\"dc dissolved\"><div class=\"dc-hd\"><span class=\"dc-label\">" + esc(ch.beforeCluster.label) + "</span></div><div class=\"badge badge-dissolved\">DISSOLVED</div></div>";
  });

  // Draw Sankey-like SVG arrows for migrations
  var W = 200, H = 600;
  svgEl.setAttribute("viewBox", "0 0 " + W + " " + H);
  var midY = 30;
  DATA.changes.forEach(function(ch) {
    if (!ch.afterCluster || !ch.beforeCluster) return;
    var flows = ch.inflows || [];
    flows.forEach(function(f) {
      var thick = Math.max(2, Math.min(20, Math.round(f.count / 3)));
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      var y = midY;
      path.setAttribute("d", "M0," + y + " C100," + y + " 100," + y + " " + W + "," + y);
      path.setAttribute("stroke-width", String(thick));
      path.setAttribute("stroke", "rgba(115,218,202,0.7)");
      path.setAttribute("fill", "none");
      path.setAttribute("opacity", "0.8");
      var title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = f.count + " blobs: " + f.fromClusterLabel + " to " + ch.afterCluster.label;
      path.appendChild(title);
      svgEl.appendChild(path);
      midY += thick + 8;
    });
  });
});
`

export function renderClusterDiffHtml(report: TemporalClusterReport): string {
  const data = sanitizeTemporalReport(report)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Cluster Diff</title>
<style>
${BASE_CSS}
.layout{display:flex;height:calc(100vh - 45px);overflow:hidden}
.col{flex:1;overflow-y:auto;padding:10px;border-right:1px solid #2f3451}
.col:last-child{border-right:none}
.col-hd{font-size:12px;font-weight:600;color:#7dcfff;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2f3451}
.mid{flex:0 0 180px;overflow-y:auto;padding:6px}
.dc{background:#24283b;border-radius:6px;padding:8px;margin-bottom:8px;border:1px solid #2f3451}
.dc.dissolved{opacity:0.5}
.dc-hd{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
.dc-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.dc-label{font-weight:600;font-size:13px}
.dc-size{color:#565f89;font-size:11px}
.dc-kw{font-size:11px;color:#a9b1d6;margin-top:2px}
.dc-paths{font-size:11px;color:#9ece6a;margin-top:2px}
.dc-flow{font-size:11px;margin-top:2px}
.dc-flow.in{color:#73daca}
.dc-flow.out{color:#f7768e}
.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;margin:3px 0}
.badge-new{background:#1e3a2e;color:#73daca}
.badge-dissolved{background:#3b1e1e;color:#f7768e}
.badge-relabeled{background:#2e2b1e;color:#e0af68}
#diff-svg{width:100%;min-height:200px}
</style>
</head>
<body>
<div class="hdr">
  <h1>Cluster Diff</h1>
  <div class="stat">${escHtml(report.ref1)} → ${escHtml(report.ref2)}</div>
  <div class="stat">new: <b>${escHtml(data.newBlobsTotal)}</b></div>
  <div class="stat">removed: <b>${escHtml(data.removedBlobsTotal)}</b></div>
  <div class="stat">moved: <b>${escHtml(data.movedBlobsTotal)}</b></div>
  <div class="stat">stable: <b>${escHtml(data.stableBlobsTotal)}</b></div>
</div>
<div class="layout">
  <div class="col">
    <div class="col-hd">Before — ${escHtml(report.ref1)} (${escHtml(data.before.clusters.length)} clusters, ${escHtml(data.before.totalBlobs)} blobs)</div>
    <div id="diff-before"></div>
  </div>
  <div class="col mid">
    <div class="col-hd">Migration flows</div>
    <svg id="diff-svg" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
  <div class="col">
    <div class="col-hd">After — ${escHtml(report.ref2)} (${escHtml(data.after.clusters.length)} clusters, ${escHtml(data.after.totalBlobs)} blobs)</div>
    <div id="diff-after"></div>
  </div>
</div>
<script>
var DATA = ${safeJson(data)};
var PALETTE = ${safeJson(PALETTE)};
${COMMON_JS}
${CLUSTER_DIFF_JS}
</script>
</body>
</html>`
}

// ─── renderClusterTimelineHtml ────────────────────────────────────────────────

// Static JS for cluster timeline (no ${} interpolations in this block)
const CLUSTER_TIMELINE_JS = `
function driftLabel(drift) {
  if (drift < 0) return "n/a";
  if (drift < 0.05) return "stable";
  if (drift < 0.15) return "minor";
  if (drift < 0.3) return "moderate";
  return "large";
}
function driftColor(drift) {
  if (drift < 0.05) return "#9ece6a";
  if (drift < 0.15) return "#e0af68";
  if (drift < 0.3) return "#ff9e64";
  return "#f7768e";
}

window.addEventListener("load", function() {
  var wrap = document.getElementById("timeline-wrap");

  DATA.steps.forEach(function(step, si) {
    var col = document.createElement("div");
    col.className = "step";

    var hd = document.createElement("div");
    hd.className = "step-hd";
    var statStr = "";
    if (step.stats) {
      statStr = "<div class=\"step-stats\">" +
        "<span class=\"sc new\">+" + step.stats.newBlobs + "</span>" +
        "<span class=\"sc rem\">-" + step.stats.removedBlobs + "</span>" +
        "<span class=\"sc mov\">" + step.stats.movedBlobs + " moved</span>" +
        "</div>";
    }
    hd.innerHTML =
      "<div class=\"step-ref\">" + esc(step.ref) + "</div>" +
      "<div class=\"step-blobs\">" + step.blobCount + " blobs</div>" +
      statStr;
    col.appendChild(hd);

    step.clusters.forEach(function(c, ci) {
      var pill = document.createElement("div");
      pill.className = "pill";
      var color = PALETTE[ci % PALETTE.length];
      var h = Math.max(24, Math.sqrt(c.size) * 5);
      pill.style.background = color + "33";
      pill.style.borderColor = color;
      pill.style.minHeight = h + "px";

      var change = null;
      if (step.changes) {
        for (var k = 0; k < step.changes.length; k++) {
          if (step.changes[k].afterCluster && step.changes[k].afterCluster.id === c.id) {
            change = step.changes[k]; break;
          }
        }
      }
      var driftBadge = "";
      var relabelBadge = "";
      if (change && change.beforeCluster) {
        var dc = change.centroidDrift;
        driftBadge = "<span class=\"drift-dot\" style=\"background:" + driftColor(dc) + "\" title=\"drift " + dc.toFixed(3) + " (" + driftLabel(dc) + ")\"></span>";
        if (dc >= THR && change.afterCluster.label !== change.beforeCluster.label) {
          relabelBadge = "<div class=\"relabel\">← " + esc(change.beforeCluster.label) + "</div>";
        }
      } else if (change && !change.beforeCluster) {
        driftBadge = "<span class=\"badge-new\">NEW</span>";
      }
      pill.innerHTML =
        "<div class=\"pill-top\">" +
          "<span class=\"pill-dot\" style=\"background:" + color + "\"></span>" +
          "<span class=\"pill-label\">" + esc(c.label) + "</span>" +
          driftBadge +
        "</div>" +
        "<div class=\"pill-size\">" + c.size + " blobs</div>" +
        (c.topKeywords.length > 0 ? "<div class=\"pill-kw\">" + esc(c.topKeywords.slice(0, 3).join(", ")) + "</div>" : "") +
        relabelBadge;
      col.appendChild(pill);
    });

    if (step.changes) {
      step.changes.filter(function(ch) { return !ch.afterCluster && ch.beforeCluster; }).forEach(function(ch) {
        var pill = document.createElement("div");
        pill.className = "pill dissolved";
        pill.innerHTML = "<div class=\"pill-top\"><span class=\"pill-label\">" + esc(ch.beforeCluster.label) + "</span><span class=\"badge-dissolved\">DISSOLVED</span></div>";
        col.appendChild(pill);
      });
    }

    wrap.appendChild(col);
  });
});
`

export function renderClusterTimelineHtml(report: ClusterTimelineReport, threshold = 0.15): string {
  const data = sanitizeTimelineReport(report)
  const sinceStr = new Date(data.since * 1000).toISOString().slice(0, 10)
  const untilStr = new Date(data.until * 1000).toISOString().slice(0, 10)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Cluster Timeline</title>
<style>
${BASE_CSS}
.tl-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
#timeline-wrap{display:flex;gap:12px;padding:4px;min-width:max-content}
.step{min-width:220px;max-width:280px;background:#1e2030;border-radius:8px;padding:8px;border:1px solid #2f3451}
.step-hd{margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2f3451}
.step-ref{font-weight:600;color:#7aa2f7;font-size:13px}
.step-blobs{font-size:11px;color:#565f89;margin-top:2px}
.step-stats{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.sc{font-size:11px;padding:1px 6px;border-radius:4px}
.sc.new{background:#1e3a2e;color:#73daca}
.sc.rem{background:#3b1e1e;color:#f7768e}
.sc.mov{background:#2e2b1e;color:#e0af68}
.pill{border:1px solid;border-radius:6px;padding:6px;margin-bottom:6px;transition:opacity 0.2s}
.pill.dissolved{opacity:0.4}
.pill-top{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.pill-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.pill-label{font-weight:600;font-size:12px;color:#c0caf5}
.drift-dot{width:8px;height:8px;border-radius:50%;display:inline-block;cursor:help}
.pill-size{font-size:11px;color:#565f89;margin-top:2px}
.pill-kw{font-size:11px;color:#a9b1d6;margin-top:2px}
.relabel{font-size:11px;color:#e0af68;margin-top:2px;font-style:italic}
.badge-new{font-size:10px;background:#1e3a2e;color:#73daca;padding:1px 4px;border-radius:3px}
.badge-dissolved{font-size:10px;background:#3b1e1e;color:#f7768e;padding:1px 4px;border-radius:3px}
</style>
</head>
<body>
<div class="hdr">
  <h1>Cluster Timeline</h1>
  <div class="stat">${escHtml(sinceStr)} → ${escHtml(untilStr)}</div>
  <div class="stat">steps: <b>${escHtml(data.steps.length)}</b></div>
  <div class="stat">k: <b>${escHtml(data.k)}</b></div>
</div>
<div class="tl-wrap">
  <div id="timeline-wrap"></div>
</div>
<script>
var DATA = ${safeJson(data)};
var PALETTE = ${safeJson(PALETTE)};
var THR = ${threshold};
${COMMON_JS}
${CLUSTER_TIMELINE_JS}
</script>
</body>
</html>`
}

// ─── renderConceptEvolutionHtml ───────────────────────────────────────────────

// Static JS for concept evolution timeline (no ${} interpolations in this block)
const CONCEPT_EVOLUTION_JS = `
window.addEventListener("load", function() {
  var tbl = document.getElementById("ce-table");
  var summary = document.getElementById("ce-summary");
  var maxDist = 0, sumScore = 0;

  DATA.entries.forEach(function(e, i) {
    if (e.distFromPrev > maxDist) maxDist = e.distFromPrev;
    sumScore += e.score || 0;

    var row = document.createElement("div");
    row.className = "ce-row";
    if (i === 0) row.className += " origin";
    else if (e.distFromPrev >= THR) row.className += " large-change";

    var d = new Date((e.timestamp || 0) * 1000);
    var dateStr = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    var path0 = e.paths.length > 0 ? e.paths[0] : "(unknown)";
    var scoreW = Math.round(Math.min(100, (e.score || 0) * 100));
    var badge = i === 0
      ? "<span class=\"badge origin-badge\">origin</span>"
      : e.distFromPrev >= THR
        ? "<span class=\"badge lc-badge\">large change</span>"
        : "";

    row.innerHTML =
      "<div class=\"ce-date\">" + esc(dateStr) + "</div>" +
      "<div class=\"ce-path\">" + esc(path0) + "</div>" +
      "<div class=\"ce-score\"><div class=\"score-bar\" style=\"width:" + scoreW + "%\"></div></div>" +
      "<div class=\"ce-dist\">" + (e.distFromPrev || 0).toFixed(3) + "</div>" +
      "<div class=\"ce-badge\">" + badge + "</div>";

    row.addEventListener("click", function() {
      var ex = this.querySelector(".ce-expand");
      if (ex) { ex.remove(); return; }
      var exd = document.createElement("div");
      exd.className = "ce-expand";
      exd.innerHTML =
        "<div class=\"ce-ex-row\"><b>All paths:</b> " + esc(e.paths.join(", ")) + "</div>" +
        "<div class=\"ce-ex-row\"><b>Blob:</b> " + esc(e.blobHash) + "</div>" +
        "<div class=\"ce-ex-row\"><b>Commit:</b> " + esc(e.commitHash) + "</div>" +
        "<div class=\"ce-ex-row\"><b>Score:</b> " + (e.score || 0).toFixed(4) + " &nbsp; <b>dist_prev:</b> " + (e.distFromPrev || 0).toFixed(4) + "</div>";
      this.appendChild(exd);
    });

    tbl.appendChild(row);
  });

  var avgScore = DATA.entries.length > 0 ? (sumScore / DATA.entries.length) : 0;
  summary.textContent =
    DATA.entries.length + " entries · max dist " + maxDist.toFixed(3) + " · avg score " + avgScore.toFixed(3);
});
`

export function renderConceptEvolutionHtml(
  query: string,
  entries: ConceptEvolutionEntry[],
  threshold: number,
): string {
  const sanitized = (entries ?? []).map((e) => ({
    blobHash: e.blobHash,
    commitHash: e.commitHash,
    timestamp: e.timestamp,
    paths: e.paths ?? [],
    score: e.score,
    distFromPrev: e.distFromPrev,
  }))
  const data = { query, entries: sanitized }
  const largeChanges = sanitized.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Concept Evolution</title>
<style>
${BASE_CSS}
.ce-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
.ce-col-hd{display:flex;gap:0;padding:6px 8px;font-size:11px;font-weight:600;color:#565f89;margin-bottom:4px;border-bottom:1px solid #2f3451}
.ce-col-hd .h-date{width:90px;flex-shrink:0}
.ce-col-hd .h-path{flex:1;min-width:0}
.ce-col-hd .h-score{width:90px;flex-shrink:0}
.ce-col-hd .h-dist{width:55px;flex-shrink:0;text-align:right}
.ce-col-hd .h-badge{width:90px;flex-shrink:0}
.ce-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid transparent;transition:border-color 0.1s}
.ce-row:hover{border-color:#2f3451}
.ce-row.origin{background:rgba(122,162,247,0.06)}
.ce-row.large-change{background:rgba(247,118,142,0.06)}
.ce-date{width:90px;flex-shrink:0;font-size:12px;color:#565f89}
.ce-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#c0caf5}
.ce-score{width:90px;flex-shrink:0;background:#2f3451;border-radius:4px;height:10px;overflow:hidden}
.score-bar{height:100%;background:#7aa2f7;border-radius:4px}
.ce-dist{width:55px;flex-shrink:0;text-align:right;font-size:12px;font-family:monospace;color:#a9b1d6}
.ce-badge{width:90px;flex-shrink:0}
.badge{padding:1px 6px;border-radius:4px;font-size:11px}
.origin-badge{background:rgba(122,162,247,0.2);color:#7aa2f7}
.lc-badge{background:rgba(247,118,142,0.2);color:#f7768e}
.ce-expand{grid-column:1/-1;background:#24283b;border-radius:4px;margin-top:4px;font-size:12px;color:#a9b1d6;padding:6px 8px;width:100%}
.ce-ex-row{margin-bottom:3px}
</style>
</head>
<body>
<div class="hdr">
  <h1>Concept Evolution</h1>
  <div class="stat">query: <b>${escHtml(query)}</b></div>
  <div class="stat">entries: <b>${escHtml(sanitized.length)}</b></div>
  <div class="stat">large changes: <b>${escHtml(largeChanges)}</b></div>
  <span id="ce-summary" style="font-size:12px;color:#565f89"></span>
</div>
<div class="ce-wrap">
  <div class="ce-col-hd">
    <div class="h-date">Date</div>
    <div class="h-path">Path</div>
    <div class="h-score">Score</div>
    <div class="h-dist">Dist</div>
    <div class="h-badge">Note</div>
  </div>
  <div id="ce-table"></div>
</div>
<script>
var DATA = ${safeJson(data)};
var THR = ${threshold};
${COMMON_JS}
${CONCEPT_EVOLUTION_JS}
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// renderFileEvolutionHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderFileEvolutionHtml(
  filePath: string,
  entries: EvolutionEntry[],
  threshold: number,
): string {
  const data = {
    filePath,
    threshold,
    entries: entries.map((e) => ({
      blobHash: e.blobHash,
      commitHash: e.commitHash,
      timestamp: e.timestamp,
      distFromPrev: e.distFromPrev,
      distFromOrigin: e.distFromOrigin,
    })),
  }
  const largeChanges = entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — File Evolution: ${escHtml(filePath)}</title>
<style>
${BASE_CSS}
.fe-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
.fe-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;border:1px solid transparent;transition:border-color 0.1s;font-size:12px}
.fe-row:hover{border-color:#2f3451}
.fe-row.origin{background:rgba(122,162,247,0.06)}
.fe-row.large-change{background:rgba(247,118,142,0.06)}
.fe-date{width:90px;flex-shrink:0;color:#565f89}
.fe-hash{width:70px;flex-shrink:0;font-family:monospace;color:#7aa2f7}
.fe-bar-wrap{flex:1;background:#2f3451;border-radius:4px;height:10px;overflow:hidden}
.fe-bar{height:100%;border-radius:4px}
.fe-dist{width:50px;flex-shrink:0;text-align:right;font-family:monospace;color:#a9b1d6}
.fe-badge{width:90px;flex-shrink:0}
.badge{padding:1px 6px;border-radius:4px;font-size:11px}
.origin-badge{background:rgba(122,162,247,0.2);color:#7aa2f7}
.lc-badge{background:rgba(247,118,142,0.2);color:#f7768e}
</style>
</head>
<body>
<div class="hdr">
  <h1>File Evolution</h1>
  <div class="stat">file: <b>${escHtml(filePath)}</b></div>
  <div class="stat">versions: <b>${escHtml(entries.length)}</b></div>
  <div class="stat">large changes: <b>${escHtml(largeChanges)}</b></div>
</div>
<div class="fe-wrap" id="fe-table"></div>
<script>
var DATA = ${safeJson(data)};
var THR = ${threshold};
${COMMON_JS}
(function() {
  var entries = DATA.entries;
  var container = document.getElementById("fe-table");
  entries.forEach(function(e, i) {
    var date = e.timestamp ? new Date(e.timestamp * 1000).toISOString().slice(0, 10) : "?";
    var hash = e.commitHash ? e.commitHash.slice(0, 7) : "?";
    var dist = e.distFromPrev.toFixed(3);
    var pct = Math.min(100, Math.round(e.distFromPrev / 2 * 100));
    var barColor = e.distFromPrev >= THR ? "#f7768e" : "#7aa2f7";
    var rowClass = "fe-row" + (i === 0 ? " origin" : (e.distFromPrev >= THR ? " large-change" : ""));
    var badge = i === 0
      ? "<span class=\"badge origin-badge\">origin</span>"
      : (e.distFromPrev >= THR ? "<span class=\"badge lc-badge\">large change</span>" : "");
    var row = "<div class=\"" + rowClass + "\">" +
      "<div class=\"fe-date\">" + date + "</div>" +
      "<div class=\"fe-hash\">" + hash + "</div>" +
      "<div class=\"fe-bar-wrap\"><div class=\"fe-bar\" style=\"width:" + pct + "%;background:" + barColor + "\"></div></div>" +
      "<div class=\"fe-dist\">" + dist + "</div>" +
      "<div class=\"fe-badge\">" + badge + "</div>" +
      "</div>";
    container.insertAdjacentHTML("beforeend", row);
  });
})();
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// renderConceptChangePointsHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderConceptChangePointsHtml(report: ConceptChangePointReport): string {
  const data = {
    query: report.query,
    k: report.k,
    threshold: report.threshold,
    range: report.range,
    points: (report.points ?? []).map((p) => ({
      before: p.before,
      after: p.after,
      distance: p.distance,
      topPaths: [...(p.after.topPaths ?? [])],
    })),
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Concept Change Points</title>
<style>
${BASE_CSS}
.cp-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
.cp-card{background:#1e2030;border:1px solid #2f3451;border-radius:8px;margin-bottom:12px;padding:12px}
.cp-header{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.cp-rank{width:28px;height:28px;background:#2f3451;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#7aa2f7;flex-shrink:0}
.cp-dates{font-size:13px;color:#c0caf5}
.cp-arrow{color:#565f89;margin:0 4px}
.cp-dist{margin-left:auto;font-size:13px;font-family:monospace;color:#e0af68}
.cp-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.cp-bar-wrap{flex:1;background:#2f3451;border-radius:4px;height:10px;overflow:hidden}
.cp-bar{height:100%;background:#f7768e;border-radius:4px}
.cp-paths{margin-top:6px;font-size:12px;color:#565f89}
.cp-path{padding:2px 0;color:#a9b1d6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
</head>
<body>
<div class="hdr">
  <h1>Concept Change Points</h1>
  <div class="stat">query: <b>${escHtml(report.query)}</b></div>
  <div class="stat">points found: <b>${escHtml(data.points.length)}</b></div>
  <div class="stat">range: <b>${escHtml(report.range.since)} → ${escHtml(report.range.until)}</b></div>
</div>
<div class="cp-wrap" id="cp-container"></div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function() {
  var points = DATA.points;
  var container = document.getElementById("cp-container");
  if (points.length === 0) {
    container.innerHTML = "<div style=\"padding:20px;color:#565f89\">No change points detected.</div>";
    return;
  }
  var maxDist = Math.max.apply(null, points.map(function(p) { return p.distance; }));
  points.forEach(function(p, i) {
    var pct = maxDist > 0 ? Math.round(p.distance / maxDist * 100) : 0;
    var paths = (p.topPaths || []).slice(0, 5).map(function(path) {
      return "<div class=\"cp-path\">" + escHtml(path) + "</div>";
    }).join("");
    var card = "<div class=\"cp-card\">" +
      "<div class=\"cp-header\">" +
      "<div class=\"cp-rank\">" + (i + 1) + "</div>" +
      "<div class=\"cp-dates\">" + escHtml(p.before.date) + "<span class=\"cp-arrow\">→</span>" + escHtml(p.after.date) + "</div>" +
      "<div class=\"cp-dist\">dist " + p.distance.toFixed(4) + "</div>" +
      "</div>" +
      "<div class=\"cp-bar-row\"><div class=\"cp-bar-wrap\"><div class=\"cp-bar\" style=\"width:" + pct + "%\"></div></div></div>" +
      (paths ? "<div class=\"cp-paths\">" + paths + "</div>" : "") +
      "</div>";
    container.insertAdjacentHTML("beforeend", card);
  });
})();
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// renderFileChangePointsHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderFileChangePointsHtml(report: FileChangePointReport): string {
  const data = {
    path: report.path,
    threshold: report.threshold,
    range: report.range,
    points: (report.points ?? []).map((p) => ({
      before: p.before,
      after: p.after,
      distance: p.distance,
    })),
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — File Change Points: ${escHtml(report.path)}</title>
<style>
${BASE_CSS}
.fcp-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
.fcp-card{background:#1e2030;border:1px solid #2f3451;border-radius:8px;margin-bottom:10px;padding:12px}
.fcp-header{display:flex;align-items:center;gap:12px}
.fcp-rank{width:28px;height:28px;background:#2f3451;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#7aa2f7;flex-shrink:0}
.fcp-commits{font-size:12px;font-family:monospace;color:#c0caf5}
.fcp-dates{font-size:12px;color:#565f89;margin-left:6px}
.fcp-arrow{color:#565f89;margin:0 4px}
.fcp-dist{margin-left:auto;font-size:13px;font-family:monospace;color:#e0af68}
.fcp-bar-row{display:flex;align-items:center;gap:8px;margin-top:8px}
.fcp-bar-wrap{flex:1;background:#2f3451;border-radius:4px;height:10px;overflow:hidden}
.fcp-bar{height:100%;background:#f7768e;border-radius:4px}
</style>
</head>
<body>
<div class="hdr">
  <h1>File Change Points</h1>
  <div class="stat">file: <b>${escHtml(report.path)}</b></div>
  <div class="stat">points found: <b>${escHtml(data.points.length)}</b></div>
</div>
<div class="fcp-wrap" id="fcp-container"></div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function() {
  var points = DATA.points;
  var container = document.getElementById("fcp-container");
  if (points.length === 0) {
    container.innerHTML = "<div style=\"padding:20px;color:#565f89\">No change points detected.</div>";
    return;
  }
  var maxDist = Math.max.apply(null, points.map(function(p) { return p.distance; }));
  points.forEach(function(p, i) {
    var pct = maxDist > 0 ? Math.round(p.distance / maxDist * 100) : 0;
    var card = "<div class=\"fcp-card\">" +
      "<div class=\"fcp-header\">" +
      "<div class=\"fcp-rank\">" + (i + 1) + "</div>" +
      "<div class=\"fcp-commits\"><span>" + escHtml(p.before.commit.slice(0, 7)) + "</span><span class=\"fcp-arrow\">→</span><span>" + escHtml(p.after.commit.slice(0, 7)) + "</span></div>" +
      "<div class=\"fcp-dates\">" + escHtml(p.before.date) + "<span class=\"fcp-arrow\">→</span>" + escHtml(p.after.date) + "</div>" +
      "<div class=\"fcp-dist\">dist " + p.distance.toFixed(4) + "</div>" +
      "</div>" +
      "<div class=\"fcp-bar-row\"><div class=\"fcp-bar-wrap\"><div class=\"fcp-bar\" style=\"width:" + pct + "%\"></div></div></div>" +
      "</div>";
    container.insertAdjacentHTML("beforeend", card);
  });
})();
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// renderClusterChangePointsHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderClusterChangePointsHtml(report: ClusterChangePointReport): string {
  const data = {
    k: report.k,
    threshold: report.threshold,
    range: report.range,
    points: (report.points ?? []).map((p) => ({
      before: { ref: p.before.ref, timestamp: p.before.timestamp },
      after: { ref: p.after.ref, timestamp: p.after.timestamp },
      shiftScore: p.shiftScore,
      movingPairs: (p.topMovingPairs ?? []).map((dc) => ({
        label: dc.afterLabel,
        drift: dc.drift,
      })),
    })),
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Cluster Change Points</title>
<style>
${BASE_CSS}
.ccp-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
.ccp-card{background:#1e2030;border:1px solid #2f3451;border-radius:8px;margin-bottom:12px;padding:12px}
.ccp-header{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.ccp-rank{width:28px;height:28px;background:#2f3451;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#bb9af7;flex-shrink:0}
.ccp-dates{font-size:13px;color:#c0caf5}
.ccp-arrow{color:#565f89;margin:0 4px}
.ccp-score{margin-left:auto;font-size:13px;font-family:monospace;color:#e0af68}
.ccp-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.ccp-bar-wrap{flex:1;background:#2f3451;border-radius:4px;height:10px;overflow:hidden}
.ccp-bar{height:100%;background:#bb9af7;border-radius:4px}
.ccp-cluster{margin-top:4px;font-size:12px;color:#a9b1d6;padding:4px 8px;background:#24283b;border-radius:4px}
.ccp-cluster-label{color:#7aa2f7;font-weight:600}
</style>
</head>
<body>
<div class="hdr">
  <h1>Cluster Change Points</h1>
  <div class="stat">points found: <b>${escHtml(data.points.length)}</b></div>
  <div class="stat">range: <b>${escHtml(report.range.since)} → ${escHtml(report.range.until)}</b></div>
</div>
<div class="ccp-wrap" id="ccp-container"></div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function() {
  var points = DATA.points;
  var container = document.getElementById("ccp-container");
  if (points.length === 0) {
    container.innerHTML = "<div style=\"padding:20px;color:#565f89\">No change points detected.</div>";
    return;
  }
  var maxScore = Math.max.apply(null, points.map(function(p) { return p.shiftScore; }));
  points.forEach(function(p, i) {
    var pct = maxScore > 0 ? Math.round(p.shiftScore / maxScore * 100) : 0;
    var clusters = (p.movingPairs || []).slice(0, 5).map(function(dc) {
      return "<div class=\"ccp-cluster\"><span class=\"ccp-cluster-label\">" + escHtml(dc.label) + "</span> drift=" + dc.drift.toFixed(3) + "</div>";
    }).join("");
    var card = "<div class=\"ccp-card\">" +
      "<div class=\"ccp-header\">" +
      "<div class=\"ccp-rank\">" + (i + 1) + "</div>" +
      "<div class=\"ccp-dates\">" + escHtml(p.before.ref) + "<span class=\"ccp-arrow\">→</span>" + escHtml(p.after.ref) + "</div>" +
      "<div class=\"ccp-score\">shift " + p.shiftScore.toFixed(4) + "</div>" +
      "</div>" +
      "<div class=\"ccp-bar-row\"><div class=\"ccp-bar-wrap\"><div class=\"ccp-bar\" style=\"width:" + pct + "%\"></div></div></div>" +
      clusters +
      "</div>";
    container.insertAdjacentHTML("beforeend", card);
  });
})();
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// renderDeadConceptsHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderDeadConceptsHtml(results: DeadConceptResult[]): string {
  const data = results.map((r) => ({
    blobHash: r.blobHash,
    paths: r.paths,
    score: r.score,
    lastSeenCommit: r.lastSeenCommit,
    lastSeenDate: r.lastSeenDate,
    lastSeenMessage: r.lastSeenMessage,
  }))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Dead Concepts</title>
<style>
${BASE_CSS}
.dc-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
.dc-card{background:#1e2030;border:1px solid #2f3451;border-radius:8px;margin-bottom:10px;padding:12px}
.dc-header{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.dc-rank{width:24px;height:24px;background:#2f3451;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#f7768e;flex-shrink:0}
.dc-path{font-size:13px;color:#c0caf5;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-score{font-size:12px;font-family:monospace;color:#9ece6a;flex-shrink:0}
.dc-meta{font-size:12px;color:#565f89}
.dc-msg{font-size:12px;color:#a9b1d6;margin-top:2px}
.dc-hash{font-family:monospace;color:#7aa2f7}
</style>
</head>
<body>
<div class="hdr">
  <h1>Dead Concepts</h1>
  <div class="stat">results: <b>${escHtml(results.length)}</b></div>
</div>
<div class="dc-wrap" id="dc-container"></div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function() {
  var container = document.getElementById("dc-container");
  DATA.forEach(function(r, i) {
    var mainPath = r.paths[0] || r.blobHash.slice(0, 7);
    var date = r.lastSeenDate ? new Date(r.lastSeenDate * 1000).toISOString().slice(0, 10) : "?";
    var commit = r.lastSeenCommit ? r.lastSeenCommit.slice(0, 7) : "?";
    var msg = r.lastSeenMessage || "";
    var extraPaths = r.paths.length > 1
      ? "<div class=\"dc-meta\" style=\"margin-top:2px\">also: " + r.paths.slice(1, 4).map(escHtml).join(", ") + (r.paths.length > 4 ? " +" + (r.paths.length - 4) + " more" : "") + "</div>"
      : "";
    var card = "<div class=\"dc-card\">" +
      "<div class=\"dc-header\">" +
      "<div class=\"dc-rank\">" + (i + 1) + "</div>" +
      "<div class=\"dc-path\">" + escHtml(mainPath) + "</div>" +
      "<div class=\"dc-score\">sim " + r.score.toFixed(3) + "</div>" +
      "</div>" +
      "<div class=\"dc-meta\">last seen <span class=\"dc-hash\">" + escHtml(commit) + "</span> on " + escHtml(date) + "</div>" +
      (msg ? "<div class=\"dc-msg\">" + escHtml(msg) + "</div>" : "") +
      extraPaths +
      "</div>";
    container.insertAdjacentHTML("beforeend", card);
  });
})();
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// renderMergeAuditHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderMergeAuditHtml(report: SemanticCollisionReport): string {
  const data = {
    branchA: report.branchA,
    branchB: report.branchB,
    mergeBase: report.mergeBase,
    blobCountA: report.blobCountA,
    blobCountB: report.blobCountB,
    centroidSimilarity: report.centroidSimilarity,
    collisionZones: (report.collisionZones ?? []).map((z) => ({
      clusterLabel: z.clusterLabel,
      pairCount: z.pairCount,
      topPaths: z.topPaths ?? [],
    })),
    collisionPairs: (report.collisionPairs ?? []).map((p) => ({
      pathA: p.blobA.paths[0] ?? p.blobA.hash.slice(0, 7),
      pathB: p.blobB.paths[0] ?? p.blobB.hash.slice(0, 7),
      similarity: p.similarity,
      clusterLabel: p.clusterLabel,
    })),
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Merge Audit: ${escHtml(report.branchA)} ↔ ${escHtml(report.branchB)}</title>
<style>
${BASE_CSS}
.ma-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px)}
.ma-zones{margin-bottom:16px}
.ma-zone{background:#1e2030;border:1px solid #2f3451;border-radius:6px;padding:10px;margin-bottom:8px}
.ma-zone-label{font-size:13px;color:#7aa2f7;font-weight:600;margin-bottom:4px}
.ma-zone-count{font-size:12px;color:#565f89}
.ma-zone-paths{font-size:12px;color:#a9b1d6;margin-top:4px}
.ma-pairs-title{font-size:13px;color:#c0caf5;font-weight:600;margin-bottom:8px}
.ma-pair{display:flex;align-items:flex-start;gap:10px;padding:8px;background:#1e2030;border:1px solid #2f3451;border-radius:6px;margin-bottom:8px;font-size:12px}
.ma-pair-rank{width:24px;height:24px;background:#2f3451;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#f7768e;flex-shrink:0}
.ma-pair-paths{flex:1;min-width:0}
.ma-pair-path{color:#a9b1d6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px}
.ma-pair-sim{flex-shrink:0;font-family:monospace;color:#9ece6a}
.ma-cluster-tag{font-size:11px;color:#bb9af7;margin-top:4px}
</style>
</head>
<body>
<div class="hdr">
  <h1>Merge Audit</h1>
  <div class="stat"><b>${escHtml(report.branchA)}</b> ↔ <b>${escHtml(report.branchB)}</b></div>
  <div class="stat">collisions: <b>${escHtml(data.collisionPairs.length)}</b></div>
  <div class="stat">centroid sim: <b>${report.centroidSimilarity >= 0 ? report.centroidSimilarity.toFixed(3) : 'n/a'}</b></div>
</div>
<div class="ma-wrap">
  <div class="ma-zones" id="ma-zones"></div>
  <div class="ma-pairs-title">Top collision pairs</div>
  <div id="ma-pairs"></div>
</div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function() {
  var zonesEl = document.getElementById("ma-zones");
  var pairsEl = document.getElementById("ma-pairs");
  DATA.collisionZones.forEach(function(z) {
    var paths = z.topPaths.slice(0, 4).map(function(p) { return "<div>" + escHtml(p) + "</div>"; }).join("");
    zonesEl.insertAdjacentHTML("beforeend",
      "<div class=\"ma-zone\">" +
      "<div class=\"ma-zone-label\">" + escHtml(z.clusterLabel) + " <span class=\"ma-zone-count\">(" + z.pairCount + " pair(s))</span></div>" +
      (paths ? "<div class=\"ma-zone-paths\">" + paths + "</div>" : "") +
      "</div>");
  });
  if (DATA.collisionZones.length === 0) zonesEl.style.display = "none";
  DATA.collisionPairs.forEach(function(p, i) {
    pairsEl.insertAdjacentHTML("beforeend",
      "<div class=\"ma-pair\">" +
      "<div class=\"ma-pair-rank\">" + (i + 1) + "</div>" +
      "<div class=\"ma-pair-paths\">" +
      "<div class=\"ma-pair-path\">" + escHtml(p.pathA) + "</div>" +
      "<div class=\"ma-pair-path\">" + escHtml(p.pathB) + "</div>" +
      (p.clusterLabel ? "<div class=\"ma-cluster-tag\">" + escHtml(p.clusterLabel) + "</div>" : "") +
      "</div>" +
      "<div class=\"ma-pair-sim\">" + p.similarity.toFixed(3) + "</div>" +
      "</div>");
  });
  if (DATA.collisionPairs.length === 0) {
    pairsEl.innerHTML = "<div style=\"color:#565f89;font-size:12px\">No collisions detected.</div>";
  }
})();
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// renderBranchSummaryHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderBranchSummaryHtml(result: BranchSummaryResult): string {
  const data = {
    branch: result.branch,
    baseBranch: result.baseBranch,
    mergeBase: result.mergeBase,
    exclusiveBlobCount: result.exclusiveBlobCount,
    nearestConcepts: (result.nearestConcepts ?? []).map((c) => ({
      clusterLabel: c.clusterLabel,
      similarity: c.similarity,
      topKeywords: c.topKeywords ?? [],
    })),
    topChangedPaths: (result.topChangedPaths ?? []).map((p) => ({
      path: p.path,
      semanticDrift: p.semanticDrift,
    })),
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — Branch Summary: ${escHtml(result.branch)}</title>
<style>
${BASE_CSS}
.bs-wrap{padding:12px;overflow:auto;height:calc(100vh - 45px);display:grid;grid-template-columns:1fr 1fr;gap:16px}
.bs-section-title{font-size:13px;font-weight:600;color:#c0caf5;margin-bottom:8px}
.bs-concept{background:#1e2030;border:1px solid #2f3451;border-radius:6px;padding:10px;margin-bottom:8px}
.bs-concept-label{font-size:13px;color:#7aa2f7;font-weight:600;margin-bottom:4px}
.bs-concept-bar-wrap{background:#2f3451;border-radius:4px;height:8px;overflow:hidden;margin-bottom:4px}
.bs-concept-bar{height:100%;background:#7aa2f7;border-radius:4px}
.bs-concept-kw{font-size:11px;color:#565f89}
.bs-path{display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 0;border-bottom:1px solid #2f3451}
.bs-path-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a9b1d6}
.bs-path-bar-wrap{width:80px;background:#2f3451;border-radius:4px;height:8px;overflow:hidden;flex-shrink:0}
.bs-path-bar{height:100%;background:#f7768e;border-radius:4px}
.bs-path-dist{width:45px;text-align:right;font-family:monospace;color:#565f89;flex-shrink:0}
</style>
</head>
<body>
<div class="hdr">
  <h1>Branch Summary</h1>
  <div class="stat">branch: <b>${escHtml(result.branch)}</b></div>
  <div class="stat">base: <b>${escHtml(result.baseBranch)}</b></div>
  <div class="stat">exclusive blobs: <b>${escHtml(result.exclusiveBlobCount)}</b></div>
</div>
<div class="bs-wrap">
  <div>
    <div class="bs-section-title">This branch is semantically about</div>
    <div id="bs-concepts"></div>
  </div>
  <div>
    <div class="bs-section-title">Top semantically-drifted files</div>
    <div id="bs-paths"></div>
  </div>
</div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function() {
  var conceptsEl = document.getElementById("bs-concepts");
  var pathsEl = document.getElementById("bs-paths");
  var maxSim = DATA.nearestConcepts.length ? DATA.nearestConcepts[0].similarity : 1;
  DATA.nearestConcepts.forEach(function(c) {
    var pct = maxSim > 0 ? Math.round(c.similarity / maxSim * 100) : 0;
    var kw = c.topKeywords.length ? c.topKeywords.slice(0, 8).join(", ") : "";
    conceptsEl.insertAdjacentHTML("beforeend",
      "<div class=\"bs-concept\">" +
      "<div class=\"bs-concept-label\">" + escHtml(c.clusterLabel) + "</div>" +
      "<div class=\"bs-concept-bar-wrap\"><div class=\"bs-concept-bar\" style=\"width:" + pct + "%\"></div></div>" +
      "<div class=\"bs-concept-kw\">" + escHtml(c.similarity.toFixed(3)) + (kw ? "  ·  " + escHtml(kw) : "") + "</div>" +
      "</div>");
  });
  if (!DATA.nearestConcepts.length) conceptsEl.innerHTML = "<div style=\"color:#565f89;font-size:12px\">No concept clusters available.</div>";
  var maxDrift = DATA.topChangedPaths.length ? DATA.topChangedPaths[0].semanticDrift : 1;
  DATA.topChangedPaths.forEach(function(p) {
    var pct = maxDrift > 0 ? Math.round(p.semanticDrift / maxDrift * 100) : 0;
    pathsEl.insertAdjacentHTML("beforeend",
      "<div class=\"bs-path\">" +
      "<div class=\"bs-path-name\">" + escHtml(p.path) + "</div>" +
      "<div class=\"bs-path-bar-wrap\"><div class=\"bs-path-bar\" style=\"width:" + pct + "%\"></div></div>" +
      "<div class=\"bs-path-dist\">" + p.semanticDrift.toFixed(3) + "</div>" +
      "</div>");
  });
  if (!DATA.topChangedPaths.length) pathsEl.innerHTML = "<div style=\"color:#565f89;font-size:12px\">No drift data available.</div>";
})();
</script>
</body>
</html>`
}
