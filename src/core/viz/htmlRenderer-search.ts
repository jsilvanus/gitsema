/**
 * Lightweight HTML renderers for search-result and people-oriented views.
 *
 * Covers: renderSearchHtml, renderAuthorHtml, renderFirstSeenHtml,
 *         renderImpactHtml, renderExpertsHtml.
 */

import type { AuthorContribution } from '../search/authorSearch.js'
import type { ImpactReport } from '../search/impact.js'
import type { Expert } from '../search/experts.js'
import { escHtml, safeJson, BASE_CSS, COMMON_JS } from './htmlRenderer-shared.js'

export function renderSearchHtml(results: any[], query: string): string {
  const data = { query, results: results.map((r) => ({
    blobHash: r.blobHash,
    paths: r.paths ?? [],
    score: r.score,
    firstSeen: r.firstSeen ?? null,
    firstCommit: r.firstCommit ?? null,
    signals: r.signals ?? null,
  })) }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Search Results — ${escHtml(query)}</title>
<style>
${BASE_CSS}
.table{width:100%;border-collapse:collapse;margin:12px}
th,td{padding:8px;border-bottom:1px solid #232534}
th{color:#565f89;text-align:left}
.score{color:#e0af68;font-family:monospace}
.hash{color:#9ece6a;font-family:monospace}
.path{color:#c0caf5}
.sig{color:#a9b1d6;font-size:12px}
</style>
</head>
<body>
<div class="hdr"><h1>Search Results</h1><div class="stat">query: <b>${escHtml(query)}</b></div><div class="stat">hits: <b>${escHtml(data.results.length)}</b></div></div>
<div style="padding:12px;overflow:auto">
  <table class="table" id="results-table">
    <thead><tr><th>Score</th><th>Path</th><th>First seen</th><th>Hash</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function(){
  var tb = document.querySelector('#results-table tbody');
  if (!DATA.results.length) { tb.innerHTML = '<tr><td colspan="4" class="empty">(no results)</td></tr>'; return; }
  DATA.results.forEach(function(r){
    var path = (r.paths && r.paths[0]) || '(unknown)';
    var date = r.firstSeen ? new Date(r.firstSeen * 1000).toISOString().slice(0,10) : '-';
    var sig = r.signals ? ('cos=' + (r.signals.cosine||0).toFixed(3) + (r.signals.recency?(' rec=' + r.signals.recency.toFixed(3)):'')) : '';
    var row = '<tr>' +
      '<td class="score">' + (r.score||0).toFixed(3) + '</td>' +
      '<td class="path">' + esc(path) + (sig?('<div class="sig">'+esc(sig)+'</div>'): '') + '</td>' +
      '<td class="date">' + esc(date) + '</td>' +
      '<td class="hash">' + esc(r.blobHash.slice(0,7)) + '</td>' +
      '</tr>';
    tb.insertAdjacentHTML('beforeend', row);
  });
})();
</script>
</body>
</html>`
}

export function renderAuthorHtml(contributions: AuthorContribution[], query: string): string {
  const data = { query, contributions: contributions.map((c) => ({
    authorName: c.authorName,
    authorEmail: c.authorEmail,
    totalScore: c.totalScore,
    blobCount: c.blobCount,
    blobs: (c.blobs ?? []).map((b) => ({ blobHash: b.blobHash, paths: b.paths, score: b.score, timestamp: b.timestamp }))
  })) }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Author Contributions — ${escHtml(query)}</title>
<style>
${BASE_CSS}
.table{width:100%;border-collapse:collapse;margin:12px}
th,td{padding:8px;border-bottom:1px solid #232534}
th{color:#565f89;text-align:left}
.name{color:#7aa2f7;font-weight:600}
.meta{color:#a9b1d6;font-size:12px}
</style>
</head>
<body>
<div class="hdr"><h1>Author Contributions</h1><div class="stat">query: <b>${escHtml(query)}</b></div><div class="stat">authors: <b>${escHtml(data.contributions.length)}</b></div></div>
<div style="padding:12px;overflow:auto">
  <table class="table" id="auth-table"><thead><tr><th>Author</th><th>Blobs</th><th>Top score</th><th>Last contribution</th></tr></thead><tbody></tbody></table>
</div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function(){
  var tb = document.querySelector('#auth-table tbody');
  if (!DATA.contributions.length) { tb.innerHTML = '<tr><td colspan="4" class="empty">(no authors)</td></tr>'; return; }
  DATA.contributions.forEach(function(a){
    var top = (a.blobs && a.blobs.length)>0 ? Math.max.apply(null,a.blobs.map(function(b){return b.score||0;})) : 0;
    var last = (a.blobs && a.blobs.length)>0 ? new Date(a.blobs.reduce(function(m,b){return Math.max(m,b.timestamp||0);},0)*1000).toISOString().slice(0,10) : '-';
    var row = '<tr><td class="name">' + esc(a.authorName) + (a.authorEmail?(' &lt;'+esc(a.authorEmail)+'&gt;'):'') + '</td>' +
      '<td>' + (a.blobCount||0) + '</td><td class="score">' + top.toFixed(3) + '</td><td class="date">' + esc(last) + '</td></tr>';
    tb.insertAdjacentHTML('beforeend', row);
  });
})();
</script>
</body>
</html>`
}

export function renderFirstSeenHtml(results: any[], query: string): string {
  // Sort oldest-first
  const data = { query, results: (results||[]).slice().sort((a,b)=> (a.firstSeen||0)-(b.firstSeen||0)).map((r)=>({blobHash:r.blobHash, path:r.paths&&r.paths[0]||'', score:r.score, firstSeen:r.firstSeen||null})) }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>First Seen — ${escHtml(query)}</title>
<style>
${BASE_CSS}
.table{width:100%;border-collapse:collapse;margin:12px}
th,td{padding:8px;border-bottom:1px solid #232534}
</style>
</head>
<body>
<div class="hdr"><h1>First Seen</h1><div class="stat">query: <b>${escHtml(query)}</b></div><div class="stat">hits: <b>${escHtml(data.results.length)}</b></div></div>
<div style="padding:12px;overflow:auto">
  <table class="table" id="fs-table"><thead><tr><th>Date</th><th>Score</th><th>Path</th><th>Hash</th></tr></thead><tbody></tbody></table>
</div>
<script>
var DATA=${safeJson(data)};
${COMMON_JS}
(function(){
  var tb=document.querySelector('#fs-table tbody');
  DATA.results.forEach(function(r){
    var date=r.firstSeen?new Date(r.firstSeen*1000).toISOString().slice(0,10):'-';
    tb.insertAdjacentHTML('beforeend','<tr><td>'+esc(date)+'</td><td class="score">'+(r.score||0).toFixed(3)+'</td><td>'+esc(r.path)+'</td><td class="hash">'+esc(r.blobHash.slice(0,7))+'</td></tr>');
  });
})();
</script>
</body>
</html>`
}

export function renderImpactHtml(report: ImpactReport, targetPath: string): string {
  const data = { targetPath, results: report.results.map((r)=>({path:r.paths[0]||'',score:r.score,module:r.module,hash:r.blobHash.slice(0,7)})), groups: report.moduleGroups||[] }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Impact Analysis — ${escHtml(targetPath)}</title>
<style>
${BASE_CSS}
.table{width:100%;border-collapse:collapse;margin:12px}
th,td{padding:8px;border-bottom:1px solid #232534}
</style>
</head>
<body>
<div class="hdr"><h1>Impact Analysis</h1><div class="stat">target: <b>${escHtml(targetPath)}</b></div><div class="stat">coupled: <b>${escHtml(data.results.length)}</b></div></div>
<div style="padding:12px;overflow:auto">
  <table class="table"><thead><tr><th>Score</th><th>Path</th><th>Module</th><th>Hash</th></tr></thead><tbody>${data.results.map(r=>`<tr><td class="score">${r.score.toFixed(3)}</td><td class="path">${escHtml(r.path)}</td><td class="meta">${escHtml(r.module)}</td><td class="hash">${escHtml(r.hash)}</td></tr>`).join('')}</tbody></table>
  <h3 style="color:#7aa2f7">Cross-module coupling</h3>
  <div>${data.groups.map(g=>`<div style="margin:6px 0">${escHtml(g.module)}: ${g.maxScore.toFixed(3)} (${g.count})</div>`).join('')}</div>
</div>
</body>
</html>`
}

// ─── renderExpertsHtml ────────────────────────────────────────────────────────

export function renderExpertsHtml(experts: Expert[], opts: { since?: number; until?: number } = {}): string {
  const data = {
    since: opts.since ? new Date(opts.since * 1000).toISOString().slice(0, 10) : null,
    until: opts.until ? new Date(opts.until * 1000).toISOString().slice(0, 10) : null,
    experts: experts.map((e) => ({
      authorName: e.authorName,
      authorEmail: e.authorEmail,
      blobCount: e.blobCount,
      clusters: e.clusters.map((c) => ({
        label: c.label,
        blobCount: c.blobCount,
        representativePaths: c.representativePaths,
      })),
    })),
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Experts — Contributor Semantic Areas</title>
<style>
${BASE_CSS}
.table{width:100%;border-collapse:collapse;margin:12px}
th,td{padding:8px 12px;border-bottom:1px solid #232534;vertical-align:top}
th{color:#565f89;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.name{color:#7aa2f7;font-weight:600}
.email{color:#565f89;font-size:11px}
.badge{display:inline-block;background:#2f3451;color:#9ece6a;padding:1px 7px;border-radius:8px;font-size:11px;margin:2px 3px 2px 0}
.cluster-row{margin:3px 0}
.cluster-label{color:#e0af68}
.cluster-count{color:#565f89;font-size:11px}
.paths{color:#a9b1d6;font-size:11px;margin-top:2px}
</style>
</head>
<body>
<div class="hdr">
  <h1>Experts</h1>
  <div class="stat">contributors: <b>${escHtml(data.experts.length)}</b></div>
  ${data.since ? `<div class="stat">since: <b>${escHtml(data.since)}</b></div>` : ''}
  ${data.until ? `<div class="stat">until: <b>${escHtml(data.until)}</b></div>` : ''}
</div>
<div style="padding:12px;overflow:auto">
  <table class="table" id="experts-table">
    <thead><tr><th>#</th><th>Contributor</th><th>Blobs</th><th>Semantic Areas</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
<script>
var DATA = ${safeJson(data)};
${COMMON_JS}
(function(){
  var tb = document.querySelector("#experts-table tbody");
  if (!DATA.experts.length) {
    tb.innerHTML = "<tr><td colspan=\"4\" style=\"color:#565f89;padding:16px\">(no contributor data — run gitsema index first)</td></tr>";
    return;
  }
  DATA.experts.forEach(function(e, idx) {
    var clusters = "";
    if (e.clusters && e.clusters.length) {
      clusters = e.clusters.map(function(c) {
        var paths = c.representativePaths && c.representativePaths.length
          ? "<div class=\"paths\">" + c.representativePaths.slice(0,2).map(esc).join(", ") + "</div>"
          : "";
        return "<div class=\"cluster-row\"><span class=\"cluster-label\">" + esc(c.label) + "</span>" +
          " <span class=\"cluster-count\">[" + c.blobCount + " blob" + (c.blobCount !== 1 ? "s" : "") + "]</span>" +
          paths + "</div>";
      }).join("");
    } else {
      clusters = "<span style=\"color:#565f89\">(no cluster data)</span>";
    }
    var row = "<tr>" +
      "<td style=\"color:#565f89;width:32px\">" + (idx + 1) + "</td>" +
      "<td><div class=\"name\">" + esc(e.authorName) + "</div>" +
        (e.authorEmail ? "<div class=\"email\">" + esc(e.authorEmail) + "</div>" : "") + "</td>" +
      "<td><span class=\"badge\">" + e.blobCount + "</span></td>" +
      "<td>" + clusters + "</td>" +
      "</tr>";
    tb.insertAdjacentHTML("beforeend", row);
  });
})();
</script>
</body>
</html>`
}
