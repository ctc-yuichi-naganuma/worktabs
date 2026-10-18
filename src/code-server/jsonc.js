// JSON with comments and trailing commas (JSONC), as VS Code keeps its settings. Read, and
// edited one member of the top-level object at a time, so that the comments and the layout of
// the rest of the file stay as they are.

const OPENERS = new Set(['{', '[', 'string', 'value']);

// The tokens of a text: { type, start, end }, type being '{', '}', '[', ']', ':', ',',
// 'string', 'value' (a number, true, false, null, or anything else outside a string) or
// 'comment'. Whitespace (and a byte order mark) is skipped.
function tokens(text) {
  const list = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c) || c === '﻿') {
      i++;
    } else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      let end = text[i + 1] === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i + 2);
      end = end < 0 ? text.length : end + (text[i + 1] === '/' ? 0 : 2);
      list.push({ type: 'comment', start: i, end });
      i = end;
    } else if ('{}[]:,'.includes(c)) {
      list.push({ type: c, start: i, end: i + 1 });
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, text.length);
      list.push({ type: 'string', start: i, end });
      i = end;
    } else {
      let j = i + 1;
      while (j < text.length && !/[\s{}[\]:,"/]/.test(text[j])) j++;
      list.push({ type: 'value', start: i, end: j });
      i = j;
    }
  }
  return list;
}

// The value of a JSONC text, or undefined when it is not valid.
function parseJsonc(text) {
  const list = tokens(String(text)).filter((t) => t.type !== 'comment');
  const kept = list.filter((t, i) => !(t.type === ',' && (list[i + 1]?.type === '}' || list[i + 1]?.type === ']')));
  try {
    return JSON.parse(kept.map((t) => text.slice(t.start, t.end)).join(' '));
  } catch {
    return undefined;
  }
}

// The members of the object a text holds: { key, start (of the key), valueStart, valueEnd,
// comma (where the comma after it is, or -1) }, and where the object closes. null when the text
// is not one object.
function topMembers(text) {
  const list = tokens(text).filter((t) => t.type !== 'comment');
  if (list[0]?.type !== '{') return null;
  const members = [];
  let i = 1;
  for (;;) {
    const token = list[i];
    if (token?.type === '}') return i === list.length - 1 ? { close: token.start, members } : null;
    if (token?.type !== 'string' || list[i + 1]?.type !== ':' || !OPENERS.has(list[i + 2]?.type)) return null;
    let key;
    try {
      key = JSON.parse(text.slice(token.start, token.end));
    } catch {
      return null;
    }
    let j = i + 2;
    let depth = 0;
    do {
      const t = list[j++];
      if (!t) return null;
      if (t.type === '{' || t.type === '[') depth++;
      else if (t.type === '}' || t.type === ']') depth--;
    } while (depth > 0);
    const member = { key, start: token.start, valueStart: list[i + 2].start, valueEnd: list[j - 1].end, comma: -1 };
    members.push(member);
    if (list[j]?.type === ',') member.comma = list[j++].start;
    else if (list[j]?.type !== '}') return null;
    i = j;
  }
}

// The whitespace before `at` on its line, or null when something else comes before it there.
function lineIndent(text, at) {
  const before = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
  return /^[ \t]*$/.test(before) ? before : null;
}

// How the members are indented: as the first one on a line of its own, else two spaces.
function memberIndent(text, members) {
  for (const member of members) {
    const indent = lineIndent(text, member.start);
    if (indent) return indent;
  }
  return '  ';
}

function formatValue(value, indent, unit, eol) {
  return JSON.stringify(value, null, unit).split('\n').join(eol + indent);
}

function setMember(text, key, value) {
  const top = topMembers(text);
  if (!top) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = memberIndent(text, top.members);
  const same = top.members.filter((m) => m.key === key);
  if (same.length) {
    // JSON takes the last of the same keys.
    const member = same[same.length - 1];
    const indent = lineIndent(text, member.start) ?? unit;
    return text.slice(0, member.valueStart) + formatValue(value, indent, unit, eol) + text.slice(member.valueEnd);
  }
  const line = `${JSON.stringify(key)}: ${formatValue(value, unit, unit, eol)}`;
  let out = text;
  let close = top.close;
  const last = top.members[top.members.length - 1];
  if (last && last.comma < 0) {
    out = `${out.slice(0, last.valueEnd)},${out.slice(last.valueEnd)}`;
    close++;
  }
  // On a line of its own before the closing brace.
  const closeIndent = lineIndent(out, close);
  if (closeIndent === null) return `${out.slice(0, close)}${eol}${unit}${line}${eol}${out.slice(close)}`;
  const lineStart = close - closeIndent.length;
  return `${out.slice(0, lineStart)}${unit}${line}${eol}${out.slice(lineStart)}`;
}

function removeMember(text, key) {
  let out = text;
  for (;;) {
    const top = topMembers(out);
    if (!top) return null;
    const index = top.members.findIndex((m) => m.key === key);
    if (index < 0) return out;
    const member = top.members[index];
    let start = member.start;
    let end = member.comma >= 0 ? member.comma + 1 : member.valueEnd;
    // A member on a line of its own goes with its line, and with a comment at its end.
    const rest = /^[ \t]*(\/\/[^\n]*)?\r?\n/.exec(out.slice(end));
    const indent = lineIndent(out, start);
    if (rest && indent !== null) {
      start -= indent.length;
      end += rest[0].length;
    }
    out = out.slice(0, start) + out.slice(end);
    // The last member takes the comma before it along.
    const previous = top.members[index - 1];
    if (member.comma < 0 && previous) out = out.slice(0, previous.comma) + out.slice(previous.comma + 1);
  }
}

// Sets the members of the object in a JSONC text (`changes`: key -> value; undefined removes
// the key) and leaves the rest of the text as it is. An empty or missing text is taken for an
// empty object. null when the text is not an object.
function editJsonc(text, changes) {
  let out = text === null || text === undefined || !String(text).trim() ? '{}\n' : String(text);
  for (const [key, value] of Object.entries(changes)) {
    out = value === undefined ? removeMember(out, key) : setMember(out, key, value);
    if (out === null) return null;
  }
  return out;
}

module.exports = { editJsonc, parseJsonc };
