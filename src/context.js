// Turns a DOM selection into { word, context }: the selected text plus the
// sentence it sits in and one sentence on each side.

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "SECTION", "ARTICLE", "TD", "TR", "TABLE", "PRE", "FIGCAPTION", "DT", "DD",
]);
const MAX_CONTEXT = 1500;

// Flattens root's text, inserting newlines at <br> and block edges, and
// reports where the selection starts within that text.
function flatten(root, range) {
  let text = "";
  let offset = -1;
  let startNode = range.startContainer;
  let startOffset = range.startOffset;
  if (startNode.nodeType !== Node.TEXT_NODE) {
    // Selection starts at an element boundary: move to the first text node at or after it.
    const anchor = startNode.childNodes[startOffset] || startNode;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    walker.currentNode = anchor;
    startNode = anchor.nodeType === Node.TEXT_NODE ? anchor : walker.nextNode();
    startOffset = 0;
  }

  (function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === startNode) offset = text.length + startOffset;
      text += node.data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (tag === "BR") { text += "\n"; return; }
    const block = BLOCK_TAGS.has(tag);
    if (block) text += "\n";
    for (const child of node.childNodes) walk(child);
    if (block) text += "\n";
  })(root);

  return { text, offset: Math.max(offset, 0) };
}

function sentenceBounds(text) {
  // Index just past each sentence-ending punctuation mark (plus closing quotes).
  const ends = [0];
  const re = /[.!?…。！？]+["'”’»)\]]*(?=\s|$)|\n\s*\n/g;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    // Merge empty "sentences" (e.g. the gap between paragraphs) into the previous boundary.
    if (text.slice(ends[ends.length - 1], end).trim() === "") ends[ends.length - 1] = end;
    else ends.push(end);
  }
  ends.push(text.length);
  return ends;
}

function clean(s) {
  return s
    .replace(/(\w)-\n(\w)/g, "$1$2") // re-join words hyphenated across PDF lines
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanWord(raw) {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Returns null when the selection is empty or too long to be "a word".
export function extractSelection(root, selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const word = cleanWord(selection.toString());
  if (!word || word.length > 80 || word.split(" ").length > 6) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const { text, offset } = flatten(root, range);

  const ends = sentenceBounds(text);
  let i = ends.findIndex((e) => e > offset);
  if (i === -1) i = ends.length - 1;
  const from = ends[Math.max(0, i - 2)];
  const to = ends[Math.min(ends.length - 1, i + 1)];

  let start = from;
  let end = to;
  if (end - start > MAX_CONTEXT) {
    start = Math.max(from, offset - MAX_CONTEXT / 2);
    end = Math.min(to, start + MAX_CONTEXT);
  }
  const context = clean(text.slice(start, end));
  const sentence = clean(text.slice(ends[Math.max(0, i - 1)], ends[i]));
  return { word, context, sentence };
}
