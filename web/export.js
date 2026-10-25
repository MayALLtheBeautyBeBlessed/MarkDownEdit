/* ============================================================
   Lanyu · 导出模型（Markdown → 供 Word 导出使用的结构化数据）
   ============================================================ */
(function (global) {
  'use strict';

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '', esc = false;
    for (const ch of s) {
      if (esc) { cur += ch; esc = false; continue; }
      if (ch === '\\') { cur += ch; esc = true; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  }

  function parseRuns(text, base) {
    base = base || {};
    const runs = [];
    const re = /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[^*\n]+?\*|_[^_\n]+?_|`[^`\n]+`|\$[^$\n]+?\$|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) runs.push(Object.assign({ x: text.slice(last, m.index) }, base));
      const tok = m[0];
      if (tok.startsWith('***')) runs.push.apply(runs, parseRuns(tok.slice(3, -3), Object.assign({}, base, { b: 1, i: 1 })));
      else if (tok.startsWith('**')) runs.push.apply(runs, parseRuns(tok.slice(2, -2), Object.assign({}, base, { b: 1 })));
      else if (tok.startsWith('__')) runs.push.apply(runs, parseRuns(tok.slice(2, -2), Object.assign({}, base, { b: 1 })));
      else if (tok.startsWith('~~')) runs.push.apply(runs, parseRuns(tok.slice(2, -2), Object.assign({}, base, { s: 1 })));
      else if (tok.startsWith('`')) runs.push({ x: tok.slice(1, -1), c: 1, link: base.link });
      else if (tok.startsWith('$')) runs.push({ x: tok.slice(1, -1), math: 1 });
      else if (tok.startsWith('![')) {
        const mm = tok.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        runs.push({ x: mm[1] || '图片', img: mm[2].replace(/^<|>$/g, '') });
      } else if (tok.startsWith('[')) {
        const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)/);
        runs.push.apply(runs, parseRuns(mm[1], Object.assign({}, base, { link: mm[2] })));
      } else if (tok.startsWith('*')) runs.push.apply(runs, parseRuns(tok.slice(1, -1), Object.assign({}, base, { i: 1 })));
      else if (tok.startsWith('_')) runs.push.apply(runs, parseRuns(tok.slice(1, -1), Object.assign({}, base, { i: 1 })));
      last = re.lastIndex;
    }
    if (last < text.length) runs.push(Object.assign({ x: text.slice(last) }, base));
    return runs.filter(r => r && r.x !== undefined);
  }

  function typeOf(src) {
    const s = src.trim();
    if (/^(```|~~~)/.test(s)) return 'code';
    const h = s.match(/^(#{1,6})\s/);
    if (h) return 'h' + h[1].length;
    if (/^>/.test(s)) return 'quote';
    if (/^([-*+]|\d{1,9}[.)])\s/.test(s)) return 'list';
    if (/^([-*_])(\s*\1){2,}$/.test(s) && s.indexOf('\n') < 0) return 'hr';
    if (/\|/.test(src) && /\n\s*\|?\s*:?-{2,}/.test(src)) return 'table';
    if (/^\s*\$\$/.test(s)) return 'math';
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(s)) return 'img';
    return 'p';
  }

  function build(markdown) {
    const parsed = (global.MD && global.MD.splitBlocks)
      ? global.MD.splitBlocks(markdown)
      : { blocks: [], prefix: '' };
    const blocks = [];

    parsed.blocks.forEach(b => {
      const src = b.src;
      if (!src.trim()) return;
      const t = typeOf(src);

      if (/^h[1-6]$/.test(t)) {
        const level = +t.slice(1);
        const text = src.trim().replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
        blocks.push({ t: 'h', level: level, runs: parseRuns(text) });
        return;
      }
      if (t === 'code') {
        const lines = src.split('\n');
        const lang = (lines[0].match(/^ {0,3}(?:```|~~~)\s*([\w+#.-]*)/) || [])[1] || '';
        const body = lines.slice(1, lines[lines.length - 1].trim().startsWith('```') || lines[lines.length - 1].trim().startsWith('~~~') ? -1 : undefined);
        blocks.push({ t: 'code', lang: lang, lines: body });
        return;
      }
      if (t === 'quote') {
        const lines = src.split('\n').map(l => l.replace(/^\s*>\s?/, ''));
        lines.forEach(l => blocks.push({ t: 'quote', runs: parseRuns(l) }));
        return;
      }
      if (t === 'list') {
        const items = [];
        src.split('\n').forEach(line => {
          const m = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
          if (!m) {
            if (items.length && line.trim()) items[items.length - 1].text += ' ' + line.trim();
            return;
          }
          const level = Math.min(3, Math.floor(m[1].replace(/\t/g, '    ').length / 2));
var text = m[3];
          var task = text.match(/^\[( |x|X)\]\s+(.*)$/);
          if (task) text = (task[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') + task[2];
          items.push({ level: level, ordered: /^\d/.test(m[2]), text: text });
        });
        blocks.push({ t: 'list', items: items.map(it => ({ level: it.level, ordered: it.ordered, runs: parseRuns(it.text) })) });
        return;
      }
      if (t === 'table') {
        const lines = src.split('\n').filter(l => l.trim());
        const header = splitRow(lines[0]);
        const aligns = splitRow(lines[1] || '').map(c => {
          const s = c.trim();
          if (/^:.*:$/.test(s)) return 'center';
          if (/:$/.test(s)) return 'right';
          return 'left';
        });
        const rows = lines.slice(2).map(l => splitRow(l));
        blocks.push({
          t: 'table',
          aligns: aligns,
          header: header.map(c => parseRuns(c.trim())),
          rows: rows.map(r => r.map(c => parseRuns(c.trim())))
        });
        return;
      }
      if (t === 'hr') { blocks.push({ t: 'hr' }); return; }
      if (t === 'math') {
        const tex = src.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '').trim();
        blocks.push({ t: 'math', tex: tex });
        return;
      }
      if (t === 'img') {
        const m = src.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        blocks.push({ t: 'img', alt: m[1], src: m[2].replace(/^<|>$/g, ''), width: 0 });
        return;
      }
      blocks.push({ t: 'p', runs: parseRuns(src) });
    });

    return { blocks: blocks };
  }

  /* 表格单元格 / 图片里的相对路径解析交给 C#，这里只给原始 src */
  global.ExportModel = { build: build, parseRuns: parseRuns };
})(window);
