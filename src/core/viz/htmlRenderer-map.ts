/**
 * Analysis / map HTML renderers (Phase 76 modularisation).
 * Covers: renderConceptChangePointsHtml, renderFileChangePointsHtml,
 *         renderClusterChangePointsHtml, renderDeadConceptsHtml,
 *         renderMergeAuditHtml, renderBranchSummaryHtml, renderSemanticDiffHtml.
 */
import type { ConceptChangePointReport, FileChangePointReport } from '../search/changePoints.js'
import type { ClusterChangePointReport } from '../search/clustering.js'
import type { DeadConceptResult } from '../search/deadConcepts.js'
import type { SemanticCollisionReport } from '../search/mergeAudit.js'
import type { BranchSummaryResult } from '../search/branchSummary.js'
import type { SemanticDiffResult } from '../search/semanticDiff.js'
import { PALETTE, escHtml, safeJson, BASE_CSS, COMMON_JS } from './htmlRenderer-shared.js'

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

// ─────────────────────────────────────────────────────────────────────────────
// renderSemanticDiffHtml
// ─────────────────────────────────────────────────────────────────────────────

export function renderSemanticDiffHtml(result: SemanticDiffResult): string {
  const fmtDate = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10)
  const data = {
    topic: result.topic,
    ref1: result.ref1,
    ref2: result.ref2,
    date1: fmtDate(result.timestamp1),
    date2: fmtDate(result.timestamp2),
    gained: result.gained.map((e) => ({ path: e.paths[0] ?? '', score: e.score, date: fmtDate(e.firstSeen), hash: e.blobHash.slice(0, 7) })),
    lost:   result.lost.map((e) => ({ path: e.paths[0] ?? '', score: e.score, date: fmtDate(e.firstSeen), hash: e.blobHash.slice(0, 7) })),
    stable: result.stable.map((e) => ({ path: e.paths[0] ?? '', score: e.score, date: fmtDate(e.firstSeen), hash: e.blobHash.slice(0, 7) })),
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Semantic Diff — ${escHtml(data.topic)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#1a1b26;color:#c0caf5;margin:0;padding:20px}
  h1{color:#7aa2f7;font-size:1.3rem;margin:0 0 4px}
  .refs{color:#a9b1d6;font-size:.85rem;margin-bottom:16px}
  .section{margin-bottom:24px}
  .section-title{font-size:1rem;font-weight:600;margin-bottom:8px;padding:4px 8px;border-radius:4px}
  .gained .section-title{background:#1a2b1a;color:#9ece6a}
  .lost .section-title{background:#2b1a1a;color:#f7768e}
  .stable .section-title{background:#1a1f2b;color:#7aa2f7}
  table{width:100%;border-collapse:collapse;font-size:.83rem}
  th{color:#565f89;text-align:left;padding:4px 8px;border-bottom:1px solid #292e42}
  td{padding:4px 8px;border-bottom:1px solid #1f2335;word-break:break-all}
  .score{color:#e0af68;font-variant-numeric:tabular-nums;white-space:nowrap}
  .hash{color:#565f89;font-family:monospace;font-size:.78rem}
  .date{color:#a9b1d6;white-space:nowrap}
  .empty{color:#565f89;font-style:italic;font-size:.83rem;padding:6px 8px}
</style>
</head>
<body>
<h1>Semantic Diff: ${escHtml(data.topic)}</h1>
<div class="refs">${escHtml(data.ref1)} (${escHtml(data.date1)}) → ${escHtml(data.ref2)} (${escHtml(data.date2)})</div>
<script>var DATA=${JSON.stringify(data)};</script>
<div class="section gained">
  <div class="section-title">Gained (new in ${escHtml(data.ref2)}) — ${data.gained.length}</div>
  <div id="gained"></div>
</div>
<div class="section lost">
  <div class="section-title">Lost (removed from ${escHtml(data.ref1)}) — ${data.lost.length}</div>
  <div id="lost"></div>
</div>
<div class="section stable">
  <div class="section-title">Stable (present in both) — ${data.stable.length}</div>
  <div id="stable"></div>
</div>
<script>
function renderTable(rows, id) {
  var el = document.getElementById(id);
  if (!rows.length) { el.innerHTML = '<div class="empty">(none)</div>'; return; }
  var html = '<table><tr><th>Path</th><th>Score</th><th>First seen</th><th>Hash</th></tr>';
  rows.forEach(function(r) {
    html += '<tr><td>' + escH(r.path) + '</td><td class="score">' + r.score.toFixed(3) + '</td><td class="date">' + escH(r.date) + '</td><td class="hash">' + escH(r.hash) + '</td></tr>';
  });
  el.innerHTML = html + '</table>';
}
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
renderTable(DATA.gained, 'gained');
renderTable(DATA.lost, 'lost');
renderTable(DATA.stable, 'stable');
</script>
</body>
</html>`
}
