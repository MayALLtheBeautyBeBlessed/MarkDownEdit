/* ============================================================
   MarkEdit · 所见即所得编辑器（渲染态直接编辑）
   块内容始终是排版后的 DOM；输入即时变成格式，
   Markdown 源码由 DOM 反向序列化得到。
   ============================================================ */
(function (global) {
  'use strict';

  const NBSP = /\u00a0/g;
  let SRC_FIX = null;   // 由编辑器注入：把绝对路径转成文档相对路径
const STRUCT_TYPES = ['table', 'hr', 'math', 'img', 'code'];

  const I = {
    rowAbove: '<svg viewBox="0 0 24 24"><path d="M4 10h16M4 14v6h16v-6" opacity=".9"/><path d="M12 7V2M9.5 4.5L12 2l2.5 2.5"/></svg>',
    rowBelow: '<svg viewBox="0 0 24 24"><path d="M4 10h16M4 4v6h16V4" opacity=".9"/><path d="M12 17v5M9.5 19.5L12 22l2.5-2.5"/></svg>',
    colLeft: '<svg viewBox="0 0 24 24"><path d="M10 4v16M14 4h6v16h-6" opacity=".9"/><path d="M7 12H2M4.5 9.5L2 12l2.5 2.5"/></svg>',
    colRight: '<svg viewBox="0 0 24 24"><path d="M10 4v16M4 4h6v16H4" opacity=".9"/><path d="M17 12h5M19.5 9.5L22 12l-2.5 2.5"/></svg>',
    delRow: '<svg viewBox="0 0 24 24"><path d="M4 4h16M4 9h16M4 14h16" opacity=".55"/><path d="M9.5 19.5l5-5M14.5 19.5l-5-5"/></svg>',
    delCol: '<svg viewBox="0 0 24 24"><path d="M4 4v16M9 4v16M14 4v16" opacity=".55"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>',
    delTable: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="1.5" opacity=".55"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg>',
    alignL: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h13"/></svg>',
    alignC: '<svg viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M5.5 17h13"/></svg>',
    alignR: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 12h10M7 17h13"/></svg>'
  };

  const TABLE_BAR_HTML = [
    '<button data-act="align-left" title="整列左对齐">' + I.alignL + '</button>',
    '<button data-act="align-center" title="整列居中">' + I.alignC + '</button>',
    '<button data-act="align-right" title="整列右对齐">' + I.alignR + '</button>',
    '<span class="tb-sep"></span>',
    '<button data-act="row-above" title="上方插入行">' + I.rowAbove + '</button>',
    '<button data-act="row-below" title="下方插入行">' + I.rowBelow + '</button>',
    '<button data-act="col-left" title="左侧插入列">' + I.colLeft + '</button>',
    '<button data-act="col-right" title="右侧插入列">' + I.colRight + '</button>',
    '<span class="tb-sep"></span>',
    '<button data-act="del-row" title="删除本行">' + I.delRow + '</button>',
    '<button data-act="del-col" title="删除本列">' + I.delCol + '</button>',
    '<button data-act="del-table" class="danger" title="删除整个表格">' + I.delTable + '</button>'
  ].join('');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 类型 ---------- */
  function typeOf(src) {
    const s = src.trim();
    if (/^(```|~~~)/.test(s)) return 'code';
    const h = s.match(/^(#{1,6})(\s|$)/);
    if (h) return 'h' + h[1].length;
    if (/^>/.test(s)) return 'quote';
    if (/^([-*+]|\d{1,9}[.)])\s/.test(s)) return 'list';
    if (/^([-*_])(\s*\1){2,}$/.test(s) && s.indexOf('\n') < 0) return 'hr';
    if (/\|/.test(src) && /\n\s*\|?\s*:?-{2,}/.test(src)) return 'table';
    if (/^\s*\$\$/.test(s)) return 'math';
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(s)) return 'img';
    if (/^<img\s/i.test(s)) return 'img';
    return 'p';
  }

  /* ---------- 拆分 / 合并 ---------- */
  function splitBlocks(src) {
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    const starts = [];
    let acc = 0;
    for (let i = 0; i < lines.length; i++) { starts.push(acc); acc += lines[i].length + 1; }

    let i = 0;
    let prefix = '';
    while (i < lines.length && !lines[i].trim()) { prefix += lines[i] + '\n'; i++; }

    const blocks = [];
    while (i < lines.length) {
      const startLine = i;
      const buf = [];
      let fence = null;
      while (i < lines.length) {
        const line = lines[i];
        const fm = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fence) {
          buf.push(line);
          if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
          i++;
          continue;
        }
        if (fm) { fence = fm[1]; buf.push(line); i++; continue; }
        if (!line.trim()) break;
        buf.push(line);
        i++;
      }
      const endLine = i - 1;
      const srcEnd = (endLine + 1 < starts.length) ? starts[endLine + 1] - 1 : text.length;
      const block = { src: text.slice(starts[startLine], srcEnd), startLine: startLine, endLine: endLine, sep: '' };
      let sep = '';
      if (i < lines.length) {
        sep = '\n';
        while (i < lines.length) {
          if (i === lines.length - 1 && lines[i] === '') { i++; break; }
          if (!lines[i].trim()) { sep += '\n'; i++; } else break;
        }
      }
      block.sep = sep;
      blocks.push(block);
    }
    return { prefix: prefix, blocks: blocks, text: text };
  }

  function joinBlocks(prefix, blocks) {
    let out = prefix || '';
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.src) continue;
      out += b.src;
      let sep = b.sep || '';
      if (!sep && i < blocks.length - 1) sep = '\n\n';
      out += sep;
    }
    return out;
  }

  /* ---------- 行内序列化（DOM → Markdown） ---------- */
  function escapeText(t) {
    return String(t).replace(/([\\`*_\[\]])/g, '\\$1').replace(NBSP, ' ');
  }

  function inlineMd(node) {
    let out = '';
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { out += escapeText(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out += '\n'; continue; }
      if (tag === 'strong' || tag === 'b') { out += '**' + inlineMd(n) + '**'; continue; }
      if (tag === 'em' || tag === 'i') { out += '*' + inlineMd(n) + '*'; continue; }
      if (tag === 'del' || tag === 's' || tag === 'strike') { out += '~~' + inlineMd(n) + '~~'; continue; }
      if (tag === 'mark') { out += '==' + inlineMd(n) + '=='; continue; }
      if (tag === 'code') { out += '`' + n.textContent + '`'; continue; }
      if (tag === 'a') {
        out += '[' + inlineMd(n) + '](' + (n.getAttribute('href') || '') + ')';
        continue;
      }
      if (tag === 'img') {
        let src = (n.getAttribute('data-src') || n.getAttribute('src') || '').replace(/^file:\/\/\//, '');
        if (SRC_FIX) src = SRC_FIX(src);
        const alt = n.getAttribute('alt') || '';
        const w = n.getAttribute('width');
        out += w
          ? '<img src="' + src + '"' + (alt ? ' alt="' + alt + '"' : '') + ' width="' + w + '">'
          : '![' + alt + '](' + src + ')';
        continue;
      }
      if (tag === 'input') { continue; }
      if (tag === 'div' || tag === 'p') { out += '\n' + inlineMd(n); continue; }
      out += inlineMd(n);
    }
    return out;
  }

  /* ---------- 块序列化 ---------- */
  function serializeList(list, depth) {
    const ordered = list.tagName === 'OL';
    const pad = '  '.repeat(depth);
    const out = [];
    const lis = Array.prototype.filter.call(list.children, c => c.tagName === 'LI');
    lis.forEach((li, idx) => {
      const clone = li.cloneNode(true);
      const subs = Array.prototype.filter.call(clone.children, c => c.tagName === 'UL' || c.tagName === 'OL');
      subs.forEach(s => s.remove());
      const checkbox = clone.querySelector('input[type=checkbox]');
      const marker = checkbox
        ? (checkbox.checked ? '- [x] ' : '- [ ] ')
        : (ordered ? (idx + 1) + '. ' : '- ');
      const text = inlineMd(clone).replace(/\n+/g, ' ').trim();
      out.push(pad + marker + text);
      subs.forEach(s => out.push(serializeList(s, depth + 1)));
    });
    return out.join('\n');
  }

  function serializeBlockTable(table) {
    const rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    if (!rows.length) return '';
const cellText = td => {
      let t = inlineMd(td).replace(/\s*\n+\s*/g, '<br>').replace(/\|/g, '\\|').trim();
      t = t.replace(/^(<br>)+|(<br>)+$/g, '').trim();
      return t;
    };
    const header = Array.prototype.map.call(rows[0].children, cellText);
    const aligns = Array.prototype.map.call(rows[0].children, td => {
      const a = (td.style.textAlign || td.getAttribute('align') || 'left').toLowerCase();
      return a === 'center' ? ':---:' : a === 'right' ? '---:' : ':---';
    });
    const lines = ['| ' + header.join(' | ') + ' |', '| ' + aligns.join(' | ') + ' |'];
    rows.slice(1).forEach(tr => {
      lines.push('| ' + Array.prototype.map.call(tr.children, cellText).join(' | ') + ' |');
    });
    return lines.join('\n');
  }

  function serializeBlock(host) {
    if (!host) return '';
    const tag = host.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return '#'.repeat(+tag[1]) + ' ' + inlineMd(host).trim();
    if (tag === 'p' || tag === 'div') return inlineMd(host).trim();
    if (tag === 'blockquote') return inlineMd(host).replace(/^\n+|\n+$/g, '').split('\n').map(l => '> ' + l).join('\n');
    if (tag === 'pre') return '```' + (host.getAttribute('data-lang') || '') + '\n' + host.textContent.replace(/\n$/, '') + '\n```';
    if (tag === 'ul' || tag === 'ol') return serializeList(host, 0);
    if (tag === 'table') return serializeBlockTable(host);
    return inlineMd(host).trim();
  }

  /* ---------- 编辑器 ---------- */
  class Wysiwyg {
    constructor(opts) {
      this.root = opts.root;
      SRC_FIX = typeof opts.toRel === 'function' ? opts.toRel : null;
      this.opts = opts;
      this.prefix = '';
      this.blocks = [];
      this.focused = -1;
      this.tableEdit = null;
      this.imageSel = null;
      this.undoStack = [];
      this.redoStack = [];
      this._snapTimer = null;
      this._lastSnap = '';
      this._bind();
    }

    load(text, keepHistory) {
      const parsed = splitBlocks(text);
      this.prefix = parsed.prefix;
      this.blocks = parsed.blocks.map(b => ({
        src: b.src, sep: b.sep, startLine: b.startLine, endLine: b.endLine, type: typeOf(b.src)
      }));
      if (!this.blocks.length) this.blocks.push({ src: '', sep: '', startLine: 0, endLine: 0, type: 'p' });
      // 只在「文末是表格/图片/分割线/公式块」时垫一个空段落，日常不插空行
      const lastB = this.blocks[this.blocks.length - 1];
      const lastHasImg = /<img\s|!\[[^\]]*\]\(/i.test(lastB.src || '');
      if (STRUCT_TYPES.indexOf(lastB.type) >= 0 || lastHasImg) {
        lastB.sep = lastB.sep || '\n\n';
        this.blocks.push({ src: '', sep: '', startLine: 0, endLine: 0, type: 'p' });
      }
      this.blocks.forEach((b, i) => { if (i < this.blocks.length - 1 && !b.sep) b.sep = '\n\n'; });
      this.focused = -1;
      this.renderAll();
      if (!keepHistory) {
        this.undoStack = [];
        this.redoStack = [];
      }
      this._lastSnap = this.getContent();
    }

    getContent() { return joinBlocks(this.prefix, this.blocks); }

    flush() { this.serializeAll(); }

    refresh() { this.serializeAll(); this.renderAll(); }

    elOf(i) { return this.root.querySelector('.blk[data-i="' + i + '"]'); }

    hostOf(i) {
      const blk = this.elOf(i);
      if (!blk) return null;
      return blk.querySelector('[contenteditable="true"]') || blk.firstElementChild;
    }

    beginEdit(i) {
      this.focused = i;
      const host = this.hostOf(i);
      if (host) host.focus();
    }

    focusLine(line) {
      const idx = this.blocks.findIndex(b => line >= b.startLine && line <= b.endLine);
      if (idx >= 0) {
        const host = this.hostOf(idx);
        if (host) { host.focus(); this.setCaretEnd(host); this.focused = idx; }
      }
    }

    renderAll() {
      this.root.innerHTML = this.blocks.map((b, i) => this.renderBlock(b, i)).join('');
      if (this.opts.fixImages) this.opts.fixImages(this.root);
      this.recalcLines();
    }

    renderBlock(b, i) {
      const t = b.type;
      const head = '<div class="blk" data-i="' + i + '" data-type="' + t + '">';
      const tail = '</div>';

      if (t === 'hr') return head + '<hr>' + tail;

      if (t === 'math') {
        const tex = b.src.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '').trim();
        let inner;
        try {
          inner = (global.katex && global.katex.renderToString)
            ? global.katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: 'ignore' })
            : esc(tex);
        } catch (e) { inner = esc(tex); }
        return head + '<div class="math-block" data-tex="' + esc(tex) + '">' + inner + '</div>' + tail;
      }

      if (t === 'code') {
        const lines = b.src.split('\n');
        const lang = (lines[0].match(/^ {0,3}(?:```|~~~)\s*([\w+#.-]*)/) || [])[1] || '';
        const body = lines.slice(1, lines[lines.length - 1].trim().match(/^(```|~~~)/) ? -1 : undefined).join('\n');
        return head + '<div class="code-block"><div class="code-head"><span class="code-lang">' + esc(lang || 'text') +
          '</span><button class="code-copy" data-copy="1" title="复制代码">复制</button></div>' +
          '<pre class="code-body"><code contenteditable="true" spellcheck="false" data-lang="' + esc(lang) + '">' +
          esc(body) + '</code></pre></div>' + tail;
      }

      if (t === 'img') {
        const m = b.src.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        const img = m
          ? '<img src="' + m[2] + '" alt="' + esc(m[1]) + '">'
          : b.src.trim();
        return head + '<p class="img-line">' + img + '</p>' + tail;
      }

      if (t === 'table') return head + window.MD.render(b.src, { softBreak: false }) + tail;

      if (!b.src.trim()) return head + '<p contenteditable="true" spellcheck="false"><br></p>' + tail;
      let html = window.MD.render(b.src, { softBreak: true });
      html = html.replace(/^(\s*<[a-zA-Z0-9]+)/, '$1 contenteditable="true" spellcheck="false"');
      return head + html + tail;
    }

    serializeAll() {
      let changed = false;
      this.blocks.forEach((b, i) => {
        const blk = this.elOf(i);
        if (!blk) return;
        const host = blk.querySelector('[contenteditable="true"]');
        if (!host) return;
        const src = serializeBlock(this.serializeHost(i, host));
        if (src !== b.src) { b.src = src; b.type = typeOf(src); changed = true; }
      });
      if (changed) this.emit(false);
    }

    emit(structural) {
      this.recalcLines();
      this.opts.onChange(this.getContent(), !!structural);
      this.scheduleSnapshot();
    }

    recalcLines() {
      let line = 0;
      if (this.prefix) line = (this.prefix.match(/\n/g) || []).length;
      for (const b of this.blocks) {
        b.startLine = line;
        line += (b.src.match(/\n/g) || []).length;
        b.endLine = line;
        line += (b.sep.match(/\n/g) || []).length;
      }
    }

    /* --- 事件 --- */
    _bind() {
      const root = this.root;

      root.addEventListener('input', e => {
        const blk = e.target.closest('.blk');
        if (!blk) return;
        const i = +blk.dataset.i;
        this.focused = i;
        const host = blk.querySelector('[contenteditable="true"]');
        if (!host) return;
        if (blk.dataset.type === 'math-src') return;
        if (!this.applyInlineRules(host) && this.applyBlockRules(host)) {
          this.emitCaret();
          return;
        }
        this.updateBlockFromDom(i, host);
        this.emitCaret();
      });

      root.addEventListener('keydown', e => this.onKeyDown(e));

      root.addEventListener('mousedown', e => {
        this._allSelected = false;
        const blk = e.target.closest('.blk');
        const editable = e.target.closest('[contenteditable="true"]');
        const inCell = e.target.closest('td, th');
        const img = e.target.closest('img');

        // 图片：任何块里的图片都能选中缩放
        if (img && blk) { e.preventDefault(); this.selectImage(+blk.dataset.i, img); return; }
        if (this.imageSel) this.clearImageSel(true);

        if (blk) this.focused = +blk.dataset.i;

        // 表格单元格
        if (blk && blk.dataset.type === 'table' && inCell) {
          const i = +blk.dataset.i;
          if (this.tableEdit && this.tableEdit.index !== i) this.commitTable();
          if (!this.tableEdit || this.tableEdit.index !== i) this.beginTableEdit(i, inCell, { keepCaret: true });
          else this.tableEdit.cell = inCell;
          this._dragSel = { active: true, start: i };
          return;
        }

        // 公式块：点一下变 TeX
        if (blk && blk.dataset.type === 'math' && !e.target.closest('.math-src')) {
          e.preventDefault();
          this.editMath(+blk.dataset.i);
          return;
        }

        // 代码块：点到边框/头部也把光标放进代码里
        if (blk && blk.dataset.type === 'code' && !editable) {
          const code = blk.querySelector('code');
          if (code) {
            e.preventDefault();
            code.focus();
            this.placeCaretAtPoint(code, e.clientX, e.clientY);
            return;
          }
        }

        // 正常点到可编辑内容：交给浏览器
        if (editable || inCell) {
          if (this.tableEdit && blk && this.tableEdit.index !== +blk.dataset.i) this.commitTable();
          if (editable && blk) this._dragSel = { active: true, start: +blk.dataset.i };
          return;
        }

        // 其余算点空白
        if (this.tableEdit) this.commitTable();
        this.clickEmptyArea(e);
        e.preventDefault();
      });

      // 拖拽跨块选择：每个块是独立的 contenteditable，浏览器不会自动跨过去
      document.addEventListener('mousemove', e => {
        const d = this._dragSel;
        if (!d || !d.active) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || !el.closest) return;
        const blk = el.closest('.blk');
        if (!blk) return;
        const idx = +blk.dataset.i;
        if (idx === d.start) return;
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        let node = null, off = 0;
        let cr = this.rangeAtPoint(e.clientX, e.clientY, null);
        if (!cr || !this.root.contains(cr.startContainer)) cr = this.rangeAtPoint(e.clientX, e.clientY, blk);
        if (cr) { node = cr.startContainer; off = cr.startOffset; }
        else {
          const host = blk.querySelector('[contenteditable="true"]') || blk;
          const tn = firstTextNode(host);
          if (!tn) return;
          node = tn;
          off = idx > d.start ? 0 : tn.nodeValue.length;
        }
        try { sel.extend(node, off); } catch (err) { }
      });

      document.addEventListener('mouseup', () => {
        if (this._dragSel) this._dragSel.active = false;
      });

      // 跨块选区：Chrome 不会给跨编辑域的选区上色，这里自己画
      document.addEventListener('selectionchange', () => {
        if (this._paintRaf) return;
        this._paintRaf = requestAnimationFrame(() => {
          this._paintRaf = 0;
          this.paintSelection();
        });
      });


      root.addEventListener('click', e => {
        const a = e.target.closest('a');
        if (a) { e.preventDefault(); this.opts.onLink && this.opts.onLink(a.getAttribute('href')); return; }
        const copy = e.target.closest('.code-copy');
        if (copy) { this.opts.onCopy && this.opts.onCopy(copy); return; }
        const cb = e.target.closest('input[type=checkbox]');
        if (cb) {
          const blk = cb.closest('.blk');
          const host = blk && blk.querySelector('ul, ol');
          if (host) this.updateBlockFromDom(+blk.dataset.i, host);
        }
      });

      root.addEventListener('paste', e => {
        const blk = e.target.closest('.blk');
        if (!blk) return;
        const items = e.clipboardData && e.clipboardData.items;
        if (items) {
          for (const it of items) {
            if (it.type && it.type.indexOf('image/') === 0) {
              e.preventDefault();
              const f = it.getAsFile();
              if (f) this.opts.onImage && this.opts.onImage(f);
              return;
            }
          }
        }
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (text) document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'));
      });

      document.addEventListener('selectionchange', () => {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        let n = sel.focusNode;
        if (n && n.nodeType === 3) n = n.parentNode;
        const blk = n && n.closest ? n.closest('.blk') : null;
        if (blk) { this.focused = +blk.dataset.i; this.emitCaret(); }
      });

      root.addEventListener('scroll', () => { this.opts.onScroll && this.opts.onScroll(); }, { passive: true });

      // 滚动或窗口变化后重绘选区（叠加层是按视口坐标算的）
      let scrollHost = root.parentElement;
      while (scrollHost && scrollHost !== document.body) {
        const st = getComputedStyle(scrollHost).overflowY;
        if (st === 'auto' || st === 'scroll') break;
        scrollHost = scrollHost.parentElement;
      }
      this._scrollHost = (scrollHost && scrollHost !== document.body) ? scrollHost : document.scrollingElement;
      if (scrollHost && scrollHost !== document.body) {
        scrollHost.addEventListener('scroll', () => {
          if (!this._paintRaf) return;
          this.paintSelection();
        }, { passive: true });
      }
      window.addEventListener('resize', () => {
        if (window.getSelection().rangeCount) this.paintSelection();
      });

      document.addEventListener('keydown', e => {
        if (!this.imageSel) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); this.removeSelectedImage(); }
        else if (e.key === 'Escape') { this.clearImageSel(true); }
      }, true);
    }

    rangeAtPoint(x, y, scope) {
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        if (r && (!scope || scope.contains(r.startContainer))) return r;
      }
      if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p && p.offsetNode && (!scope || scope.contains(p.offsetNode))) {
          const r2 = document.createRange();
          try { r2.setStart(p.offsetNode, p.offset); r2.collapse(true); return r2; } catch (e) { }
        }
      }
      // 兜底：在目标块里找纵向最近的一行，再按横坐标定位
      if (!scope) return null;
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let best = null, bestScore = Infinity, node;
      while ((node = walker.nextNode())) {
        const rg = document.createRange();
        rg.selectNodeContents(node);
        const rects = rg.getClientRects();
        for (let k = 0; k < rects.length; k++) {
          const rc = rects[k];
          const dy = y < rc.top ? rc.top - y : (y > rc.bottom ? y - rc.bottom : 0);
          if (dy < bestScore) { bestScore = dy; best = { node: node, rect: rc }; }
        }
      }
      if (!best) return null;
      const rg2 = document.createRange();
      rg2.setStart(best.node, 0);
      rg2.collapse(true);
      const chars = best.node.nodeValue.length;
      let lo = 0, hi = chars;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const test = document.createRange();
        test.setStart(best.node, mid);
        test.collapse(true);
        const tr = test.getClientRects()[0];
        if (!tr) break;
        if (tr.left < x) lo = mid + 1; else hi = mid;
      }
      const r3 = document.createRange();
      r3.setStart(best.node, Math.min(lo, chars));
      r3.collapse(true);
      return r3;
    }

    placeCaretAtPoint(el, x, y) {
      let range = null;
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
      const sel = window.getSelection();
      if (range && el.contains(range.startContainer)) {
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      this.setCaretEnd(el);
    }

    clickEmptyArea(e) {
      const nodes = Array.from(this.root.querySelectorAll('.blk'));
      if (!nodes.length) return;
      const y = e.clientY;
      let target = nodes[nodes.length - 1];
      for (const b of nodes) {
        const r = b.getBoundingClientRect();
        if (y < r.bottom) { target = b; break; }
      }
      const i = +target.dataset.i;
      let host = this.hostOf(i);
      if (!host) {
        for (let k = i + 1; k < this.blocks.length; k++) {
          host = this.hostOf(k);
          if (host) { host.focus(); this.setCaretStart(host); this.focused = k; return; }
        }
        for (let k = i - 1; k >= 0; k--) {
          host = this.hostOf(k);
          if (host) { host.focus(); this.setCaretEnd(host); this.focused = k; return; }
        }
        return;
      }
      host.focus();
      this.focused = i;
      const r = target.getBoundingClientRect();
      const rel = (y - r.top) / Math.max(1, r.height);
      if (rel > 0.55) this.setCaretEnd(host); else this.setCaretStart(host);
    }

selLayer() {
      let layer = this.root.querySelector('.sel-layer');
      if (layer) return layer;
      layer = document.createElement('div');
      layer.className = 'sel-layer';
      this.root.appendChild(layer);
      return layer;
    }

    paintSelection() {
      const layer = this.selLayer();
      layer.innerHTML = '';
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) { this._multiSel = null; return; }

      const range = sel.getRangeAt(0);
      const docRect = this.root.getBoundingClientRect();
      const frag = document.createDocumentFragment();
      let drawn = 0;

      // 只给"有字的部分"上色：逐个文本节点取子范围
      const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.nodeValue && n.nodeValue.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      let tn;
      while ((tn = walker.nextNode()) && drawn < 800) {
        let inter = false;
        try { inter = range.intersectsNode(tn); } catch (e) { inter = false; }
        if (!inter) continue;
        let s2 = 0, e2 = tn.nodeValue.length;
        if (tn === range.startContainer) s2 = range.startOffset;
        if (tn === range.endContainer) e2 = range.endOffset;
        if (e2 <= s2) continue;
        const sub = document.createRange();
        sub.setStart(tn, s2);
        sub.setEnd(tn, e2);
        const subRects = sub.getClientRects();
        for (let k = 0; k < subRects.length && drawn < 800; k++) {
          const r = subRects[k];
          if (r.width < 0.5 || r.height < 0.5) continue;
          const d = document.createElement('div');
          d.style.left = (r.left - docRect.left) + 'px';
          d.style.top = (r.top - docRect.top) + 'px';
          d.style.width = r.width + 'px';
          d.style.height = r.height + 'px';
          frag.appendChild(d);
          drawn++;
        }
      }
      layer.appendChild(frag);

      // 是否跨块（供整段删除用）
      const blocks = Array.from(this.root.querySelectorAll('.blk'));
      const hit = [];
      blocks.forEach((b, idx) => {
        let inter = false;
        try { inter = range.intersectsNode(b); } catch (e) { inter = false; }
        if (inter) hit.push(idx);
      });
      this._multiSel = hit.length > 1 ? { from: hit[0], to: hit[hit.length - 1] } : null;
    }

    repaintSelection() {
      if (this._paintRaf) cancelAnimationFrame(this._paintRaf);
      this._paintRaf = requestAnimationFrame(() => { this._paintRaf = 0; this.paintSelection(); });
    }

    clearSelectionPaint() {
      this._multiSel = null;
      const layer = this.root.querySelector('.sel-layer');
      if (layer) layer.innerHTML = '';
    }

    deleteMultiSelection() {
      const m = this._multiSel;
      if (!m) return false;
      const from = Math.max(0, m.from), to = Math.min(this.blocks.length - 1, m.to);
      this.blocks.splice(from, to - from + 1, { src: '', sep: '', startLine: 0, endLine: 0, type: 'p' });
      this.clearSelectionPaint();
      window.getSelection().removeAllRanges();
      this.renderAll();
      this.emit(true);
      const host = this.hostOf(from);
      if (host) { host.focus(); this.setCaretStart(host); }
      return true;
    }

    serializeHost(i, host) {
      const blk = this.elOf(i);
      if (blk && blk.dataset.type === 'code') return blk.querySelector('pre') || host;
      return host;
    }

    updateBlockFromDom(i, host) {
      const b = this.blocks[i];
      if (!b) return;
      const src = serializeBlock(this.serializeHost(i, host));
      if (src === b.src) return;
      b.src = src;
      b.type = typeOf(src);
      this.emit(false);
    }

    /* --- 输入规则 --- */
    applyInlineRules(host) {
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return false;
      const node = sel.focusNode;
      if (!node || node.nodeType !== 3 || !host.contains(node)) return false;
      const before = node.nodeValue.slice(0, sel.focusOffset);
      const rules = [
        [/\*\*([^*\n]+)\*\*$/, 'strong', 1],
        [/(^|[^\w*])\*([^*\n]+)\*$/, 'em', 2],
        [/`([^`\n]+)`$/, 'code', 1],
        [/~~([^~\n]+)~~$/, 'del', 1],
        [/==([^=\n]+)==$/, 'mark', 1]
      ];
      for (const [re, tag, group] of rules) {
        const m = before.match(re);
        if (!m) continue;
        const full = m[0];
        const inner = m[group];
        const prefixLen = (group === 2 && m[1]) ? m[1].length : 0;
        const start = sel.focusOffset - full.length + prefixLen;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, sel.focusOffset);
        range.deleteContents();
        const el = document.createElement(tag);
        el.textContent = inner;
        range.insertNode(el);
        const r2 = document.createRange();
        r2.setStartAfter(el);
        r2.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r2);
        return true;
      }
      return false;
    }

    applyBlockRules(host) {
      if (host.tagName !== 'P') return false;
      const text = host.textContent;
      let next = null;
      let m = text.match(/^(#{1,6})\s$/);
      if (m) next = 'h' + m[1].length;
      if (!next && /^[-*+]\s$/.test(text)) next = 'ul';
      if (!next && /^\d{1,3}[.)]\s$/.test(text)) next = 'ol';
      if (!next && /^>\s$/.test(text)) next = 'quote';
      if (!next) return false;
      const blk = host.closest('.blk');
      host.innerHTML = '';
      this.setBlockType(+blk.dataset.i, next);
      return true;
    }

    /* --- 块类型转换 --- */
    setBlockType(i, type) {
      const blk = this.elOf(i);
      if (!blk) return;
      const host = blk.querySelector('[contenteditable="true"]');
      const text = host ? inlineMd(host).trim() : '';
      const b = this.blocks[i];

      if (type === 'p') b.src = text;
      else if (/^h[1-6]$/.test(type)) b.src = '#'.repeat(+type[1]) + ' ' + text;
      else if (type === 'ul') b.src = (text || '列表项').split('\n').map(l => '- ' + l).join('\n');
      else if (type === 'ol') b.src = (text || '列表项').split('\n').map((l, n) => (n + 1) + '. ' + l).join('\n');
      else if (type === 'task') b.src = (text || '任务').split('\n').map(l => '- [ ] ' + l).join('\n');
      else if (type === 'quote') b.src = (text || '').split('\n').map(l => '> ' + l).join('\n');
      else if (type === 'code') b.src = '```\n' + text + '\n```';
      else if (type === 'math') b.src = '$$\n' + text + '\n$$';
      else if (type === 'hr') b.src = '---';
      else if (type === 'table') b.src = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |';

      b.type = typeOf(b.src);
      const tmp = document.createElement('div');
      tmp.innerHTML = this.renderBlock(b, i);
      blk.parentNode.replaceChild(tmp.firstElementChild, blk);
      this.ensureTrailingParagraph(i);
      this.emit(true);
      if (type !== 'hr' && type !== 'table' && type !== 'math') {
        const h = this.hostOf(i);
        if (h) { h.focus(); this.setCaretEnd(h); }
      }
    }

    /* --- 快捷键 --- */
    onKeyDown(e) {
      const blk = e.target.closest && e.target.closest('.blk');
      if (!blk) return;
      const i = +blk.dataset.i;
      const host = blk.querySelector('[contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+A：全选整篇（表格里由上面的分支处理成整表）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !this.tableEdit) {
        e.preventDefault();
        const s0 = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(this.root);
        s0.removeAllRanges();
        s0.addRange(range);
        return;
      }


      if (this.tableEdit) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          const all = document.createRange();
          all.selectNodeContents(this.tableEdit.table);
          const sel0 = window.getSelection();
          sel0.removeAllRanges();
          sel0.addRange(all);
          return;
        }
        if (e.key === 'Tab') { e.preventDefault(); this.moveCell(e.shiftKey ? -1 : 1); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            document.execCommand('insertLineBreak');   // 单元格里换行
          } else {
            this.addRow('below');                      // 加一行
            this.syncTable();
          }
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); this.commitTable(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          this.tableArrow(e);
        }
        return;
      }

if ((e.key === 'Delete' || e.key === 'Backspace') && this._multiSel) {
        e.preventDefault();
        this.deleteMultiSelection();
        return;
      }
      if (this.imageSel && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        const sel0 = this.imageSel;
        this.clearImageSel(false);
        const img0 = sel0.img;
        const host0 = this.hostOf(sel0.index);
        if (img0 && img0.parentNode) img0.parentNode.removeChild(img0);
        if (host0) this.updateBlockFromDom(sel0.index, host0);
        return;
      }
      if (this.imageSel && e.key === 'Escape') { this.clearImageSel(true); return; }

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this.redo(); return; }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const down = e.key === 'ArrowDown';
        const atEdge = down ? isCaretAtEnd(host) : caretAtStart(host);
        if (atEdge) {
          const nextIdx = i + (down ? 1 : -1);
          const nb = this.blocks[nextIdx];
          if (nb && nb.type === 'table') {
            e.preventDefault();
            this.enterTableAt(nextIdx, down ? 'first' : 'last');
            return;
          }
          const target = this.siblingTextBlock(i, down ? 1 : -1);
          if (target >= 0) {
            e.preventDefault();
            const tHost = this.hostOf(target);
            if (tHost) {
              tHost.focus();
              if (down) this.setCaretStart(tHost); else this.setCaretEnd(tHost);
              this.focused = target;
            }
          }
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        if (blk.dataset.type === 'code') return;
        const list = host && host.closest('ul, ol');
        if (list) {
          const li = e.target.closest('li');
          if (li && !li.textContent.trim() && listItemCount(list) > 1) {
            e.preventDefault();
            this.exitList(i, li, list);
            return;
          }
          return;
        }
        whenTypeReady(() => {
          e.preventDefault();
          this.splitAtCaret(i, host);
        });
        return;
      }

      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); return; }

      if (e.key === 'Backspace' && caretAtStart(host)) {
        e.preventDefault();
        this.backspaceAtStart(i, host);
      }
    }

    enterTableAt(i, which) {
      const blk = this.elOf(i);
      const table = blk && blk.querySelector('table');
      if (!table) return;
      const rows = table.querySelectorAll('tr');
      if (!rows.length) return;
      const body = rows.length > 1 ? Array.prototype.slice.call(rows, 1) : [rows[0]];
      const row = which === 'last' ? body[body.length - 1] : body[0];
      const cell = row.children[0] || row.children[row.children.length - 1];
      if (cell) this.beginTableEdit(i, cell);
    }

    siblingTextBlock(i, dir) {
      let j = i + dir;
      while (j >= 0 && j < this.blocks.length) {
        if (STRUCT_TYPES.indexOf(this.blocks[j].type) < 0) return j;
        j += dir;
      }
      return -1;
    }

    splitAtCaret(i, host) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const after = range.cloneRange();
      after.selectNodeContents(host);
      after.setStart(range.endContainer, range.endOffset);
      const frag = after.extractContents();

      const tmp = document.createElement('div');
      tmp.appendChild(frag);
      const tailSrc = inlineMd(tmp).trim();

      const b = this.blocks[i];
      const headSrc = serializeBlock(host);
      const origType = typeOf(headSrc);
      const headEmpty = !inlineMd(host).replace(/[\s\u00a0]/g, '');
      b.src = headEmpty ? '' : headSrc;
      b.type = b.src ? typeOf(b.src) : 'p';

      // 后半段继承原来的格式（标题/引用/列表），空的后半段才变普通段落
      let nbSrc = tailSrc;
      let nbType = 'p';
      if (tailSrc && /^(h[1-6]|quote|list)$/.test(origType)) {
        nbType = origType;
        nbSrc = applyType(origType, tailSrc);
      }

      const nb = { src: nbSrc, sep: b.sep || '\n\n', startLine: 0, endLine: 0, type: nbType };
      b.sep = '\n\n';
      this.blocks.splice(i + 1, 0, nb);
      this.renderAll();
      this.emit(true);
      const nextHost = this.hostOf(i + 1);
      if (nextHost) { nextHost.focus(); this.setCaretStart(nextHost); }
    }

    exitList(i, li, list) {
      const b = this.blocks[i];
      li.remove();
      const listSrc = serializeBlock(list);
      b.src = listSrc.trim() ? listSrc : '';
      b.type = b.src ? typeOf(b.src) : 'p';
      const nb = { src: '', sep: b.sep || '\n\n', startLine: 0, endLine: 0, type: 'p' };
      b.sep = '\n\n';
      this.blocks.splice(i + 1, 0, nb);
      this.renderAll();
      this.emit(true);
      const h = this.hostOf(i + 1);
      if (h) h.focus();
    }

    afterMediaInsert() {
      // 图片插在文末时，补一个空段落，否则图片下面没法继续写
      const blk = this.currentBlk();
      if (!blk) return;
      const i = +blk.dataset.i;
      if (i !== this.blocks.length - 1) return;
      this.blocks[i].sep = this.blocks[i].sep || '\n\n';
      this.blocks.push({ src: '', sep: '', startLine: 0, endLine: 0, type: 'p' });
      this.renderAll();
      this.emit(true);
      const host = this.hostOf(i);
      if (host) { host.focus(); this.setCaretEnd(host); }
    }

    ensureTrailingParagraph(i, force) {
      if (i !== this.blocks.length - 1) return;
      const t = this.blocks[i].type;
      if (!force && STRUCT_TYPES.indexOf(t) < 0) return;
      if (force && t !== 'img') return;
      this.blocks[i].sep = '\n\n';
      this.blocks.push({ src: '', sep: '', startLine: 0, endLine: 0, type: 'p' });
      this.renderAll();
    }

    backspaceAtStart(i, host) {
      // 当前块本身就是表格/代码块等：别合并，空的话直接删掉
      const self = this.blocks[i];
      if (self && STRUCT_TYPES.indexOf(self.type) >= 0) {
        if (self.type === 'code') {
          const body = self.src.replace(/^\s*(```|~~~)[\w+#.-]*\s*/, '').replace(/(```|~~~)\s*$/, '');
          if (!body.trim()) {
            this.blocks.splice(i, 1);
            this.renderAll();
            this.emit(true);
            const h = this.hostOf(Math.max(0, i - 1));
            if (h) { h.focus(); this.setCaretEnd(h); }
          } else {
            this.setBlockType(i, 'p');       // 去掉代码块外壳，变成普通段落
          }
          return;
        }
        if (!(self.src || '').trim()) {
          this.blocks.splice(i, 1);
          this.renderAll();
          this.emit(true);
          const h = this.hostOf(Math.max(0, i - 1));
          if (h) { h.focus(); this.setCaretEnd(h); }
        }
        return;
      }

      const prev = this.blocks[i - 1];
      const cur = this.blocks[i];
      if (!prev) return;

      // 上面是表格 / 图片 / 分割线 / 公式 / 代码块：先把那个块删掉
      if (STRUCT_TYPES.indexOf(prev.type) >= 0) {
        this.blocks.splice(i - 1, 1);
        this.renderAll();
        this.emit(true);
        const ph = this.hostOf(i - 1);
        if (ph) { ph.focus(); this.setCaretStart(ph); }
        return;
      }

      // 上面是空行：只删空行，当前块的格式一点都不动
      if (!(prev.src || '').trim()) {
        this.blocks.splice(i - 1, 1);
        this.renderAll();
        this.emit(true);
        const ph = this.hostOf(i - 1);
        if (ph) { ph.focus(); this.setCaretStart(ph); }
        return;
      }

      // 段落 + 段落 → 合并
      if (prev.type === 'p' && cur && cur.type === 'p') { this.mergeBack(i); return; }

      // 退无可退（上一块已经是段落）：先取消当前块的格式，再按一次才合并
      if (cur && cur.type !== 'p') { this.setBlockType(i, 'p'); return; }

      // 列表项：把这一项从列表里摘出来变成普通段落（这样序号自然消失）
      const list = host.closest ? host.closest('ul, ol') : null;
      const sel = window.getSelection();
      let node = sel.rangeCount ? sel.focusNode : null;
      if (node && node.nodeType === 3) node = node.parentNode;
      const li = node && node.closest ? node.closest('li') : null;
      if (list && li && list.contains(li)) { this.liftListItem(i, li, list); return; }

      this.mergeBack(i);
    }

    liftListItem(i, li, list) {
      const lis = Array.prototype.filter.call(list.children, c => c.tagName === 'LI');
      const idx = lis.indexOf(li);
      if (idx < 0) return;
      const text = inlineMd(li).trim();
      const before = lis.slice(0, idx);
      const after = lis.slice(idx + 1);
      const cloneList = items => {
        const c = list.cloneNode(false);
        items.forEach(x => c.appendChild(x.cloneNode(true)));
        return c;
      };
      const b = this.blocks[i];
      const parts = [];
      if (before.length) parts.push({ src: serializeBlock(cloneList(before)), sep: '\n\n' });
      const paraAt = parts.length;
      parts.push({ src: text, sep: '\n\n' });
      if (after.length) parts.push({ src: serializeBlock(cloneList(after)), sep: b.sep || '\n\n' });

      const fresh = parts.map(p => ({ src: p.src, sep: p.sep, startLine: 0, endLine: 0, type: typeOf(p.src) }));
      this.blocks.splice(i, 1, ...fresh);
      this.renderAll();
      this.emit(true);
      const target = this.hostOf(i + paraAt);
      if (target) { target.focus(); this.setCaretStart(target); }
    }

    mergeBack(i) {
      if (i <= 0) return;
      const prev = this.blocks[i - 1];
      const cur = this.blocks[i];
      let curRaw = (cur.src || '').trim();
      if (/^h[1-6]$/.test(cur.type)) curRaw = curRaw.replace(/^#{1,6}\s+/, '');
      else if (cur.type === 'quote') curRaw = curRaw.replace(/^>\s?/gm, '');
      const curText = curRaw.trim();

      // 前面是表格/图片/分割线/公式/代码块：Backspace 直接删掉那个块（合并进去没有意义）
      if (STRUCT_TYPES.indexOf(prev.type) >= 0) {
        this.blocks.splice(i - 1, 1);
        this.renderAll();
        this.emit(true);
        const host = this.hostOf(i - 1);
        if (host) { host.focus(); this.setCaretStart(host); }
        return;
      }
      const joinAt = (prev.src || '').length;
      prev.src = (prev.src || '') + (curText || '');
      prev.type = typeOf(prev.src);
      this.blocks.splice(i, 1);
      this.renderAll();
      this.emit(true);
      const host = this.hostOf(i - 1);
      if (host) { host.focus(); this.setCaretByOffset(host, joinAt); }
    }

    /* --- 命令 --- */
    cmd(name) {
      const blk = this.currentBlk() || (this.focused >= 0 ? this.elOf(this.focused) : null);
      if (!blk) return;
      const i = +blk.dataset.i;
      const type = blk.dataset.type;

      if (name === 'bold') { document.execCommand('bold'); this.syncCurrent(); return; }
      if (name === 'italic') { document.execCommand('italic'); this.syncCurrent(); return; }
      if (name === 'strike') { document.execCommand('strikeThrough'); this.syncCurrent(); return; }
      if (name === 'clear') { document.execCommand('removeFormat'); this.syncCurrent(); return; }
      if (name === 'code') return this.wrapTag('code');
      if (name === 'mark') return this.wrapTag('mark');
      if (name === 'link') {
        const url = window.prompt('链接地址', 'https://');
        if (url) { document.execCommand('createLink', false, url); this.syncCurrent(); }
        return;
      }
      if (name === 'image') { this.opts.pickImage && this.opts.pickImage(); return; }

      if (/^h[1-6]$/.test(name)) return this.setBlockType(i, name);
      if (name === 'p') return this.setBlockType(i, 'p');
      if (name === 'headingUp') return this.setBlockType(i, type[0] === 'h' ? 'h' + Math.max(1, +type[1] - 1) : 'h6');
      if (name === 'headingDown') return this.setBlockType(i, type[0] === 'h' ? 'h' + Math.min(6, +type[1] + 1) : 'h1');
      if (name === 'ul' || name === 'ol' || name === 'task' || name === 'quote') return this.setBlockType(i, name);
      if (name === 'codeblock') return this.setBlockType(i, 'code');
      if (name === 'math') return this.setBlockType(i, 'math');
      if (name === 'hr') return this.setBlockType(i, 'hr');
      if (name === 'table') return this.setBlockType(i, 'table');
      if (name === 'indent' || name === 'outdent') return this.indentList(name === 'indent');
    }

    indentList(indent) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      let n = sel.focusNode;
      if (n && n.nodeType === 3) n = n.parentNode;
      const li = n && n.closest ? n.closest('li') : null;
      if (!li) return;
      const list = li.parentNode;
      if (indent) {
        const prevLi = li.previousElementSibling;
        if (!prevLi) return;
        let sub = prevLi.querySelector(':scope > ul, :scope > ol');
        if (!sub) { sub = document.createElement(list.tagName); prevLi.appendChild(sub); }
        sub.appendChild(li);
      } else {
        const prevLi = li.previousElementSibling;
        if (!prevLi) {
          const outer = list.parentNode.closest('li');
          if (outer) {
            const parentList = list.parentNode;
            parentList.parentNode.insertBefore(li, parentList.nextSibling);
          }
          return;
        }
        let sub = prevLi.querySelector(':scope > ul, :scope > ol');
        if (!sub) { sub = document.createElement(list.tagName); prevLi.appendChild(sub); }
        sub.appendChild(li);
      }
      this.syncCurrent();
    }

    wrapTag(tag) {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const el = document.createElement(tag);
      try { el.appendChild(range.extractContents()); } catch (e) { return; }
      range.insertNode(el);
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
      this.syncCurrent();
    }

    currentBlk() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      let n = sel.focusNode;
      if (n && n.nodeType === 3) n = n.parentNode;
      return n && n.closest ? n.closest('.blk') : null;
    }

    syncCurrent() {
      const blk = this.currentBlk();
      if (!blk) return;
      const i = +blk.dataset.i;
      const host = blk.querySelector('[contenteditable="true"]');
      if (host) this.updateBlockFromDom(i, host);
    }

    /* --- 光标 --- */
    setCaretEnd(host) {
      const r = document.createRange();
      r.selectNodeContents(host);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    setCaretStart(host) {
      const r = document.createRange();
      r.setStart(host, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    setCaretByOffset(host, offset) {
      let rest = offset;
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      let node, done = false;
      while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (rest <= len) { r.setStart(node, rest); r.collapse(true); done = true; break; }
        rest -= len;
      }
      if (!done) { r.selectNodeContents(host); r.collapse(false); }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    emitCaret() {
      if (!this.opts.onCaret) return;
      const blk = this.currentBlk();
      if (!blk) return;
      const i = +blk.dataset.i;
      const b = this.blocks[i];
      if (!b) return;
      const sel = window.getSelection();
      let offset = 0;
      if (sel.rangeCount) {
        try {
          const r = document.createRange();
          r.setStart(blk, 0);
          r.setEnd(sel.focusNode, sel.focusOffset || 0);
          offset = r.toString().length;
        } catch (e) { offset = 0; }
      }
      this.opts.onCaret((b.startLine || 0) + 1, offset + 1);
    }

    /* --- 数学块 --- */
    editMath(i) {
      const blk = this.elOf(i);
      const box = blk && blk.querySelector('.math-block');
      if (!box) return;
      const tex = box.getAttribute('data-tex') || '';
      blk.dataset.type = 'math-src';
      blk.innerHTML = '<pre class="math-src" contenteditable="true" spellcheck="false">' + esc(tex) + '</pre>';
      const pre = blk.querySelector('.math-src');
      pre.focus();
      this.setCaretEnd(pre);
      pre.addEventListener('blur', () => {
        this.blocks[i].src = '$$\n' + pre.textContent.trim() + '\n$$';
        this.blocks[i].type = 'math';
        const tmp = document.createElement('div');
        tmp.innerHTML = this.renderBlock(this.blocks[i], i);
        blk.parentNode.replaceChild(tmp.firstElementChild, blk);
        this.emit(true);
      }, { once: true });
    }

    /* --- 图片 --- */
    selectImage(index, img) {
      this.clearImageSel(false);
      const blk = this.elOf(index);
      if (!blk) return;
      this.imageSel = { index: index, img: img, startWidth: 0, changed: false };
      const box = document.createElement('div');
      box.className = 'img-box';
      box.innerHTML = '<div class="img-handle" title="拖动改变宽度"></div>';
      blk.appendChild(box);
      this._positionImageBox();
      const self = this;
      box.querySelector('.img-handle').addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        self.imageSel.startWidth = img.getBoundingClientRect().width;
        self.imageSel.dragging = true;
        self.imageSel.startX = ev.clientX;
        document.body.style.cursor = 'nwse-resize';
      });
      if (!this._imgBound) {
        this._imgBound = true;
        document.addEventListener('mousemove', ev => {
          const s = self.imageSel;
          if (!s || !s.dragging) return;
          const w = Math.max(60, Math.round(s.startWidth + (ev.clientX - s.startX)));
          s.img.style.width = w + 'px';
          s.img.style.maxWidth = 'none';
          s.changed = true;
          self._positionImageBox();
        });
        document.addEventListener('mouseup', () => {
          const s = self.imageSel;
          if (!s || !s.dragging) return;
          s.dragging = false;
          document.body.style.cursor = '';
          if (s.changed) self.commitImage();
        });
      }
    }

    _positionImageBox() {
      const s = this.imageSel;
      if (!s) return;
      const blk = this.elOf(s.index);
      const box = blk && blk.querySelector('.img-box');
      if (!box) return;
      const r = s.img.getBoundingClientRect();
      const br = blk.getBoundingClientRect();
      box.style.left = (r.left - br.left) + 'px';
      box.style.top = (r.top - br.top) + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
    }

    removeSelectedImage() {
      const s = this.imageSel;
      if (!s) return;
      const img = s.img;
      const index = s.index;
      this.clearImageSel(false);
      if (img && img.parentNode) img.parentNode.removeChild(img);
      const host = this.hostOf(index);
      if (host) this.updateBlockFromDom(index, host);
    }

    clearImageSel(commit) {
      const s = this.imageSel;
      this.imageSel = null;
      if (!s) return;
      const blk = this.elOf(s.index);
      if (blk) { const box = blk.querySelector('.img-box'); if (box) box.remove(); }
      if (s.img) s.img.style.maxWidth = '';
      if (commit && s.changed) this.commitImage(s);
    }

    commitImage(sel) {
      const s = sel || this.imageSel;
      if (!s) return;
      const width = Math.round(parseFloat(s.img.style.width || 0));
      if (!width) return;
      s.img.setAttribute('width', width);
      const host = this.hostOf(s.index);
      const b = this.blocks[s.index];
      if (host) {
        b.src = serializeBlock(host);
        b.type = typeOf(b.src);
      }
      this.emit(false);
    }

    /* --- 表格 --- */
    beginTableEdit(i, cell, opts) {
      const blk = this.elOf(i);
      const table = blk && blk.querySelector('table');
      if (!table) return;
      const target = cell || table.querySelector('td, th');
      this.tableEdit = { index: i, el: blk, table: table, cell: target };
      table.querySelectorAll('td, th').forEach(c => { c.contentEditable = 'true'; c.classList.add('cell-editing'); });
      if (!table.dataset.bound) {
        table.dataset.bound = '1';
        table.addEventListener('focusin', ev => {
          const c = ev.target.closest && ev.target.closest('td, th');
          if (c && this.tableEdit) this.tableEdit.cell = c;
        });
      }
      if (target) {
        target.focus();
        if (!opts || !opts.keepCaret) this.setCaretEnd(target);
      }
      this.showTableBar();
    }

    tableBar() {
      let bar = document.getElementById('tableBar');
      if (bar) return bar;
      bar = document.createElement('div');
      bar.id = 'tableBar';
      bar.className = 'table-bar';
      bar.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      bar.addEventListener('click', ev => {
        const b = ev.target.closest('button');
        if (!b) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.tableAction(b.dataset.act);
      });
      document.body.appendChild(bar);
      window.addEventListener('scroll', () => { if (this.tableEdit) this.positionTableBar(); }, true);
      window.addEventListener('resize', () => { if (this.tableEdit) this.positionTableBar(); });
      return bar;
    }

    showTableBar() {
      const bar = this.tableBar();
      bar.innerHTML = TABLE_BAR_HTML;
      bar.style.display = 'flex';
      this.positionTableBar();
    }

    hideTableBar() {
      const bar = document.getElementById('tableBar');
      if (bar) bar.style.display = 'none';
    }

    positionTableBar() {
      const te = this.tableEdit;
      const bar = document.getElementById('tableBar');
      if (!te || !bar || bar.style.display === 'none') return;
      const r = te.table.getBoundingClientRect();
      const w = bar.offsetWidth || 300;
      const h = bar.offsetHeight || 34;
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(10, Math.min(left, innerWidth - w - 10));
      let top = r.top - h - 8;
      if (top < 64) top = Math.min(innerHeight - h - 10, r.bottom + 8);
      bar.style.left = Math.round(left) + 'px';
      bar.style.top = Math.round(top) + 'px';
    }

    tableAction(act) {
      if (!this.tableEdit) return;
      if (act === 'align-left') return this.setColAlign('left');
      if (act === 'align-center') return this.setColAlign('center');
      if (act === 'align-right') return this.setColAlign('right');
      if (act === 'row-above') return this.addRow('above');
      if (act === 'row-below') return this.addRow('below');
      if (act === 'col-left') return this.addCol('left');
      if (act === 'col-right') return this.addCol('right');
      if (act === 'del-row') return this.delRow();
      if (act === 'del-col') return this.delCol();
      if (act === 'del-table') return this.deleteTable();
    }

    setColAlign(align) {
      const pos = this.cellPos();
      if (!pos) return;
      Array.from(this.tableEdit.table.querySelectorAll('tr')).forEach(tr => {
        const c = tr.children[pos.col];
        if (c) c.style.textAlign = align;
      });
      this.syncTable();
      const row = this.tableEdit.table.querySelectorAll('tr')[pos.rowIdx];
      if (row && row.children[pos.col]) {
        const c = row.children[pos.col];
        c.focus();
        this.tableEdit.cell = c;
      }
      this.positionTableBar();
    }

    currentCell() {
      const te = this.tableEdit;
      if (!te) return null;
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('td, th') && te.table.contains(ae)) return ae.closest('td, th');
      return te.cell && te.table.contains(te.cell) ? te.cell : null;
    }

    cellPos() {
      const cell = this.currentCell();
      if (!cell) return null;
      const tr = cell.closest('tr');
      const table = this.tableEdit.table;
      const rows = Array.from(table.querySelectorAll('tr'));
      return {
        cell: cell,
        row: tr,
        rowIdx: rows.indexOf(tr),
        col: Array.from(tr.children).indexOf(cell),
        inHead: tr.parentNode.tagName === 'THEAD'
      };
    }

    commitTable() {
      const te = this.tableEdit;
      if (!te) return;
      this.tableEdit = null;
      te.table.querySelectorAll('td, th').forEach(c => { c.contentEditable = 'false'; c.classList.remove('cell-editing'); });
      this.blocks[te.index].src = serializeBlockTable(te.table);
      this.blocks[te.index].type = 'table';
      this.hideTableBar();
      this.emit(true);
    }

    tableArrow(e) {
      const te = this.tableEdit;
      if (!te) return;
      const cell = document.activeElement;
      if (!cell || !cell.closest || !cell.closest('td, th')) return;
      const table = te.table;
      const rows = Array.from(table.querySelectorAll('tr'));
      const row = cell.closest('tr');
      const rowIdx = rows.indexOf(row);
      const cells = Array.from(table.querySelectorAll('td, th'));
      const cellIdx = cells.indexOf(cell);
      const col = Array.from(row.children).indexOf(cell);

      const goCell = (target, atEnd) => {
        if (!target) return;
        target.focus();
        if (atEnd) this.setCaretEnd(target); else this.setCaretStart(target);
      };

      const exit = dirDown => {
        e.preventDefault();
        const idx = te.index;
        this.commitTable();
        this.moveOutFromBlock(idx, dirDown ? 1 : -1);
      };

      if (e.key === 'ArrowUp') {
        if (rowIdx <= 0) return exit(false);
        e.preventDefault();
        goCell(rows[rowIdx - 1].children[col], true);
        return;
      }
      if (e.key === 'ArrowDown') {
        if (rowIdx >= rows.length - 1) return exit(true);
        e.preventDefault();
        goCell(rows[rowIdx + 1].children[col], true);
        return;
      }
      if (e.key === 'ArrowLeft' && caretAtStart(cell)) {
        if (cellIdx <= 0) return exit(false);
        e.preventDefault();
        goCell(cells[cellIdx - 1], true);
        return;
      }
      if (e.key === 'ArrowRight' && isCaretAtEnd(cell)) {
        if (cellIdx >= cells.length - 1) return exit(true);
        e.preventDefault();
        goCell(cells[cellIdx + 1], false);
      }
    }

    moveOutFromBlock(index, dir) {
      let target = this.siblingTextBlock(index, dir);
      if (target < 0) {
        if (dir > 0) {
          this.blocks[index].sep = this.blocks[index].sep || '\n\n';
          this.blocks.splice(index + 1, 0, { src: '', sep: '', startLine: 0, endLine: 0, type: 'p' });
          this.renderAll();
          this.emit(true);
          target = index + 1;
        } else return;
      }
      const h = this.hostOf(target);
      if (h) {
        h.focus();
        if (dir > 0) this.setCaretStart(h); else this.setCaretEnd(h);
        this.focused = target;
      }
    }

    moveCell(dir) {
      const te = this.tableEdit;
      if (!te) return;
      const cells = Array.from(te.table.querySelectorAll('td, th'));
      const cur = this.currentCell();
      const next = cells[cells.indexOf(cur) + dir];
      if (next) { next.focus(); this.setCaretEnd(next); if (this.tableEdit) this.tableEdit.cell = next; return; }
      if (dir > 0) this.addRow('below');
    }

    newCell(tag) {
      const c = document.createElement(tag || 'td');
      c.contentEditable = 'true';
      c.classList.add('cell-editing');
      return c;
    }

    addRow(where) {
      const te = this.tableEdit;
      const pos = this.cellPos();
      if (!te || !pos) return;
      const table = te.table;
      const body = table.tBodies[0] || table;
      const cols = table.querySelectorAll('tr')[0].children.length;
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) tr.appendChild(this.newCell('td'));

      if (where === 'above') {
        if (pos.inHead || pos.rowIdx === 0) body.insertBefore(tr, body.firstElementChild);
        else pos.row.parentNode.insertBefore(tr, pos.row);
      } else {
        if (pos.inHead) body.insertBefore(tr, body.firstElementChild);
        else pos.row.parentNode.insertBefore(tr, pos.row.nextSibling);
      }
      const first = tr.firstElementChild;
      if (first) { first.focus(); this.setCaretEnd(first); this.tableEdit.cell = first; }
      this.syncTable();
    }

    addCol(side) {
      const te = this.tableEdit;
      const pos = this.cellPos();
      if (!te || !pos) return;
      const at = side === 'left' ? pos.col : pos.col + 1;
      Array.from(te.table.querySelectorAll('tr')).forEach(tr => {
        const tag = tr.parentNode.tagName === 'THEAD' ? 'th' : 'td';
        const cell = this.newCell(tag);
        tr.insertBefore(cell, tr.children[at] || null);
      });
      const curRow = te.table.querySelectorAll('tr')[pos.rowIdx];
      if (curRow && curRow.children[at]) { curRow.children[at].focus(); this.tableEdit.cell = curRow.children[at]; }
      this.syncTable();
    }

    delRow() {
      const te = this.tableEdit;
      const pos = this.cellPos();
      if (!te || !pos || pos.inHead) return;
      const rows = te.table.querySelectorAll('tr');
      if (rows.length <= 2) return;                 // 至少留表头 + 一行
      const body = pos.row.parentNode;
      const at = Array.from(body.children).indexOf(pos.row);
      pos.row.remove();
      const nextRow = body.children[Math.min(at, body.children.length - 1)];
      if (nextRow) {
        const c = nextRow.children[Math.min(pos.col, nextRow.children.length - 1)];
        if (c) { c.focus(); this.setCaretEnd(c); this.tableEdit.cell = c; }
      }
      this.syncTable();
    }

    delCol() {
      const te = this.tableEdit;
      const pos = this.cellPos();
      if (!te || !pos) return;
      if (te.table.querySelectorAll('tr')[0].children.length <= 1) return;
      Array.from(te.table.querySelectorAll('tr')).forEach(tr => {
        if (tr.children[pos.col]) tr.children[pos.col].remove();
      });
      const row = te.table.querySelectorAll('tr')[pos.rowIdx] || te.table.querySelectorAll('tr')[1];
      if (row) {
        const c = row.children[Math.min(pos.col, row.children.length - 1)];
        if (c) { c.focus(); this.setCaretEnd(c); this.tableEdit.cell = c; }
      }
      this.syncTable();
    }

    moveRow(dir) {
      const te = this.tableEdit;
      const pos = this.cellPos();
      if (!te || !pos || pos.inHead) return;
      const body = pos.row.parentNode;
      const sib = dir < 0 ? pos.row.previousElementSibling : pos.row.nextElementSibling;
      if (!sib) return;
      if (dir < 0) body.insertBefore(pos.row, sib);
      else body.insertBefore(sib, pos.row);
      const idx = Array.from(body.children).indexOf(pos.row);
      this.tableEdit.cell = pos.row.children[pos.col] || null;
      if (this.tableEdit.cell) { this.tableEdit.cell.focus(); this.setCaretEnd(this.tableEdit.cell); }
      this.syncTable();
      void idx;
    }

    moveCol(dir) {
      const te = this.tableEdit;
      const pos = this.cellPos();
      if (!te || !pos) return;
      const to = dir < 0 ? pos.col - 1 : pos.col + 1;
      if (to < 0) return;
      Array.from(te.table.querySelectorAll('tr')).forEach(tr => {
        const cell = tr.children[pos.col];
        const ref = tr.children[to];
        if (!cell || !ref) return;
        if (dir < 0) tr.insertBefore(cell, ref);
        else tr.insertBefore(ref, cell);
      });
      const row = te.table.querySelectorAll('tr')[pos.rowIdx];
      this.tableEdit.cell = row ? row.children[to] : null;
      if (this.tableEdit.cell) { this.tableEdit.cell.focus(); this.setCaretEnd(this.tableEdit.cell); }
      this.syncTable();
    }

    deleteTable() {
      const te = this.tableEdit;
      if (!te) return;
      const i = te.index;
      this.tableEdit = null;
      this.hideTableBar();
      this.blocks.splice(i, 1);
      this.renderAll();
      this.emit(true);
      const host = this.hostOf(Math.min(i, this.blocks.length - 1));
      if (host) host.focus();
    }

    syncTable() {
      const te = this.tableEdit;
      if (!te) return;
      this.blocks[te.index].src = serializeBlockTable(te.table);
      this.emit(false);
    }

    /* --- 撤销 --- */
    snapshotNow() {
      clearTimeout(this._snapTimer);
      const content = this.getContent();
      if (content === this._lastSnap) return;
      // 记下「这次改动发生的位置」，撤销后光标回到这儿
      this.undoStack.push({ content: this._lastSnap, caret: this.caretSnapshot() });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this._lastSnap = content;
      this.redoStack = [];
    }

    scheduleSnapshot() {
      clearTimeout(this._snapTimer);
      this._snapTimer = setTimeout(() => this.snapshotNow(), 700);
    }

    caretSnapshot() {
      const blk = this.currentBlk() || (this.focused >= 0 ? this.elOf(this.focused) : null);
      if (!blk) return { i: Math.max(0, this.focused), off: 0 };
      const i = +blk.dataset.i;
      const host = blk.querySelector('[contenteditable="true"]');
      let off = 0;
      const sel = window.getSelection();
      if (host && sel.rangeCount) {
        try {
          const r = document.createRange();
          r.setStart(host, 0);
          r.setEnd(sel.focusNode, sel.focusOffset || 0);
          off = r.toString().length;
        } catch (e) { off = 0; }
      }
      return { i: i, off: off };
    }

    restoreCaret(snap) {
      let i = snap ? snap.i : this.focused;
      if (!(i >= 0)) i = 0;
      i = Math.max(0, Math.min(i, this.blocks.length - 1));
      let host = this.hostOf(i);
      if (!host) {                             // 块类型变了（比如表格）→ 找最近能编辑的
        for (let k = 0; k < this.blocks.length; k++) {
          host = this.hostOf(k);
          if (host) { i = k; break; }
        }
      }
      if (!host) return;
      host.focus();
      this.setCaretByOffset(host, snap ? (snap.off || 0) : 0);
      this.focused = i;
    }

    firstChangedBlock(before) {
      const after = this.blocks.map(b => b.src);
      const n = Math.max(before.length, after.length);
      for (let i = 0; i < n; i++) if (before[i] !== after[i]) return i;
      return -1;
    }

    focusBlockEnd(i) {
      if (!(i >= 0)) i = Math.max(0, this.focused);
      i = Math.max(0, Math.min(i, this.blocks.length - 1));
      let host = this.hostOf(i);
      if (!host) {
        for (let k = i; k < this.blocks.length; k++) { host = this.hostOf(k); if (host) { i = k; break; } }
      }
      if (!host) return;
      host.focus();
      this.setCaretEnd(host);
      this.focused = i;
    }

    undo() {
      this.snapshotNow();                 // 把还没进栈的改动先记下来，撤销立刻可用
      if (!this.undoStack.length) return;
      clearTimeout(this._snapTimer);
      const entry = this.undoStack.pop();
      const before = this.blocks.map(b => b.src);
      this.redoStack.push({ content: this.getContent(), caret: this.caretSnapshot() });
      const prev = entry.content;
      this.load(prev, true);
      this._lastSnap = prev;
      this.opts.onChange(prev, true);
      // 光标落到「被恢复的那段文字」之后，而不是撤销前的位置
      this.focusBlockEnd(this.firstChangedBlock(before));
    }

    redo() {
      if (!this.redoStack.length) return;
      clearTimeout(this._snapTimer);
      const entry = this.redoStack.pop();
      const before = this.blocks.map(b => b.src);
      this.undoStack.push({ content: this.getContent(), caret: this.caretSnapshot() });
      const next = entry.content;
      this.load(next, true);
      this._lastSnap = next;
      this.opts.onChange(next, true);
      this.focusBlockEnd(this.firstChangedBlock(before));
    }

    insertText(text) {
      document.execCommand('insertText', false, text);
      this.syncCurrent();
    }
  }

  /* ---------- 工具 ---------- */
  function applyType(type, text) {
    if (/^h[1-6]$/.test(type)) return '#'.repeat(+type[1]) + ' ' + text;
    if (type === 'quote') return text.split('\n').map(function (l) { return '> ' + l; }).join('\n');
    if (type === 'list') return text.split('\n').map(function (l) { return '- ' + l; }).join('\n');
    return text;
  }

  function firstTextNode(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    return w.nextNode();
  }

  function listItemCount(list) {
    return list.querySelectorAll(':scope > li').length;
  }

  function whenTypeReady(fn) { fn(); }

  function isCaretAtEnd(host) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    try {
      const r = document.createRange();
      r.setStart(sel.focusNode, sel.focusOffset || 0);
      r.setEnd(host, host.childNodes.length);
      return r.toString().replace(/[\s\u00a0]/g, '').length === 0;
    } catch (e) { return false; }
  }

  function caretAtStart(host) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    const node = sel.focusNode;
    if (!node || !host.contains(node === host ? host.firstChild || host : node)) return false;
    try {
      const r = document.createRange();
      r.setStart(host, 0);
      r.setEnd(node, sel.focusOffset || 0);
      return r.toString().replace(/[\s\u00a0]/g, '').length === 0;
    } catch (e) { return false; }
  }

  global.Wysiwyg = Wysiwyg;
  global.MD.splitBlocks = splitBlocks;
  global.MD.joinBlocks = joinBlocks;
  global.MD.serializeInline = inlineMd;
})(window);