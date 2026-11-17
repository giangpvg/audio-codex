'use strict';

function withoutFileReferences(text) {
  return text.replace(/(`+)([^\n]*?)\1|[^\s`]+/g, (token, ticks, code) => {
    const value = (code ?? token).replace(/^[\[({<"'“‘*_]+|[\])}>"'”’*_.,;:!?]+$/g, '');
    // These product names occur in prose and are not JavaScript filenames.
    if (/^(?:node|next|vue)\.js$/i.test(value)) return token;
    const name = value.split(/[\\/]/).at(-1);
    const filename = /\.(?:[cm]?[jt]sx?|py|md|mdx|json|jsonl|ya?ml|toml|ini|cfg|conf|txt|csv|tsv|xml|html?|css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|pdf|docx?|xlsx?|pptx?|sql|sh|bash|zsh|ps1|bat|cmd|exe|dll|so|dylib|[ch]|cpp|hpp|rs|go|java|kt|php|rb|vue|svelte|vsix|mp3|wav|ogg|m4a|mp4|zip|tar|gz|7z|lock|ipynb)(?::\d+(?::\d+)?)?$/i.test(name)
      || /^(?:\.env(?:\.[\w.-]+)?|\.gitignore|\.vscodeignore|Dockerfile|Makefile|README|LICENSE)$/i.test(name);
    const rootedPath = /^(?:\.{1,2}[\\/]|~[\\/]|[a-z]:[\\/]|\/)/i.test(value);
    const inlinePath = ticks && /^(?:[^\s\\/]+[\\/])+[^\s\\/]*$/.test(value);
    return filename || rootedPath || inlinePath ? ' ' : token;
  });
}

function spokenText(markdown, skipCode = true) {
  let fence = null;
  const lines = [];
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (skipCode && marker && !fence) fence = marker;
    else if (skipCode && marker && fence && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    else if (!fence) lines.push(line);
  }
  const text = lines.join('\n')
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'liên kết');
  return withoutFileReferences(text)
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/[`*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1').trim();
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
