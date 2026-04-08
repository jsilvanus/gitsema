/**
 * Cluster HTML renderers (Phase 76 modularisation).
 * Covers: renderClustersHtml, renderClusterDiffHtml, renderClusterTimelineHtml.
 */
import type { ClusterReport, TemporalClusterReport, ClusterTimelineReport } from '../search/clustering.js'
import { PALETTE, escHtml, safeJson, sanitizeCluster, sanitizeClusterReport, sanitizeTemporalReport, sanitizeTimelineReport, BASE_CSS, COMMON_JS } from './htmlRenderer-shared.js'

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
