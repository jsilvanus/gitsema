/**
 * Unified subgraph HTML renderer (Phase 112, knowledge-graph §9). Renders any
 * `RenderableSubgraph` — from `graph neighbors`, `graph path`, `blast-radius`,
 * `relate`, `similar`, or `hotspots` — as an interactive force-directed graph,
 * mirroring the force-sim approach in `htmlRenderer-clusters.ts`. Clicking a
 * node shows its details plus suggested follow-up CLI commands ("deep links"
 * into the other per-command HTML views — there is no live server to hyperlink
 * to directly, so the suggestion is a copyable command the user runs to
 * generate that view).
 */

import { suggestedCommands, type RenderableSubgraph } from '../graph/subgraphView.js'
import { PALETTE, escHtml, safeJson, BASE_CSS, COMMON_JS } from './htmlRenderer-shared.js'

const KIND_COLORS: Record<string, string> = {
  file: '#7aa2f7',
  external: '#565f89',
}
function colorForKind(kind: string): string {
  return KIND_COLORS[kind] ?? PALETTE[Math.abs(hashCode(kind)) % PALETTE.length]
}
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0
  return h
}

const GRAPH_SIM_JS = `
function initSim(W, H) {
  var nodes = DATA.nodes.map(function(n, i) {
    var angle = (i / DATA.nodes.length) * Math.PI * 2;
    var rad = Math.min(W, H) * 0.32;
    return {
      key: n.key,
      label: n.label,
      kind: n.kind,
      color: n.color,
      r: n.isRoot ? 16 : (8 + Math.min(10, (n.weight || 0) * 10)),
      data: n,
      x: W / 2 + Math.cos(angle) * rad,
      y: H / 2 + Math.sin(angle) * rad,
      vx: 0, vy: 0
    };
  });
  var byKey = {};
  nodes.forEach(function(n) { byKey[n.key] = n; });
  var links = DATA.edges.map(function(e) {
    var src = byKey[e.src], tgt = byKey[e.dst];
    if (!src || !tgt) return null;
    return { source: src, target: tgt, type: e.type };
  }).filter(Boolean);
  return { nodes: nodes, links: links };
}

function simTick(sim, W, H) {
  var cx = W / 2, cy = H / 2;
  var nodes = sim.nodes, links = sim.links;
  var i, j, n, l, dx, dy, dist, dsq, f;

  for (i = 0; i < nodes.length; i++) {
    nodes[i].vx += (cx - nodes[i].x) * 0.0006;
    nodes[i].vy += (cy - nodes[i].y) * 0.0006;
  }
  for (i = 0; i < links.length; i++) {
    l = links[i];
    dx = l.target.x - l.source.x;
    dy = l.target.y - l.source.y;
    dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var ideal = 130;
    f = (dist - ideal) * 0.01;
    l.source.vx += dx / dist * f; l.source.vy += dy / dist * f;
    l.target.vx -= dx / dist * f; l.target.vy -= dy / dist * f;
  }
  for (i = 0; i < nodes.length; i++) {
    for (j = i + 1; j < nodes.length; j++) {
      dx = nodes[j].x - nodes[i].x;
      dy = nodes[j].y - nodes[i].y;
      dsq = dx * dx + dy * dy || 1;
      f = 9000 / dsq;
      nodes[i].vx -= dx * f; nodes[j].vx += dx * f;
      nodes[i].vy -= dy * f; nodes[j].vy += dy * f;
    }
  }
  for (i = 0; i < nodes.length; i++) {
    n = nodes[i];
    n.vx *= 0.85; n.vy *= 0.85;
    n.x += n.vx; n.y += n.vy;
    n.x = Math.max(n.r + 2, Math.min(W - n.r - 2, n.x));
    n.y = Math.max(n.r + 2, Math.min(H - n.r - 2, n.y));
  }
}

function drawArrow(ctx, x1, y1, x2, y2, r2) {
  var dx = x2 - x1, dy = y2 - y1;
  var dist = Math.sqrt(dx * dx + dy * dy) || 1;
  var ux = dx / dist, uy = dy / dist;
  var ex = x2 - ux * (r2 + 2), ey = y2 - uy * (r2 + 2);
  var ah = 6;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * ah - uy * ah * 0.6, ey - uy * ah + ux * ah * 0.6);
  ctx.lineTo(ex - ux * ah + uy * ah * 0.6, ey - uy * ah - ux * ah * 0.6);
  ctx.closePath();
  ctx.fill();
}

function simDraw(ctx, sim, selectedKey, W, H) {
  ctx.clearRect(0, 0, W, H);
  var nodes = sim.nodes, links = sim.links;

  links.forEach(function(l) {
    ctx.beginPath();
    ctx.moveTo(l.source.x, l.source.y);
    ctx.lineTo(l.target.x, l.target.y);
    ctx.strokeStyle = "rgba(122,162,247,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = "rgba(122,162,247,0.55)";
    drawArrow(ctx, l.source.x, l.source.y, l.target.x, l.target.y, l.target.r);
  });

  nodes.forEach(function(n) {
    var sel = n.key === selectedKey;
    if (sel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 7, 0, Math.PI * 2);
      ctx.fillStyle = n.color + "22";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = n.color + (n.data.isRoot ? "ee" : "99");
    ctx.fill();
    ctx.strokeStyle = n.data.isRoot ? "#fff" : n.color;
    ctx.lineWidth = n.data.isRoot ? 2.5 : 1.2;
    ctx.stroke();
  });
}

window.addEventListener("load", function() {
  var canvas = document.getElementById("viz-canvas");
  var ctx = canvas.getContext("2d");
  var detail = document.getElementById("node-detail");
  var W = 0, H = 0;
  var sim = null;
  var selectedKey = null;
  var drag = null;

  function resize() {
    W = canvas.offsetWidth;
    H = canvas.offsetHeight;
    canvas.width = W * (window.devicePixelRatio || 1);
    canvas.height = H * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    if (!sim) sim = initSim(W, H);
  }

  function showDetail(n) {
    var cmds = (n.data.commands || []).map(function(c) {
      return "<div class=\\"cmd\\">" + esc(c) + "</div>";
    }).join("");
    detail.innerHTML =
      "<div class=\\"nd-name\\">" + esc(n.label) + "</div>" +
      "<div class=\\"nd-meta\\">" + esc(n.kind) + (n.data.path ? " · " + esc(n.data.path) : "") + "</div>" +
      (n.data.weight !== undefined && n.data.weight !== null ? "<div class=\\"nd-weight\\">risk " + n.data.weight.toFixed(3) + "</div>" : "") +
      "<div class=\\"nd-key\\">" + esc(n.key) + "</div>" +
      (cmds ? "<div class=\\"nd-cmds-hd\\">Suggested commands</div>" + cmds : "");
    detail.style.display = "block";
  }

  canvas.addEventListener("pointerdown", function(e) {
    if (!sim) return;
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    for (var i = 0; i < sim.nodes.length; i++) {
      var n = sim.nodes[i];
      if (Math.hypot(mx - n.x, my - n.y) < n.r + 3) {
        drag = { node: n, ox: mx - n.x, oy: my - n.y };
        canvas.setPointerCapture(e.pointerId);
        selectedKey = n.key;
        showDetail(n);
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
  window.addEventListener("resize", resize);

  function loop() {
    if (sim) { simTick(sim, W, H); simDraw(ctx, sim, selectedKey, W, H); }
    requestAnimationFrame(loop);
  }
  resize();
  loop();
});
`

export function renderGraphHtml(sub: RenderableSubgraph, opts: { title?: string } = {}): string {
  const rootSet = new Set(sub.rootKeys)
  const nodes = sub.nodes.map((n) => ({
    key: n.nodeKey,
    label: n.displayName,
    kind: n.kind,
    path: n.path ?? null,
    isRoot: rootSet.has(n.nodeKey),
    weight: sub.weights?.[n.nodeKey] ?? null,
    color: colorForKind(n.kind),
    commands: suggestedCommands(n),
  }))
  const edges = sub.edges.map((e) => ({ src: e.srcKey, dst: e.dstKey, type: e.edgeType }))
  const data = { nodes, edges, roots: sub.rootKeys }
  const title = opts.title ?? 'Subgraph'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gitsema — ${escHtml(title)}</title>
<style>
${BASE_CSS}
.layout{display:flex;height:calc(100vh - 45px);overflow:hidden}
#viz-canvas{flex:1;display:block;cursor:grab;background:#13141f}
#viz-canvas:active{cursor:grabbing}
#node-detail{width:280px;overflow-y:auto;padding:12px;background:#1e2030;border-left:1px solid #2f3451;flex-shrink:0;display:none}
.nd-name{font-weight:600;font-size:14px;color:#c0caf5;margin-bottom:4px}
.nd-meta{font-size:12px;color:#a9b1d6;margin-bottom:4px}
.nd-weight{font-size:12px;color:#e0af68;margin-bottom:4px}
.nd-key{font-size:11px;color:#565f89;margin-bottom:10px;word-break:break-all}
.nd-cmds-hd{font-size:12px;font-weight:600;color:#7dcfff;margin-bottom:6px;border-top:1px solid #2f3451;padding-top:8px}
.cmd{font-family:monospace;font-size:11px;background:#24283b;border-radius:4px;padding:6px 8px;margin-bottom:6px;word-break:break-all;color:#9ece6a}
</style>
</head>
<body>
<div class="hdr">
  <h1>${escHtml(title)}</h1>
  <div class="stat">nodes: <b>${escHtml(data.nodes.length)}</b></div>
  <div class="stat">edges: <b>${escHtml(data.edges.length)}</b></div>
</div>
<div class="layout">
  <canvas id="viz-canvas"></canvas>
  <div id="node-detail"></div>
</div>
<script>
var DATA = ${safeJson(data)};
var PALETTE = ${safeJson(PALETTE)};
${COMMON_JS}
${GRAPH_SIM_JS}
</script>
</body>
</html>`
}
