'use strict';

function spokenText(markdown, skipCode = true) {
  let fence = null;
  const lines = [];
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (skipCode && marker && !fence) fence = marker;
    else if (skipCode && marker && fence && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    else if (!fence) lines.push(line);
  }
  return lines.join('\n')
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'liên kết')
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/[`*_~|]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function speechChunks(text, limit = 1000) {
  const chunks = [];
  while (text.length > limit) {
    let end = Math.max(...['. ', '! ', '? ', '; '].map(mark => text.lastIndexOf(mark, limit - 1)));
    if (end < limit / 2) end = text.lastIndexOf(' ', limit - 1);
    end = end > 0 ? end + 1 : limit;
    // Never cut a Unicode surrogate pair in half.
    if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end).trim());
    text = text.slice(end).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}

module.exports = { spokenText, speechChunks };
