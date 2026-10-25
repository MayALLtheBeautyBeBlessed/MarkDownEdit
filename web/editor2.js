/* ============================================================
   MarkEdit · 单一编辑域内核（editor2）
   整篇文档只有一个 contenteditable，块就是里面的普通元素。
   好处：原生跨段选区、原生方向键、原生 Ctrl+A、原生撤销。
   源码由 DOM 反向序列化得到。
   ============================================================ */
(function (global) {
  'use strict';

  const NBSP = /\u00a0/g;
  let SRC_FIX = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function escapeText(t) {
    return String(t).replace(/([\\`*_\[\]])/g, '\\$1').replace(NBSP, ' ');
  }

  /* ---------- DOM → Markdown ---------- */
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
      if (tag === 'a') { out += '[' + inlineMd(n) + '](' + (n.getAttribute('href') || '') + ')'; continue; }
      if (tag === 'sup' && n.classList && n.classList.contains('fn-ref')) { out += '[^' + (n.getAttribute('data-fn') || n.textContent) + ']'; continue; }
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
      if (tag === 'input') continue;
      if (tag === 'div' || tag === 'p') { out += '\n' + inlineMd(n); continue; }
      out += inlineMd(n);
    }
    return out;
  }

  function serializeList(list, depth) {
    const ordered = list.tagName === 'OL';
    const pad = '  '.repeat(depth);
    const out = [];
    Array.prototype.filter.call(list.children, c => c.tagName === 'LI').forEach((li, idx) => {
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

  function serializeTable(table) {
    const rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const cellText = td => {
      let t = inlineMd(td).replace(/\s*\n+\s*/g, '<br>').replace(/\|/g, '\\|').trim();
      return t.replace(/^(<br>)+|(<br>)+$/g, '').trim();
    };
    const header = Array.prototype.map.call(rows[0].children, cellText);
    const aligns = Array.prototype.map.call(rows[0].children, td => {
      const a = (td.style.textAlign || 'left').toLowerCase();
      return a === 'center' ? ':---:' : a === 'right' ? '---:' : ':---';
    });
    const lines = ['| ' + header.join(' | ') + ' |', '| ' + aligns.join(' | ') + ' |'];
    rows.slice(1).forEach(tr => {
      lines.push('| ' + Array.prototype.map.call(tr.children, cellText).join(' | ') + ' |');
    });

    // 列宽写进分隔行：短横线数量按百分比
    const widths = getColWidths(table);
    if (widths && widths.length === header.length) {
      const sum = widths.reduce((a, b) => a + b, 0) || 1;
      const sep = widths.map((w, i) => {
        const d = '-'.repeat(Math.max(3, Math.round((w / sum) * 36)));
        const a = (rows[0].children[i].style.textAlign || 'left').toLowerCase();
        return a === 'center' ? ':' + d + ':' : a === 'right' ? d + ':' : d;
      });
      lines[1] = '| ' + sep.join(' | ') + ' |';
    }
    return lines.join('\n');
  }

  /* 读取表格列宽（百分比）；没有则返回 null */
  function getColWidths(table) {
    const cols = table.querySelectorAll('colgroup col');
    if (cols.length) {
      const ws = Array.prototype.map.call(cols, c => parseFloat(c.style.width) || 0);
      if (ws.some(w => w > 0)) return ws;
    }
    const first = table.querySelector('thead th') ? table.querySelectorAll('thead th') : table.querySelectorAll('tr')[0].children;
    const ws = Array.prototype.map.call(first, th => parseFloat(th.style.width) || 0);
    if (!ws.some(w => w > 0)) return null;
    // 未设宽度的列平分剩余空间
    const sumKnown = ws.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    const zeros = ws.filter(w => !(w > 0)).length;
    const rest = Math.max(6, 100 - sumKnown) / (zeros || 1);
    const filled = ws.map(w => (w > 0 ? w : rest));
    const sum = filled.reduce((a, b) => a + b, 0) || 1;
    return filled.map(w => (w / sum) * 100);
  }

  function serializeEl(el) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return '#'.repeat(+tag[1]) + ' ' + inlineMd(el).trim();
    if (tag === 'p') {
      if (el.classList && el.classList.contains('fn-def')) {
        return '[^' + (el.getAttribute('data-fn') || '1') + ']: ' + inlineMd(el).trim();
      }
      return inlineMd(el).trim();
    }
    if (tag === 'blockquote') return inlineMd(el).replace(/^\n+|\n+$/g, '').split('\n').map(l => '> ' + l).join('\n');
    if (tag === 'pre') {
      if (el.classList.contains('front-matter')) return '---\n' + el.textContent.replace(/^\n+|\n+$/g, '') + '\n---';
      const lang = el.getAttribute('data-lang') || '';
      return '```' + lang + '\n' + el.textContent.replace(/\n$/, '') + '\n```';
    }
    if (tag === 'ul' || tag === 'ol') return serializeList(el, 0);
    if (tag === 'table') return serializeTable(el);
    if (tag === 'hr') return '---';
    if (tag === 'div' && el.classList.contains('toc-block')) return '[TOC]';
    if (tag === 'div' && el.classList.contains('math-block')) {       return '$$\n' + (el.getAttribute('data-tex') || '') + '\n$$';     }
      if (tag === 'img') {
      const src = (el.getAttribute('data-src') || el.getAttribute('src') || '').replace(/^file:\/\/\//, '');
      const s2 = SRC_FIX ? SRC_FIX(src) : src;
      const w = el.getAttribute('width');
      return w ? '<img src="' + s2 + '" width="' + w + '">' : '![' + (el.getAttribute('alt') || '') + '](' + s2 + ')';
    }
    return inlineMd(el).trim();
  }

  /* ---------- 块级元素 ---------- */
  const BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,hr,div.math-block,div.toc-block';
  /* 行内裸链接：http(s):// 或 www. 开头，主体只吃 ASCII */
  const URL_RE = new RegExp('(^|[\\s\\u3000(（「【>|]|[\\u3000-\\u9fff])((?:https?:\\/\\/|www\\.)[A-Za-z0-9\\-._~:\\/?#\\[\\]@!$&*+,;=%]+)$');
  const URL_CH = /[A-Za-z0-9\-._~:\/?#\[\]@!$&*+,;=%]/;
  const STRUCT = ['table', 'hr', 'code', 'math', 'img'];

  function blockOf(node) {
    let n = node;
    if (n && n.nodeType === 3) n = n.parentNode;
    while (n && n !== document.body) {
      if (n.nodeType === 1 && n.matches && n.matches(BLOCK_SEL)) return n;
      n = n.parentNode;
    }
    return null;
  }

  function typeOfEl(el) {
    if (!el) return 'p';
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'h' + tag[1];
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'blockquote') return 'quote';
    if (tag === 'pre') return 'code';
    if (tag === 'table') return 'table';
    if (tag === 'hr') return 'hr';
    if (tag === 'div' && el.classList.contains('math-block')) return 'math';
    return 'p';
  }

  function firstText(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    return w.nextNode();
  }

  /* ---------- 渲染：Markdown → 可编辑 DOM ---------- */
  function toEditHTML(md) {
    const tmp = document.createElement('div');
    tmp.innerHTML = global.MD.render(md, { softBreak: true });

    // 代码块：去掉带按钮的外壳，换成朴素的 <pre>
    Array.from(tmp.querySelectorAll('.code-block')).forEach(cb => {
      const langEl = cb.querySelector('.code-lang');
      const lang = langEl ? langEl.textContent.trim() : '';
      const codeEl = cb.querySelector('code');
      const code = codeEl ? codeEl.textContent : '';
      const pre = document.createElement('pre');
      pre.setAttribute('data-lang', lang === 'text' ? '' : lang);
      const code2 = document.createElement('code');
      code2.textContent = code;
      pre.appendChild(code2);
      cb.replaceWith(pre);
    });

    // 表格：去掉 .table-wrap 外壳（否则不是顶层块，序列化会漏）
    Array.from(tmp.querySelectorAll('.table-wrap')).forEach(w => {
      const t = w.querySelector('table');
      if (t) w.replaceWith(t);
    });

    // 公式块：不可直接编辑，点一下换成 TeX
    Array.from(tmp.querySelectorAll('.math-block')).forEach(m => {
      m.setAttribute('contenteditable', 'false');
      if (!m.getAttribute('data-tex')) {
        m.setAttribute('data-tex', (m.textContent || '').trim());
      }
    });

    Array.from(tmp.querySelectorAll('.toc-block')).forEach(t => t.setAttribute('contenteditable', 'false'));

    // 空文档给一个空段落
    if (!tmp.querySelector(BLOCK_SEL)) tmp.appendChild(document.createElement('p'));
    return tmp.innerHTML;
  }

  /* ---------- 编辑器 ---------- */
  class Wysiwyg {
    constructor(opts) {
      this.root = opts.root;
      this.opts = opts;
      SRC_FIX = typeof opts.toRel === 'function' ? opts.toRel : null;
      this.tableEdit = null;
      this.imageSel = null;
      this._emitTimer = 0;
      this._undoStack = [];
      this._redoStack = [];
      this._snapHtml = '';
      this._lastPushAt = 0;
      this._caretBefore = null;
      this._applying = false;
      this._htmlCache = new WeakMap();
      this._dirtyBlocks = new Set();
      this._diffTimer = 0;
      this._snapCaret = null;
      this._lastEmit = '';
      this.root.setAttribute('contenteditable', 'true');
      this.root.setAttribute('spellcheck', 'false');
      this.root.classList.add('edit-host');
      this._bind();
    }

    /* --- 公开接口 --- */
    load(text) {
      this.root.innerHTML = toEditHTML(text || '');
      this.invalidate();
      if (this.opts.fixImages) this.opts.fixImages(this.root);
      this._lastEmit = this.getContent();
      this._undoStack = [];
      this._redoStack = [];
      this.ensureTrailing();
      this._prevNodes = this.nodes();
      this._prevCaret = null;
      this.tableEdit = null;
      this.imageSel = null;
    }

    getContent() {
      const parts = [];
      Array.prototype.forEach.call(this.root.children, el => {
        if (!el.matches || !el.matches(BLOCK_SEL)) return;
        const md = serializeEl(el);
        if (md && md.trim()) parts.push(md);
      });
      return parts.join('\n\n') + (parts.length ? '\n' : '');
    }

    flush() { this.emitNow(); }

    refresh() {
      const md = this.getContent();
      this.load(md);
      this.opts.onChange(this.getContent(), true);
    }

    get blocks() {
      if (this._blocksCache) return this._blocksCache;
      const list = [];
      let line = 0;
      Array.prototype.forEach.call(this.root.children, el => {
        if (!el.matches || !el.matches(BLOCK_SEL)) return;
        const src = serializeEl(el);
        const n = (src.match(/\n/g) || []).length;
        list.push({ el: el, src: src, type: typeOfEl(el), startLine: line, endLine: line + n });
        line += n + 2;
      });
      this._blocksCache = list;
      return list;
    }

    invalidate() { this._blocksCache = null; }

    beginEdit(i) {
      const list = this.blocks;
      const b = list[i] || list[0];
      if (!b) return;
      const target = firstText(b.el) ? b.el : b.el;
      b.el.focus();
      this.setCaretStart(b.el);
      void target;
    }

    focusLine(line) {
      const list = this.blocks;
      if (!list.length) return;
      // 取 startLine 不超过目标行的最后一个块（比区间匹配稳）
      let b = list[0];
      for (let i = 0; i < list.length; i++) {
        if (list[i].startLine <= line) b = list[i]; else break;
      }
      b.el.focus();
      this.setCaretStart(b.el);
      try { b.el.scrollIntoView({ block: 'center' }); } catch (e) { }
    }

    syncCurrent() { this.emitNow(); }

    insertText(text) {
      document.execCommand('insertText', false, text);
      this.emitNow();
    }

    afterMediaInsert() {
      const b = this.currentBlock();
      if (!b) return;
      if (b !== this.root.lastElementChild) return;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      b.after(p);
      p.focus();
      this.setCaretStart(p);
      this.emitNow();
    }

    /* --- 事件 --- */
    _bind() {
      const root = this.root;

      root.addEventListener('keydown', e => {
        if ((e.key && e.key.length === 1) || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') {
          this._prevCaret = this.caretPos();
        }
      }, true);

      try {
        this._mo = new MutationObserver(recs => {
          for (let i = 0; i < recs.length; i++) {
            const t = recs[i].target;
            const node = t && (t.nodeType === 1 ? t : t.parentNode);
            this.markDirty(node);
          }
          if (!this._applying) this.queueDiff();
        });
        this._mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
      } catch (e) { }

      root.addEventListener('input', e => {
        this._composing = !!e.isComposing;
        this.invalidate();
        this.markDirty(this.currentBlock());
        this.updateTableContext();
        if (this.applyBlockRule()) { this.scheduleEmit(); return; }
        this.applyInlineRules(e);
        this.ensureTrailing();
        if (!e.isComposing) this.scheduleLinkify();
        this.scheduleEmit();
      });

      // 离开编辑器时就地整理裸链接（打字时不动，避免把链接切断）
      root.addEventListener('focusout', () => {
        setTimeout(() => {
          if (this._composing) return;
          const b = this._lastBlock;
          if (b && b.isConnected && this.linkifyBlock(b, true)) {
            this.invalidate();
            this.emitNow();
          }
        }, 0);
      });

      root.addEventListener('keydown', e => this.onKeyDown(e));

      // 点目录条目 → 跳到对应标题
      root.addEventListener('click', e => {
        const item = e.target.closest && e.target.closest('.toc-item');
        if (!item) return;
        const line = parseInt(item.getAttribute('data-line'), 10);
        if (isNaN(line) || line < 0) return;
        e.preventDefault();
        this.focusLine(line);
      });

      // 点脚注角标 → 跳到定义
      root.addEventListener('click', e => {
        const ref = e.target.closest && e.target.closest('.fn-ref');
        if (!ref) return;
        const label = ref.getAttribute('data-fn');
        const def = this.root.querySelector('.fn-def[data-fn="' + label + '"]');
        if (!def) return;
        e.preventDefault();
        def.scrollIntoView({ block: 'center' });
        def.classList.remove('fn-flash');
        void def.offsetWidth;
        def.classList.add('fn-flash');
        setTimeout(() => def.classList.remove('fn-flash'), 1200);
      });

      /* 表格列宽拖拽：在单元格右边缘 6px 内按下 */
      root.addEventListener('mousedown', e => {
        const me0 = this._mathEditing;
        if (me0 && me0.div.isConnected && Date.now() - (this._mathOpenedAt || 0) > 250 && !me0.div.contains(e.target)) me0.commit();
        const cell = e.target.closest && e.target.closest('th, td');
        if (!cell || !this.tableEdit) return;
        const table = cell.closest('table');
        if (!table) return;
        const box = cell.getBoundingClientRect();
        if (box.right - e.clientX > 6) return;
        const idx = Array.prototype.indexOf.call(cell.parentNode.children, cell);
        const total = table.getBoundingClientRect().width || 1;
        const startW = box.width;
        const startX = e.clientX;
        e.preventDefault();
        e.stopPropagation();
        const cells = Array.prototype.slice.call(table.querySelectorAll('tr'))
          .map(tr => tr.children[idx]).filter(Boolean);
        let moved = false;
        const move = ev => {
          moved = true;
          const w = Math.max(36, startW + (ev.clientX - startX));
          cells.forEach(c => { c.style.width = ((w / total) * 100).toFixed(2) + '%'; });
        };
        const up = () => {
          document.removeEventListener('mousemove', move, true);
          document.removeEventListener('mouseup', up, true);
          if (moved) { this.invalidate(); this.emitNow(); }
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
      }, true);

      root.addEventListener('mousedown', e => {
        const img = e.target.closest && e.target.closest('img');
        if (img) { e.preventDefault(); this.selectImage(img); return; }
        if (this.imageSel) this.clearImageSel(true);
        const math = e.target.closest && e.target.closest('.math-block');
        if (math && !math.classList.contains('editing')) {
          e.preventDefault();
          this.editMath(math);
          return;
        }
      });

      
      root.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a');
        if (a) {
          e.preventDefault();
          let href = a.getAttribute('href') || '';
          if (/^www\./i.test(href)) href = 'https://' + href;
          this.opts.onLink && this.opts.onLink(href);
        }
      });

      root.addEventListener('paste', e => {
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

      document.addEventListener('mousedown', e => {
        if (e.target.closest && e.target.closest('#tableBar')) return;
        if (e.target.closest && (e.target.closest('#codeLangChip') || e.target.closest('#langPicker'))) return;
        if (!this.root.contains(e.target)) { this.tableEdit = null; this.showTableBar(false); this.hideCodeChip(); }
      }, true);

      document.addEventListener('selectionchange', () => {
        const b = this.currentBlock();
        if (b) this._lastBlock = b;
        if (!this.root.contains(window.getSelection().anchorNode)) { this.tableEdit = null; this.opts.onTableBar && this.opts.onTableBar(null); this.hideCodeChip(); return; }
        const me = this._mathEditing;
        if (me && me.div.isConnected && Date.now() - (this._mathOpenedAt || 0) > 400 && !me.div.contains(document.activeElement) && !me.div.contains(window.getSelection().anchorNode)) me.commit();
        this.updateTableContext();
        this.updateCodeChip();
        this.emitCaret();
      });

      root.addEventListener('scroll', () => {
        this.opts.onScroll && this.opts.onScroll();
        this.positionCodeChip();
      }, { passive: true });
    }

    /* --- 代码块边界处理 --- */
    hasBefore(el) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return false;
      const r = sel.getRangeAt(0);
      if (!r.collapsed) return false;
      const before = document.createRange();
      before.selectNodeContents(el);
      try { before.setEnd(r.startContainer, r.startOffset); } catch (e) { return false; }
      return before.toString().length === 0;
    }

    hasAfter(el) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return false;
      const r = sel.getRangeAt(0);
      if (!r.collapsed) return false;
      const after = document.createRange();
      after.selectNodeContents(el);
      try { after.setStart(r.endContainer, r.endOffset); } catch (e) { return false; }
      return after.toString().length === 0;
    }

    /* dir = -1 向上退（Backspace）/ +1 向下并（Delete） */
    exitCodeBlock(pre, dir) {
      const text = pre.textContent;
      const prev = pre.previousElementSibling;
      const next = pre.nextElementSibling;
      if (dir < 0) {
        if (prev && prev.tagName === 'P') {
          // 并进上一段
          const parts = text.split('\n');
          parts.forEach((line, i) => {
            if (i) prev.appendChild(document.createElement('br'));
            prev.appendChild(document.createTextNode(line));
          });
          pre.remove();
          pre = prev;
        } else {
          // 退出为普通段落
          const p = document.createElement('p');
          const parts = text.split('\n');
          parts.forEach((line, i) => {
            if (i) p.appendChild(document.createElement('br'));
            p.appendChild(document.createTextNode(line));
          });
          if (!p.firstChild) p.innerHTML = '<br>';
          pre.replaceWith(p);
          pre = p;
        }
      } else {
        if (next && next.tagName === 'P') {
          const add = next.textContent;
          const code = pre.querySelector('code') || pre;
          if (add) {
            code.appendChild(document.createTextNode('\n' + add));
          }
          next.remove();
        } else {
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          pre.after(p);
        }
      }
      pre.focus();
      this.setCaretEnd(pre);
      this.invalidate();
      this.ensureTrailing();
      this.emitNow();
    }

    /* --- 输出 --- */
    scheduleSnapUnused() {
      clearTimeout(this._snapTimer);
      this._snapTimer = setTimeout(() => this.snapshot(), 600);
    }

    scheduleEmit() {
      clearTimeout(this._emitTimer);
      // 大文档序列化昂贵：块越多，合并得越久，避免打字期间反复全量序列化
      const blocks = this.root.children.length;
      const delay = blocks > 6000 ? 700 : blocks > 2000 ? 320 : 120;
      this._emitTimer = setTimeout(() => this.emitNow(), delay);
    }

    emitNow() {
      clearTimeout(this._emitTimer);
      const md = this.getContent();
      if (md === this._lastEmit) return;
      this._lastEmit = md;
      this.opts.onChange(md, false);
    }

    emitCaret() {
      if (!this.opts.onCaret) return;
      const b = this.currentBlock();
      if (!b) return;
      const list = this.blocks;
      const idx = list.findIndex(x => x.el === b);
      const line = idx >= 0 ? list[idx].startLine + 1 : 1;
      this.opts.onCaret(line, 1);
    }

    currentBlock() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      return blockOf(sel.focusNode);
    }

    setCaretStart(el) {
      const t = firstText(el);
      const r = document.createRange();
      if (t) r.setStart(t, 0); else r.setStart(el, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    setCaretEnd(el) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    /* --- 快捷键 --- */
    onKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey;

      // 撤销/重做必须先处理：删表后选区可能是失效的，不能因为取不到块就放过
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }

      const blk = this.currentBlock();
      if (!blk) return;

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this.redo(); return; }

      // 代码块边界：Backspace 在开头 = 退出代码块；Delete 在末尾 = 合并下一块
      if ((e.key === 'Backspace' || e.key === 'Delete') && blk.tagName === 'PRE') {
        const atStart = this.hasBefore(blk);
        const atEnd = this.hasAfter(blk);
        if (e.key === 'Backspace' && atStart) { e.preventDefault(); this.exitCodeBlock(blk, -1); return; }
        if (e.key === 'Delete' && atEnd) { e.preventDefault(); this.exitCodeBlock(blk, 1); return; }
      }

      // 回车前先把当前段的裸链接定下来（否则换了段就轮不到它）
      if (e.key === 'Enter' && !e.shiftKey && !this.tableEdit && blk.tagName !== 'PRE') {
        if (this.linkifyBlock(blk, true)) this.invalidate();
      }

      // 表格里：Tab 跳格、Enter 加行、Shift+Enter 换行
      if (this.tableEdit) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const cells = Array.from(this.tableEdit.table.querySelectorAll('td, th'));
          const cur = this.cell();
          const next = cells[cells.indexOf(cur) + (e.shiftKey ? -1 : 1)];
          if (next) { next.focus(); this.setCaretEnd(next); }
          else if (!e.shiftKey) this.addRow('below');
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) document.execCommand('insertLineBreak');
          else this.addRow('below');
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const down = e.key === 'ArrowDown';
          const cell = this.cell();
          if (!cell) return;
          // 单元格内还有行 → 交给浏览器做行间移动
          if (!this.cellAtEdge(cell, down)) return;
          const rows = Array.from(this.tableEdit.table.querySelectorAll('tr'));
          const rowIdx = rows.indexOf(cell.closest('tr'));
          e.preventDefault();
          if (down && rowIdx === rows.length - 1) { this.leaveTable(1); return; }
          if (!down && rowIdx === 0) { this.leaveTable(-1); return; }
          // 表格中间：走到同一列的上一行 / 下一行
          this.moveCellVert(down ? 1 : -1);
          return;
        }
      }

      // 标题里回车 → 新行变普通段落
      if (e.key === 'Enter' && !e.shiftKey && /^H[1-6]$/.test(blk.tagName)) {
        setTimeout(() => {
          const b = this.currentBlock();
          if (b && /^H[1-6]$/.test(b.tagName) && !b.textContent.trim()) {
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            b.replaceWith(p);
            p.focus();
            this.setCaretStart(p);
            this.emitNow();
          }
        }, 0);
        return;
      }
    }

    /* --- 命令 --- */
    /* 菜单/对话框操作后选区会丢，这里兜底找回可编辑位置 */
    ensureCaret() {
      let b = this.currentBlock();
      if (b) { this._lastBlock = b; return b; }
      b = this._lastBlock;
      if (!b || !this.root.contains(b)) b = this.root.lastElementChild;
      if (!b) {
        b = document.createElement('p');
        b.innerHTML = '<br>';
        this.root.appendChild(b);
      }
      this._lastBlock = b;
      try { b.focus(); } catch (e) { }
      this.setCaretEnd(b);
      return b;
    }

    cmd(name, opts) {
      const blk = this.ensureCaret();
      if (!blk) return;
      const structural = /^(h[1-6]|headingUp|headingDown|quote|ul|ol|task|codeblock|math|hr|table|toc|frontmatter|paraAbove|paraBelow)$/.test(name);
      if (structural) this.snapshot();
      const editorCmds = {
        bold: () => document.execCommand('bold'),
        italic: () => document.execCommand('italic'),
        strike: () => document.execCommand('strikeThrough'),
        clear: () => document.execCommand('removeFormat'),
        link: () => {
          const url = window.prompt('链接地址', 'https://');
          if (url) document.execCommand('createLink', false, url);
        },
        image: () => this.opts.pickImage && this.opts.pickImage()
      };
      if (editorCmds[name]) { editorCmds[name](); this.emitNow(); return; }
      if (name === 'code') return this.wrapTag('code');
      if (name === 'mark') return this.wrapTag('mark');

      const map = {
        h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', h5: 'H5', h6: 'H6', p: 'P'
      };
      if (map[name]) return this.setBlockTag(blk, map[name]);
      if (name === 'headingUp' || name === 'headingDown') {
        const cur = /^H([1-6])$/.test(blk.tagName) ? +blk.tagName[1] : 0;
        const next = name === 'headingUp' ? Math.max(1, (cur || 7) - 1) : Math.min(6, (cur || 0) + 1);
        return this.setBlockTag(blk, 'H' + next);
      }
      if (name === 'quote') return this.wrapBlock(blk, 'blockquote');
      if (name === 'ul') return this.toList(blk, 'UL');
      if (name === 'ol') return this.toList(blk, 'OL');
      if (name === 'task') return this.toTask(blk);
      if (name === 'codeblock') return this.toCode(blk);
      if (name === 'math') return this.toMath(blk);
      if (name === 'hr') return this.toHr(blk);
      if (name === 'table') return this.toTable(blk, opts);
      if (name === 'toc') return this.toTOC(blk);
      if (name === 'frontmatter') return this.toFrontMatter(blk);
      if (name === 'footnote') return this.insertPlain(blk, '[^1]');
      if (name === 'linkref') return this.insertPlain(blk, '[文字][1]');
      if (name === 'paraAbove') return this.insertParagraph(blk, -1);
      if (name === 'paraBelow') return this.insertParagraph(blk, 1);
      if (name === 'indent') { document.execCommand('indent'); this.emitNow(); return; }
      if (name === 'outdent') { document.execCommand('outdent'); this.emitNow(); return; }
    }

    setBlockTag(blk, tag) {
      if (blk.tagName === tag) return;
      if (tag === 'P' && !blk.textContent.trim() && STRUCT.indexOf(typeOfEl(blk)) >= 0) return;
      const el = document.createElement(tag);
      el.innerHTML = blk.innerHTML;
      blk.replaceWith(el);
      el.focus();
      this.setCaretEnd(el);
      this.emitNow();
    }

    wrapBlock(blk, tag) {
      const el = document.createElement(tag);
      el.innerHTML = blk.innerHTML;
      blk.replaceWith(el);
      el.focus();
      this.setCaretEnd(el);
      this.emitNow();
    }

    toList(blk, tag) {
      const list = document.createElement(tag);
      const li = document.createElement('li');
      li.innerHTML = blk.innerHTML || '<br>';
      list.appendChild(li);
      blk.replaceWith(list);
      li.focus();
      this.setCaretEnd(li);
      this.emitNow();
    }

    toTask(blk) {
      const list = document.createElement('ul');
      list.className = 'task-list';
      const li = document.createElement('li');
      li.className = 'task';
      li.innerHTML = '<input type="checkbox"><span class="li-text">' + (blk.innerHTML || '') + '</span>';
      list.appendChild(li);
      blk.replaceWith(list);
      const sp = li.querySelector('.li-text');
      if (sp) { sp.focus(); this.setCaretEnd(sp); }
      this.emitNow();
    }

    toCode(blk) {
      const pre = document.createElement('pre');
      pre.className = 'code-body';
      pre.setAttribute('data-lang', '');
      const code = document.createElement('code');
      const text = (blk.textContent || '').trim();
      if (text) code.textContent = blk.textContent; else code.innerHTML = '<br>';
      pre.appendChild(code);
      this.placeBlock(blk, pre, false);
      code.focus();
      this.setCaretStart(code);
      this.emitNow();
    }

    toMath(blk) {
      const tex = blk.textContent.trim();
      const div = document.createElement('div');
      div.className = 'math-block';
      div.setAttribute('data-tex', tex);
      div.setAttribute('contenteditable', 'false');
      try {
        div.innerHTML = global.katex && global.katex.renderToString
          ? global.katex.renderToString(tex || 'x', { displayMode: true, throwOnError: false, strict: 'ignore' })
          : esc(tex);
      } catch (err) { div.textContent = tex; }
      this.placeBlock(blk, div, false);
      this.emitNow();
    }

    toHr(blk) {
      const hr = document.createElement("hr");
      const res = this.placeBlock(blk, hr, false);
      const target = res.tail || hr.nextElementSibling;
      if (target) {
        try { target.focus(); } catch (e) { }
        this.setCaretStart(target);
      }
      this.emitNow();
    }

    toTable(blk, opts) {
      const cols = Math.max(1, Math.min(12, (opts && opts.cols) || 3));
      const rows = Math.max(1, Math.min(50, (opts && opts.rows) || 3));
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) tr.appendChild(document.createElement('th'));
      thead.appendChild(tr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (let r = 0; r < rows - 1; r++) {
        const tr2 = document.createElement('tr');
        for (let c = 0; c < cols; c++) tr2.appendChild(document.createElement('td'));
        tbody.appendChild(tr2);
      }
      table.appendChild(tbody);
      blk.replaceWith(table);
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      table.after(p);
      const first = table.querySelector('th');
      if (first) { first.focus(); this.setCaretStart(first); }
      this.emitNow();
    }

    insertPlain(blk, text) {
      blk.focus();
      const sel = window.getSelection();
      if (!sel.rangeCount) this.setCaretEnd(blk);
      document.execCommand('insertText', false, text);
      this.emitNow();
    }

    toTOC(blk) {
      const div = document.createElement('div');
      div.className = 'toc-block';
      div.setAttribute('contenteditable', 'false');
      div.innerHTML = '<div class="toc-empty">（还没有标题）</div>';
      const res = this.placeBlock(blk, div, false);
      const target = res.tail || div.nextElementSibling;
      if (target) {
        try { target.focus(); } catch (e) { }
        this.setCaretStart(target);
      }
      this.emitNow();
    }

    toFrontMatter(blk) {
      const pre = document.createElement('pre');
      pre.className = 'front-matter';
      pre.setAttribute('contenteditable', 'true');
      pre.textContent = 'title: \ndate: ';
      const first = this.root.firstElementChild;
      if (first) first.before(pre); else this.root.appendChild(pre);
      pre.focus();
      this.setCaretEnd(pre);
      this.emitNow();
      void blk;
    }

    /* 在当前块「之后」插入结构性块；当前块为空则直接替换它 */
    placeBlock(blk, el, trailing) {
      const empty = !blk.textContent.trim();
      if (empty) {
        blk.replaceWith(el);
      } else {
        blk.after(el);
      }
      let tail = null;
      if (trailing) {
        tail = document.createElement('p');
        tail.innerHTML = '<br>';
        el.after(tail);
      }
      // 不管哪种情况，末尾都要留一个可编辑的空段落
      if (!el.nextElementSibling) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        el.after(p);
        if (!tail) tail = p;
      }
      return { tail: tail };
    }

    /* 末尾若是不可编辑块（表格/代码/公式/分割线/目录），补一个空段落 */
    ensureTrailing() {
      const last = this.root.lastElementChild;
      if (!last) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        this.root.appendChild(p);
        return;
      }
      const atomic = /^(TABLE|PRE|HR)$/.test(last.tagName) ||
        (last.classList && (last.classList.contains('math-block') || last.classList.contains('toc-block')));
      if (!atomic) return;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      this.root.appendChild(p);
    }

    insertParagraph(blk, dir) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      if (dir < 0) blk.before(p); else blk.after(p);
      p.focus();
      this.setCaretStart(p);
      this.invalidate();
      this.emitNow();
    }

    /* --- 块级输入规则：# / - / 1. / > / ``` --- */
    applyBlockRule() {
      const blk = this.currentBlock();
      if (!blk || blk.tagName !== 'P') return false;
      const text = blk.textContent;
      let tag = null, rest = '';
      let m = text.match(/^(#{1,6})\s$/);
      if (m) { tag = 'H' + m[1].length; rest = ''; }
      if (!tag && /^[-*+]\s$/.test(text)) { tag = 'UL'; rest = ''; }
      if (!tag && /^\d{1,3}[.)]\s$/.test(text)) { tag = 'OL'; rest = ''; }
      if (!tag && /^>\s$/.test(text)) { tag = 'BLOCKQUOTE'; rest = ''; }
      if (!tag) return false;
      if (tag === 'UL' || tag === 'OL') {
        const list = document.createElement(tag);
        const li = document.createElement('li');
        li.innerHTML = '<br>' + rest;
        list.appendChild(li);
        blk.replaceWith(list);
        li.focus();
        this.setCaretEnd(li);
      } else {
        const el = document.createElement(tag);
        el.textContent = rest;
        blk.replaceWith(el);
        el.focus();
        this.setCaretEnd(el);
      }
      return true;
    }

    /* --- 表格浮动工具条 --- */
    showTableBar(show) {
      let bar = document.getElementById('tableBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'tableBar';
        bar.className = 'table-bar';
        bar.innerHTML = [
          '<button data-act="align-left" title="整列左对齐"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h13"/></svg></button>',
          '<button data-act="align-center" title="整列居中"><svg viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M5.5 17h13"/></svg></button>',
          '<button data-act="align-right" title="整列右对齐"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 12h10M7 17h13"/></svg></button>',
          '<span class="tb-sep"></span>',
          '<button data-act="row-above" title="上方插入行"><svg viewBox="0 0 24 24"><path d="M4 10h16M4 14v6h16v-6"/><path d="M12 7V2M9.5 4.5L12 2l2.5 2.5"/></svg></button>',
          '<button data-act="row-below" title="下方插入行"><svg viewBox="0 0 24 24"><path d="M4 10h16M4 4v6h16V4"/><path d="M12 17v5M9.5 19.5L12 22l2.5-2.5"/></svg></button>',
          '<button data-act="col-left" title="左侧插入列"><svg viewBox="0 0 24 24"><path d="M10 4v16M14 4h6v16h-6"/><path d="M7 12H2M4.5 9.5L2 12l2.5 2.5"/></svg></button>',
          '<button data-act="col-right" title="右侧插入列"><svg viewBox="0 0 24 24"><path d="M10 4v16M4 4h6v16H4"/><path d="M17 12h5M19.5 9.5L22 12l-2.5 2.5"/></svg></button>',
          '<span class="tb-sep"></span>',
          '<button data-act="del-row" title="删除本行"><svg viewBox="0 0 24 24"><path d="M4 4h16M4 9h16M4 14h16"/><path d="M9.5 19.5l5-5M14.5 19.5l-5-5"/></svg></button>',
          '<button data-act="del-col" title="删除本列"><svg viewBox="0 0 24 24"><path d="M4 4v16M9 4v16M14 4v16"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg></button>',
          '<button data-act="del-table" class="danger" title="删除整个表格"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg></button>'
        ].join('');
        bar.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
        bar.addEventListener('click', ev => {
          const b = ev.target.closest('button');
          if (!b) return;
          const act = b.dataset.act;
          if (act === 'align-left') this.setColAlign('left');
          else if (act === 'align-center') this.setColAlign('center');
          else if (act === 'align-right') this.setColAlign('right');
          else if (act === 'row-above') this.addRow('above');
          else if (act === 'row-below') this.addRow('below');
          else if (act === 'col-left') this.addCol('left');
          else if (act === 'col-right') this.addCol('right');
          else if (act === 'del-row') this.delRow();
          else if (act === 'del-col') this.delCol();
          else if (act === 'del-table') this.deleteTable();
          this.positionTableBar();
        });
        document.body.appendChild(bar);
        window.addEventListener('scroll', () => this.positionTableBar(), true);
        window.addEventListener('resize', () => this.positionTableBar());
      }
      if (!show) { bar.style.display = 'none'; return; }
      bar.style.display = 'flex';
      this.positionTableBar();
    }

    /* --- 代码块语言角标（右下角） --- */
    showCodeChip(pre) {
      let chip = document.getElementById('codeLangChip');
      if (!chip) {
        chip = document.createElement('div');
        chip.id = 'codeLangChip';
        chip.className = 'code-lang-chip';
        chip.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
        chip.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          this.openLangPicker(pre, chip);
        });
        document.body.appendChild(chip);
        window.addEventListener('scroll', () => this.positionCodeChip(), true);
        window.addEventListener('resize', () => this.positionCodeChip());
      }
      this._chipPre = pre;
      const lang = pre.getAttribute('data-lang') || '';
      chip.textContent = lang || 'text';
      chip.style.display = 'block';
      this.positionCodeChip();
    }

    positionCodeChip() {
      const chip = document.getElementById('codeLangChip');
      const pre = this._chipPre;
      if (!chip || !pre || !pre.isConnected) { if (chip) chip.style.display = 'none'; return; }
      const r = pre.getBoundingClientRect();
      const w = chip.offsetWidth || 40, h = chip.offsetHeight || 20;
      chip.style.left = Math.round(r.right - w - 10) + 'px';
      chip.style.top = Math.round(r.bottom - h - 8) + 'px';
    }

    hideCodeChip() {
      const chip = document.getElementById('codeLangChip');
      if (chip) chip.style.display = 'none';
      this._chipPre = null;
      const pick = document.getElementById('langPicker');
      if (pick) pick.remove();
    }

    openLangPicker(pre) {
      const old = document.getElementById('langPicker');
      if (old) old.remove();
      const langs = ['text', 'js', 'ts', 'jsx', 'html', 'css', 'json', 'yaml', 'md', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'sql', 'sh', 'bat', 'ps1', 'ini', 'toml', 'xml', 'tex'];
      const cur = pre.getAttribute('data-lang') || '';
      const box = document.createElement('div');
      box.id = 'langPicker';
      box.className = 'lang-picker';
      box.innerHTML = langs.map(l =>
        '<div class="lang-item' + ((cur === l || (!cur && l === 'text')) ? ' on' : '') +
        '" data-lang="' + l + '">' + l + '</div>').join('');
      box.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
      box.addEventListener('click', ev => {
        const it = ev.target.closest('.lang-item');
        if (!it) return;
        const v = it.getAttribute('data-lang');
        pre.setAttribute('data-lang', v === 'text' ? '' : v);
        box.remove();
        this.invalidate();
        this.emitNow();
        this.showCodeChip(pre);
      });
      document.body.appendChild(box);
      const chip = document.getElementById('codeLangChip');
      const r = chip.getBoundingClientRect();
      const h = Math.min(box.offsetHeight, 260);
      box.style.left = Math.round(Math.max(8, Math.min(r.right - 110, innerWidth - 130))) + 'px';
      box.style.top = Math.round(Math.max(10, r.top - h - 8)) + 'px';
    }

    updateCodeChip() {
      const b = this.currentBlock();
      if (b && b.tagName === 'PRE' && !(b.classList && b.classList.contains('front-matter'))) this.showCodeChip(b);
      else this.hideCodeChip();
    }

    positionTableBar() {
      const te = this.tableEdit;
      const bar = document.getElementById('tableBar');
      if (!te || !bar || bar.style.display === 'none') return;
      const r = te.table.getBoundingClientRect();
      const w = bar.offsetWidth || 300, h = bar.offsetHeight || 34;
      let left = Math.max(10, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 10));
      let top = r.top - h - 8;
      if (top < 64) top = Math.min(innerHeight - h - 10, r.bottom + 8);
      bar.style.left = Math.round(left) + 'px';
      bar.style.top = Math.round(top) + 'px';
    }

    /* --- 行内输入规则：**粗体** 变成 <strong> --- */
    /* --- 把块里的裸链接变成 <a>（打字后延迟执行，光标位置保持不变） --- */
    caretOffsetIn(blk) {
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.focusNode || !blk.contains(sel.focusNode)) return null;
      try {
        const r = document.createRange();
        r.setStart(blk, 0);
        r.setEnd(sel.focusNode, sel.focusOffset || 0);
        return r.toString().length;
      } catch (e) { return null; }
    }

    setCaretOffsetIn(blk, off) {
      const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      let rest = off, node, placed = false;
      while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (rest <= len) { r.setStart(node, rest); r.collapse(true); placed = true; break; }
        rest -= len;
      }
      if (!placed) { r.selectNodeContents(blk); r.collapse(false); }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    linkifyBlock(blk, force) {
      if (!blk || !/^(P|H[1-6]|LI|TD|BLOCKQUOTE|DIV)$/.test(blk.tagName)) return false;
      if (blk.classList && (blk.classList.contains('math-block') || blk.classList.contains('toc-block'))) return false;
      const re = /(https?:\/\/|www\.)[A-Za-z0-9\-._~:\/?#\[\]@!$&*+,;=%]+/g;

      // 收集文本节点 + 它们在块内的起始偏移
      const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n, total = 0;
      while ((n = walker.nextNode())) {
        nodes.push({ node: n, start: total });
        total += n.nodeValue.length;
      }
      const caret = this.caretOffsetIn(blk);

      const jobs = [];
      nodes.forEach(item => {
        const node = item.node;
        if (node.parentNode && node.parentNode.closest && node.parentNode.closest('a')) return;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(node.nodeValue))) {
          const absStart = item.start + m.index;
          const absEnd = absStart + m[0].length;
          // 光标正停在这个 URL 上 → 说明还在敲，先不动它（回车/失焦时例外）
          if (!force && caret != null && caret >= absStart && caret <= absEnd) continue;
          jobs.push({ node: node, from: m.index, to: m.index + m[0].length, raw: m[0] });
        }
      });
      if (!jobs.length) return false;

      // 同一节点里从后往前替换，前面的偏移才不受影响
      jobs.sort((a, b) => (a.node === b.node ? b.from - a.from : 0));
      jobs.forEach(job => {
        const node = job.node;
        const text = node.nodeValue;
        const raw = job.raw;
        const after = text.slice(job.to);
        const before = text.slice(0, job.from);
        const a = document.createElement('a');
        a.setAttribute('href', /^www\./i.test(raw) ? 'https://' + raw : raw);
        a.setAttribute('data-external', '1');
        a.textContent = raw;

        const parent = node.parentNode;
        if (after) parent.insertBefore(document.createTextNode(after), node.nextSibling);
        parent.insertBefore(a, node.nextSibling);
        node.nodeValue = before;
        if (!before) parent.removeChild(node);
      });

      if (caret != null) this.setCaretOffsetIn(blk, caret);
      return true;
    }

    scheduleLinkify() {
      clearTimeout(this._linkTimer);
      this._linkTimer = setTimeout(() => {
        if (this._composing) return;
        const blocks = [];
        const cur = this.currentBlock();
        if (cur) blocks.push(cur);
        if (this._lastBlock && blocks.indexOf(this._lastBlock) < 0) blocks.push(this._lastBlock);
        let changed = false;
        blocks.forEach(b => { if (b.isConnected && this.linkifyBlock(b)) changed = true; });
        if (changed) {
          this.invalidate();
          this.emitNow();
        }
      }, 320);
    }

    applyInlineRules(e) {
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return;
      const node = sel.focusNode;
      if (!node || node.nodeType !== 3) return;
      if (e.inputType && e.inputType !== 'insertText') return;
      const before = node.nodeValue.slice(0, sel.focusOffset);
      const rules = [
        [/\*\*([^*\n]+)\*\*$/, 'strong', 1],
        [/(^|[^\w*])\*([^*\n]+)\*$/, 'em', 2],
        [/`([^`\n]+)`$/, 'code', 1],
        [/~~([^~\n]+)~~$/, 'del', 1],
        [/==([^=\n]+)==$/, 'mark', 1]
      ];
      // 裸链接：敲到「非 URL 字符」（空格 / 中文 / 标点）时才收网，避免边打边断
      const lastCh = before.slice(-1);
      if (lastCh && !URL_CH.test(lastCh)) {
        const head = before.slice(0, -1);
        const urlM = head.match(URL_RE);
        if (urlM) {
          const raw = urlM[2];
          const href = /^www\./i.test(raw) ? 'https://' + raw : raw;
          const start = sel.focusOffset - 1 - raw.length;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + raw.length);
          range.deleteContents();
          const a = document.createElement('a');
          a.setAttribute('href', href);
          a.setAttribute('data-external', '1');
          a.textContent = raw;
          range.insertNode(a);
          const r2 = document.createRange();
          r2.setStartAfter(a);
          r2.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r2);
          this.invalidate();
          return;
        }
      }

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
        return;
      }
    }

    wrapTag(tag) {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const el = document.createElement(tag);
      try { el.appendChild(range.extractContents()); } catch (err) { return; }
      range.insertNode(el);
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
      this.emitNow();
    }

    /* --- 撤销（快照式，结构性操作也能撤回） --- */
    caretPos() {
      const b = this.currentBlock() || this._lastBlock;
      if (!b || !this.root.contains(b)) return null;
      let off = 0;
      const sel = window.getSelection();
      if (sel.rangeCount && b.contains(sel.focusNode)) {
        try {
          const r = document.createRange();
          r.setStart(b, 0);
          r.setEnd(sel.focusNode, sel.focusOffset || 0);
          off = r.toString().length;
        } catch (e) { off = 0; }
      }
      return { idx: Array.from(this.root.children).indexOf(b), off: off };
    }

    setCaretPos(pos) {
      if (!pos) return;
      const el = this.root.children[pos.idx];
      if (!el) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let rest = pos.off || 0, node, done = false;
      const r = document.createRange();
      while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (rest <= len) { r.setStart(node, rest); r.collapse(true); done = true; break; }
        rest -= len;
      }
      if (!done) { r.selectNodeContents(el); r.collapse(false); }
      try { el.focus(); } catch (e) { }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      this._lastBlock = el;
    }

    /* --- 撤销：差异事务（CM6 思路）——只记录变化的那几个块 --- */
    /* 只重算被改过的块：O(改动量)，而不是每次全文序列化 */
    nodes() {
      if (!this._htmlCache) this._htmlCache = new WeakMap();
      const dirty = this._dirtyBlocks;
      const out = [];
      for (let i = 0; i < this.root.children.length; i++) {
        const el = this.root.children[i];
        let html = this._htmlCache.get(el);
        if (html === undefined || (dirty && dirty.has(el))) {
          html = el.outerHTML;
          this._htmlCache.set(el, html);
        }
        out.push(html);
      }
      if (dirty) dirty.clear();
      return out;
    }

    markDirty(el) {
      if (!el || el === this.root) return;
      let n = el;
      while (n && n.parentNode && n.parentNode !== this.root) n = n.parentNode;
      if (n && n !== this.root) {
        if (!this._dirtyBlocks) this._dirtyBlocks = new Set();
        this._dirtyBlocks.add(n);
      }
    }

    /* 求两个「块数组」的最小差异：公共前缀 + 公共后缀之外的部分 */
    diff(prev, next) {
      let p = 0;
      const max = Math.min(prev.length, next.length);
      while (p < max && prev[p] === next[p]) p++;
      let s = 0;
      while (s < prev.length - p && s < next.length - p &&
             prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
      const removed = prev.slice(p, prev.length - s);
      const added = next.slice(p, next.length - s);
      if (!removed.length && !added.length) return null;
      return { start: p, removed: removed, added: added };
    }

    /* 把尚未结算的改动立刻记成一条事务 */
    flushDiff() {
      if (this._applying) return;
      if (this._diffTimer) { cancelAnimationFrame(this._diffTimer); this._diffTimer = 0; }
      const cur = this.nodes();
      const d = this.diff(this._prevNodes || [], cur);
      if (!d) { this._prevNodes = cur; return; }
      this._undoStack.push({
        start: d.start,
        removed: d.removed,
        added: d.added,
        caretBefore: this._prevCaret || null,
        caretAfter: this.caretPos()
      });
      if (this._undoStack.length > 500) this._undoStack.shift();
      this._redoStack = [];
      this._prevNodes = cur;
      this._prevCaret = this.caretPos();
    }

    queueDiff() {
      if (this._applying) return;
      if (this._diffTimer) return;
      this._diffTimer = requestAnimationFrame(() => { this._diffTimer = 0; this.flushDiff(); });
    }

    snapshot() { this.flushDiff(); this._prevCaret = this.caretPos(); }

    /* 正向/反向应用一条事务：只动受影响的节点 */
    applyTxn(t, inverse) {
      const removeN = inverse ? t.added.length : t.removed.length;
      const addList = inverse ? t.removed : t.added;
      this._applying = true;
      for (let i = 0; i < removeN; i++) {
        const el = this.root.children[t.start];
        if (el) el.remove();
      }
      for (let i = 0; i < addList.length; i++) {
        const box = document.createElement('div');
        box.innerHTML = addList[i];
        const node = box.firstElementChild;
        if (!node) continue;
        const ref = this.root.children[t.start + i] || null;
        this.root.insertBefore(node, ref);
      }
      this._applying = false;
      this._htmlCache = new WeakMap();
      this._dirtyBlocks = new Set();
      this.invalidate();
    }

    notify() {
      const md = this.getContent();
      this._lastEmit = md;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this.opts.onChange(md, true);
      });
    }

    undo() {
      clearTimeout(this._emitTimer);
      this.flushDiff();
      if (!this._undoStack.length) return;
      const t = this._undoStack.pop();
      this.applyTxn(t, true);
      this._redoStack.push(t);
      this._prevNodes = this.nodes();
      this._prevCaret = t.caretBefore;
      this.tableEdit = null;
      this.showTableBar(false);
      this.setCaretPos(t.caretBefore);
      this.notify();
    }

    redo() {
      this.flushDiff();
      if (!this._redoStack.length) return;
      const t = this._redoStack.pop();
      this.applyTxn(t, false);
      this._undoStack.push(t);
      this._prevNodes = this.nodes();
      this._prevCaret = t.caretAfter;
      this.setCaretPos(t.caretAfter);
      this.notify();
    }

    /* --- 表格 --- */
    updateTableContext() {
      const b = this.currentBlock();
      const table = b && b.tagName === 'TABLE' ? b : (b && b.closest ? b.closest('table') : null);
      this.tableEdit = table ? { table: table, index: this.blocks.findIndex(x => x.el === table) } : null;
      this.showTableBar(!!this.tableEdit);
      if (this.tableEdit) this.positionTableBar();
    }

    cell() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      let n = sel.focusNode;
      if (n && n.nodeType === 3) n = n.parentNode;
      return n && n.closest ? n.closest('td, th') : null;
    }

    tableRows() {
      const te = this.tableEdit;
      return te ? Array.from(te.table.querySelectorAll('tr')) : [];
    }

    addRow(where) {
      const te = this.tableEdit, c = this.cell();
      if (!te || !c) return;
      const tr = c.closest('tr');
      const cols = te.table.querySelectorAll('tr')[0].children.length;
      const ntr = document.createElement('tr');
      for (let k = 0; k < cols; k++) ntr.appendChild(document.createElement('td'));
      if (where === 'above') tr.before(ntr); else tr.after(ntr);
      this.emitNow();
    }

    addCol(side) {
      const te = this.tableEdit, c = this.cell();
      if (!te || !c) return;
      const at = Array.from(c.parentNode.children).indexOf(c) + (side === 'left' ? 0 : 1);
      Array.from(te.table.querySelectorAll('tr')).forEach(tr => {
        const tag = tr.parentNode.tagName === 'THEAD' ? 'th' : 'td';
        const cell = document.createElement(tag);
        if (tr.children[at]) tr.insertBefore(cell, tr.children[at]); else tr.appendChild(cell);
      });
      this.emitNow();
    }

    delRow() {
      const te = this.tableEdit, c = this.cell();
      if (!te || !c) return;
      const tr = c.closest('tr');
      if (tr.parentNode.tagName === 'THEAD') return;
      tr.remove();
      this.emitNow();
    }

    delCol() {
      const te = this.tableEdit, c = this.cell();
      if (!te || !c) return;
      const at = Array.from(c.parentNode.children).indexOf(c);
      Array.from(te.table.querySelectorAll('tr')).forEach(tr => { if (tr.children[at]) tr.children[at].remove(); });
      this.emitNow();
    }

    moveRow(dir) {
      const te = this.tableEdit, c = this.cell();
      if (!te || !c) return;
      const tr = c.closest('tr');
      if (tr.parentNode.tagName === 'THEAD') return;
      const sib = dir < 0 ? tr.previousElementSibling : tr.nextElementSibling;
      if (!sib) return;
      if (dir < 0) tr.parentNode.insertBefore(tr, sib); else tr.parentNode.insertBefore(sib, tr);
      this.emitNow();
    }

    moveCol(dir) {
      const te = this.tableEdit, c = this.cell();
      if (!te || !c) return;
      const at = Array.from(c.parentNode.children).indexOf(c);
      const to = at + dir;
      if (to < 0) return;
      Array.from(te.table.querySelectorAll('tr')).forEach(tr => {
        const cur = tr.children[at], ref = tr.children[to];
        if (!cur || !ref) return;
        if (dir < 0) tr.insertBefore(cur, ref); else tr.insertBefore(ref, cur);
      });
      this.emitNow();
    }

    deleteTable() {
      const te = this.tableEdit;
      if (!te) return;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      te.table.replaceWith(p);
      this.tableEdit = null;
      this.showTableBar(false);
      p.focus();
      this.emitNow();
    }

    setColAlign(align) {
      const te = this.tableEdit, c = this.cell();
      if (!te || !c) return;
      const at = Array.from(c.parentNode.children).indexOf(c);
      Array.from(te.table.querySelectorAll('tr')).forEach(tr => {
        if (tr.children[at]) tr.children[at].style.textAlign = align;
      });
      this.emitNow();
    }

    commitTable() { this.tableEdit = null; this.showTableBar(false); }

    /* 光标是否在单元格的首行 / 末行 */
    cellAtEdge(cell, down) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return true;
      const node = sel.focusNode, off = sel.focusOffset || 0;
      if (!cell.contains(node)) return true;

      // 单元格一共有几行（按 top 去重）
      const all = document.createRange();
      all.selectNodeContents(cell);
      const tops = [];
      Array.prototype.forEach.call(all.getClientRects(), r => {
        if (!tops.some(t => Math.abs(t - r.top) < 3)) tops.push(r.top);
      });
      if (!tops.length) return true;

      // 光标所在行：用 [单元格开头 → 光标] 的最后一行
      const ref = document.createRange();
      ref.setStart(cell, 0);
      try { ref.setEnd(node, off); } catch (e) { return true; }
      const refRects = ref.getClientRects();
      const caretTop = refRects.length ? refRects[refRects.length - 1].top : Math.min.apply(null, tops);

      if (down) return caretTop >= Math.max.apply(null, tops) - 3;
      return caretTop <= Math.min.apply(null, tops) + 3;
    }

    /* 同一列的上一行 / 下一行 */
    moveCellVert(dir) {
      const te = this.tableEdit;
      const cell = this.cell();
      if (!te || !cell) return;
      const rows = Array.from(te.table.querySelectorAll('tr'));
      const tr = cell.closest('tr');
      const rowIdx = rows.indexOf(tr);
      const col = Array.from(tr.children).indexOf(cell);
      const targetRow = rows[rowIdx + dir];
      if (!targetRow) return;
      const target = targetRow.children[Math.min(col, targetRow.children.length - 1)];
      if (!target) return;
      target.focus();
      if (dir > 0) this.setCaretStart(target); else this.setCaretEnd(target);
      this.tableEdit.cell = target;
      this.positionTableBar();
    }

    /* 上下方向键走到表格外：dir=1 往下，-1 往上 */
    leaveTable(dir) {
      const te = this.tableEdit;
      if (!te) return;
      const table = te.table;
      let target = dir > 0 ? table.nextElementSibling : table.previousElementSibling;
      if (!target) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        if (dir > 0) table.after(p); else table.before(p);
        target = p;
      }
      this.tableEdit = null;
      this.showTableBar(false);
      target.focus();
      if (dir > 0) this.setCaretStart(target); else this.setCaretEnd(target);
    }

    /* --- 图片 --- */
    selectImage(img) {
      this.clearImageSel(false);
      const blk = img.parentNode;
      this.imageSel = { img: img, changed: false, startWidth: 0 };
      const box = document.createElement('div');
      box.className = 'img-box';
      box.innerHTML = '<div class="img-handle" title="拖动改变宽度"></div>';
      img.parentNode.style.position = 'relative';
      img.parentNode.appendChild(box);
      const self = this;
      const place = () => {
        const r = img.getBoundingClientRect(), pr = img.parentNode.getBoundingClientRect();
        box.style.left = (r.left - pr.left) + 'px';
        box.style.top = (r.top - pr.top) + 'px';
        box.style.width = r.width + 'px';
        box.style.height = r.height + 'px';
      };
      place();
      box.querySelector('.img-handle').addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        self.imageSel.startWidth = img.getBoundingClientRect().width;
        self.imageSel.dragging = true;
        self.imageSel.startX = ev.clientX;
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
          const bx = s.img.parentNode.querySelector('.img-box');
          if (bx) {
            const r = s.img.getBoundingClientRect(), pr = s.img.parentNode.getBoundingClientRect();
            bx.style.width = r.width + 'px';
            bx.style.height = r.height + 'px';
            bx.style.left = (r.left - pr.left) + 'px';
            bx.style.top = (r.top - pr.top) + 'px';
          }
        });
        document.addEventListener('mouseup', () => {
          const s = self.imageSel;
          if (!s || !s.dragging) return;
          s.dragging = false;
          if (s.changed) self.commitImage();
        });
        document.addEventListener('keydown', ev => {
          if (!self.imageSel) return;
          if (ev.key === 'Delete' || ev.key === 'Backspace') {
            ev.preventDefault();
            self.removeSelectedImage();
          } else if (ev.key === 'Escape') self.clearImageSel(true);
        }, true);
      }
      void blk;
    }

    commitImage() {
      const s = this.imageSel;
      if (!s) return;
      const w = Math.round(parseFloat(s.img.style.width || 0));
      const box = s.img.parentNode.querySelector('.img-box');
      if (box) box.remove();
      s.img.style.width = '';
      s.img.style.maxWidth = '';
      if (w) s.img.setAttribute('width', w);
      this.imageSel = null;
      this.emitNow();
    }

    removeSelectedImage() {
      const s = this.imageSel;
      if (!s) return;
      const img = s.img;
      const box = img.parentNode && img.parentNode.querySelector('.img-box');
      if (box) box.remove();
      this.imageSel = null;
      img.remove();
      this.emitNow();
    }

    clearImageSel(commit) {
      const s = this.imageSel;
      this.imageSel = null;
      if (!s) return;
      const box = s.img.parentNode && s.img.parentNode.querySelector('.img-box');
      if (box) box.remove();
      s.img.style.width = '';
      s.img.style.maxWidth = '';
      if (commit && s.changed) {
        const w = Math.round(parseFloat(s.img.style.width || 0));
        if (w) s.img.setAttribute('width', w);
        this.emitNow();
      }
    }

    /* --- 公式块：Typora 式编辑（有边框的源码区 + 下方实时预览 + 右上角 ✓） --- */
    editMath(div) {
      if (div.classList.contains('editing')) return;
      const tex = div.getAttribute('data-tex') || '';
      div.classList.add('editing');
      div.setAttribute('contenteditable', 'false');
      div.innerHTML = '';

      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'math-ok';
      ok.textContent = '✓';
      ok.title = '完成编辑（Esc）';

      const ta = document.createElement('textarea');
      ta.className = 'math-src';
      ta.spellcheck = false;
      ta.value = tex;
      ta.placeholder = '在这里写 TeX，例如 \\frac{1}{2}';

      const prev = document.createElement('div');
      prev.className = 'math-preview';

      div.appendChild(ok);
      div.appendChild(ta);
      div.appendChild(prev);

      const sync = () => {
        const t = ta.value.trim();
        div.setAttribute('data-tex', t);
        ta.style.height = 'auto';
        ta.style.height = Math.min(240, Math.max(48, ta.scrollHeight)) + 'px';
        this.renderMath(prev, t, true);
      };

      const commit = () => {
        if (!div.classList.contains('editing')) return;
        const t = ta.value.trim();
        div.classList.remove('editing');
        div.setAttribute('data-tex', t);
        div.innerHTML = '';
        if (t) this.renderMath(div, t, false);
        else div.innerHTML = '<span class="math-empty">&lt; Empty Math Block &gt;</span>';
        this._mathEditing = null;
        this.invalidate();
        this.ensureTrailing();
        this.emitNow();
      };

      ta.addEventListener('input', sync);
      ta.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
          ev.preventDefault();
          ev.stopPropagation();
          commit();
        }
      });
      ok.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
      ok.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); commit(); });

      this._mathEditing = { div: div, commit: commit };
      sync();
      this._mathOpenedAt = Date.now();
      try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { }
      this.invalidate();
      this.emitNow();
    }

    /* emptyText=true 时，空公式显示占位符 */
    renderMath(el, tex, emptyText) {
      if (!tex) {
        el.innerHTML = emptyText ? '<span class="math-empty">&lt; Empty Math Block &gt;</span>' : '';
        return;
      }
      try {
        el.innerHTML = global.katex && global.katex.renderToString
          ? global.katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: 'ignore' })
          : esc(tex);
      } catch (err) { el.textContent = tex; }
    }
  }

  global.Wysiwyg = Wysiwyg;
  global.MD.renderForEdit = toEditHTML;
})(window);