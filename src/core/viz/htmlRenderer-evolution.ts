/**
 * Evolution HTML renderers (Phase 76 modularisation).
 * Covers: renderConceptEvolutionHtml, renderFileEvolutionHtml.
 */
import type { ConceptEvolutionEntry, EvolutionEntry } from '../search/evolution.js'
import { escHtml, safeJson, BASE_CSS, COMMON_JS } from './htmlRenderer-shared.js'

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

