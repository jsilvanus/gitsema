import fs from 'fs';
import path from 'path';

const file = path.resolve(process.cwd(), 'docs', 'PLAN.md');
const txt = fs.readFileSync(file, 'utf8');
const lines = txt.split(/\r?\n/);

function slugify(s){
  return s.trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()=+\[\]{}\\\\|;:'",.<>/?]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const entries = [];
for(let i=0;i<lines.length;i++){
  const line = lines[i];
  const m = line.match(/^(#{2,3})\s+(.*)$/);
  if(m){
    const level = m[1].length; // 2 or 3
    const title = m[2].trim();
    const anchor = slugify(title);
    entries.push({line:i+1, level, title, anchor});
  }
}

// Build table header
let out = [];
out.push('## Table of Contents');
out.push('');
out.push('| Section | Line |');
out.push('|---|---:|');
for(const e of entries){
  const indent = e.level === 3 ? '  ' : '';
  const display = `${indent}[${e.title}](#${e.anchor})`;
  out.push(`| ${display} | ${e.line} |`);
}

const newToc = out.join('\n');

// Replace existing TOC block in the file between the '## Table of Contents' header
// and the next horizontal rule line ('---'). If not found, append the TOC.
const headerRegex = /^## Table of Contents\s*$/m;
const dividerRegex = /^---\s*$/m;

const headerMatch = txt.match(headerRegex);
if(!headerMatch){
  // Prepend TOC at top if header missing
  const updated = `${newToc}\n\n---\n\n${txt}`;
  fs.writeFileSync(file, updated, 'utf8');
  console.log('TOC inserted at top of', file);
} else {
  const headerIndex = txt.search(headerRegex);
  // Find divider after headerIndex
  const afterHeader = txt.slice(headerIndex);
  const dividerMatch = afterHeader.match(dividerRegex);
  if(!dividerMatch){
    // Append divider and TOC if no divider found
    const updated = txt.slice(0, headerIndex) + newToc + '\n\n---\n' + txt.slice(headerIndex + headerMatch[0].length);
    fs.writeFileSync(file, updated, 'utf8');
    console.log('TOC written into', file);
  } else {
    const dividerIndex = headerIndex + afterHeader.search(dividerRegex);
    // Replace from headerIndex up to dividerIndex (inclusive) with newToc + '\n\n---\n'
    const before = txt.slice(0, headerIndex);
    const after = txt.slice(dividerIndex + afterHeader.match(dividerRegex)[0].length);
    const updated = before + newToc + '\n\n---\n' + after;
    fs.writeFileSync(file, updated, 'utf8');
    console.log('TOC updated in', file);
  }
}
