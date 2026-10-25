/* ============================================================
   Lanyu · Markdown 渲染内核（无依赖、离线）
   暴露：window.MD.render(src, opts) / MD.outline(src) / MD.highlight(code, lang)
   ============================================================ */
(function (global) {
  'use strict';

  const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, c => HTML_ESCAPE[c]); }

  /* ---------------- 语法高亮 ---------------- */
  // 每条规则：[正则源码, 令牌类名]，内部一律用非捕获组
  const KW = 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|export|from|default|delete|void|null|undefined|true|false|static|get|set|interface|type|enum|implements|public|private|protected|readonly|namespace|declare';
  const KWC = 'using|namespace|class|struct|interface|enum|public|private|protected|internal|static|readonly|void|int|string|bool|double|float|long|var|new|return|if|else|for|foreach|while|do|switch|case|break|continue|try|catch|finally|throw|async|await|await|this|base|null|true|false|override|virtual|abstract|sealed|partial|get|set|value|out|ref|in|params';
  const KWP = 'def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|pass|raise|lambda|yield|global|nonlocal|assert|del|in|is|not|and|or|None|True|False|async|await|match|case|self';

  const RULES = {
    js: [
      ['\\/\\*[\\s\\S]*?\\*\\/', 'com'],
      ['\\/\\/[^\\n]*', 'com'],
      ['`(?:\\\\[\\s\\S]|[^`\\\\])*`', 'str'],
      ['"(?:\\\\[\\s\\S]|[^"\\\\])*"', 'str'],
      ["'(?:\\\\[\\s\\S]|[^'\\\\])*'", 'str'],
      ['\\b(?:0[xX][\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b', 'num'],
      ['\\b(?:' + KW + ')\\b', 'kw'],
      ['\\b[A-Z][\\w$]*\\b', 'type'],
      ['\\b[A-Za-z_$][\\w$]*(?=\\s*\\()', 'fn'],
      ['\\b[A-Za-z_$][\\w$]*(?=\\s*:)', 'prop'],
      ['[{}()\\[\\];,]', 'punc']
    ],
    py: [
      ['#[^\\n]*', 'com'],
      ['"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'', 'str'],
      ['(?:[rbfuRBFU]{0,2})"(?:\\\\[\\s\\S]|[^"\\\\])*"', 'str'],
      ["(?:[rbfuRBFU]{0,2})'(?:\\\\[\\s\\S]|[^'\\\\])*'", 'str'],
      ['\\b(?:0[xXoObB][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b', 'num'],
      ['\\b(?:' + KWP + ')\\b', 'kw'],
      ['@[\\w.]+', 'dec'],
      ['\\b[A-Za-z_]\\w*(?=\\s*\\()', 'fn'],
      ['\\b[A-Z][A-Za-z0-9_]*\\b', 'type']
    ],
    json: [
      ['"(?:\\\\[\\s\\S]|[^"\\\\])*"(?=\\s*:)', 'prop'],
      ['"(?:\\\\[\\s\\S]|[^"\\\\])*"', 'str'],
      ['\\b(?:-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b', 'num'],
      ['\\b(?:true|false|null)\\b', 'kw'],
      ['[{}()\\[\\],:]', 'punc']
    ],
    css: [
      ['\\/\\*[\\s\\S]*?\\*\\/', 'com'],
      ['"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\])*\'', 'str'],
      ['@[\\w-]+', 'kw'],
      ['#[0-9a-fA-F]{3,8}\\b', 'num'],
      ['\\b[-+]?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|ch)?\\b', 'num'],
      ['[-a-zA-Z]+(?=\\s*:)', 'prop'],
      ['[.#][\\w-]+', 'type'],
      ['\\b(?:!important)\\b', 'kw'],
      ['[{}();,]', 'punc']
    ],
    html: [
      ['<!--[\\s\\S]*?-->', 'com'],
      ['<!DOCTYPE[^>]*>', 'kw'],
      ['<\\/?[a-zA-Z][\\w:-]*', 'tag'],
      ['\\b[a-zA-Z-]+(?==)', 'attr'],
      ['"(?:[^"]*)"|\'[^\']*\'', 'str'],
      ['>', 'tag']
    ],
    cs: [
      ['\\/\\/[^\\n]*', 'com'],
      ['\\/\\*[\\s\\S]*?\\*\\/', 'com'],
      ['\\$?"(?:\\\\[\\s\\S]|[^"\\\\])*"', 'str'],
      ['\\b(?:0[xX][\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[fFdDmM]?)\\b', 'num'],
      ['\\b(?:' + KWC + ')\\b', 'kw'],
      ['\\b[A-Z][A-Za-z0-9_]*\\b', 'type'],
      ['\\b[A-Za-z_]\\w*(?=\\s*\\()', 'fn'],
      ['[{}()\\[\\];,]', 'punc']
    ],
    sql: [
      ['--[^\\n]*', 'com'],
      ['\\/\\*[\\s\\S]*?\\*\\/', 'com'],
      ["'(?:''|[^'])*'", 'str'],
      ['\\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|AS|ON|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|DISTINCT|UNION|ALL|CASE|WHEN|THEN|ELSE|END|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|ALTER|DROP|ADD|EXISTS|COUNT|SUM|AVG|MIN|MAX)\\b', 'kw'],
      ['\\b\\d+(?:\\.\\d+)?\\b', 'num'],
      ['[(),;=*<>]', 'punc']
    ],
    sh: [
      ['#[^\\n]*', 'com'],
      ['"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'[^\']*\'', 'str'],
      ['\\$\\{[^}]*\\}|\\$\\w+|\\$\\?|\\$\\d', 'var'],
      ['\\b(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|export|local|echo|cd|exit|set|source)\\b', 'kw'],
      ['\\s-{1,2}[\\w-]+', 'attr'],
      ['\\b\\d+\\b', 'num']
    ],
    yaml: [
      ['#[^\\n]*', 'com'],
      ['^\\s*[-\\w.]+(?=\\s*:)', 'prop'],
      ['"(?:[^"]*)"|\'[^\']*\'', 'str'],
      ['\\b(?:true|false|null|yes|no)\\b', 'kw'],
      ['\\b\\d+(?:\\.\\d+)?\\b', 'num']
    ],
    diff: [
      ['^\\+[^\\n]*', 'add'],
      ['^-[^\\n]*', 'del'],
      ['^@@[^\\n]*', 'meta'],
      ['^diff[^\\n]*', 'meta']
    ]
  };

  const ALIAS = {
    javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', tsx: 'js', vue: 'js',
    python: 'py', py3: 'py', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', powershell: 'sh', ps1: 'sh',
    'c#': 'cs', csharp: 'cs', cs: 'cs', java: 'cs', c: 'cs', 'c++': 'cs', cpp: 'cs', go: 'cs', rust: 'cs', rs: 'cs', kt: 'cs', kotlin: 'cs', swift: 'cs',
    yml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml',
    jsonc: 'json', json5: 'json',
    htm: 'html', xml: 'html', svg: 'html', markdown: 'html', md: 'html'
  };

  function highlight(code, lang) {
    const key = String(lang || '').trim().toLowerCase();
    const rules = RULES[key] || RULES[ALIAS[key]];
    if (!rules) return esc(code);

    const source = rules.map(r => '(' + r[0] + ')').join('|');
    let re;
    try { re = new RegExp(source, 'gm'); } catch (e) { return esc(code); }

    let out = '', last = 0, m, guard = 0;
    while ((m = re.exec(code)) && guard++ < 200000) {
      let gi = -1;
      for (let i = 1; i < m.length; i++) { if (m[i] !== undefined) { gi = i - 1; break; } }
      if (gi < 0) { re.lastIndex++; continue; }
      if (m.index > last) out += esc(code.slice(last, m.index));
      out += '<span class="tok-' + rules[gi][1] + '">' + esc(m[0]) + '</span>';
      last = re.lastIndex;
      if (m[0].length === 0) re.lastIndex++;
    }
    out += esc(code.slice(last));
    return out;
  }

  /* ---------------- 数学公式 ---------------- */
  function mathHTML(tex, display) {
    try {
      if (global.katex && global.katex.renderToString) {
        return global.katex.renderToString(String(tex), {
          displayMode: !!display,
          throwOnError: false,
          strict: 'ignore',
          output: 'html'
        });
      }
    } catch (e) { }
    return null;
  }
  /* ---------------- 行内 ---------------- */
  function inline(text, opts) {
    const stash = [];
    const keep = html => { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; };

    let s = String(text);

    // 反斜杠转义
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>~|=])/g, (m, c) => keep(esc(c)));

    // 行内代码
    s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, f, code) =>
      keep('<code>' + esc(code.replace(/^ /, '').replace(/ $/, '')) + '</code>'));

    // 行内公式
    s = s.replace(/\$([^$\n]+?)\$/g, (m, tex) => {
      const html = mathHTML(tex, false);
      return keep(html ? '<span class="math-inline">' + html + '</span>'
        : '<span class="math-inline math-raw">' + esc(tex) + '</span>');
    });

    // 脚注引用 [^label]
    s = s.replace(/\[\^([^\]\s]+)\]/g, (m, label) =>
      keep('<sup class="fn-ref" data-fn="' + esc(label) + '">' + esc(label) + '</sup>'));

    // 图片
    s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+&quot;([^&]*)&quot;|\s+"([^"]*)")?\s*\)/g,
      (m, alt, src, t1, t2) => {
        const title = t1 || t2;
        return keep('<img src="' + src.replace(/"/g, '%22') + '" alt="' + esc(stripTags(alt)) + '"' +
          (title ? ' title="' + esc(title) + '"' : '') + ' loading="lazy">');
      });

    // 链接
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (m, label, href, title) => {
      const inner = applyEmphasis(esc(label));
      const external = /^(https?:|mailto:)/i.test(href);
      return keep('<a href="' + esc(href) + '"' + (title ? ' title="' + esc(title) + '"' : '') +
        (external ? ' data-external="1"' : '') + '>' + inner + '</a>');
    });

    // 自动链接 <https://...>
    s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (m, url) =>
      keep('<a href="' + esc(url) + '" data-external="1">' + esc(url) + '</a>'));

    // 裸链接：允许紧贴中文（访问https://x.com看看），URL 本体只吃 ASCII
    s = s.replace(/(^|[\s(（「【>|]|[\u3000-\u9fff])((?:https?:\/\/|mailto:|www\.)[A-Za-z0-9\-._~:\/?#\[\]@!$&'*+,;=%]+)/g,
      (m, pre, url) => {
        const href = /^www\./i.test(url) ? 'https://' + url : url;
        return pre + keep('<a href="' + esc(href) + '" data-external="1">' + esc(url) + '</a>');
      });

    // 单元格 / 正文里的显式换行 <br> 原样保留
    s = s.replace(/<br\s*\/?>/gi, () => keep('<br>'));

    // 其余文本转义
    s = esc(s);

    // 强调
    s = applyEmphasis(s);

    // 换行
    s = s.replace(/ {2,}\n/g, '<br>\n');
    s = s.replace(/\n/g, (opts && opts.softBreak === false) ? ' ' : '<br>');

    // 还原
    s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => stash[+n] || '');
    return s;
  }

  function applyEmphasis(s) {
    s = s.replace(/\*\*\*([^\s*][\s\S]*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^\s*][\s\S]*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w])__([^\s_][\s\S]*?)__(?![\w])/g, '$1<strong>$2</strong>');
    s = s.replace(/~~([^\s~][\s\S]*?)~~/g, '<del>$1</del>');
    s = s.replace(/==([^\s=][\s\S]*?)==/g, '<mark>$1</mark>');
    s = s.replace(/\*([^\s*][^*]*?)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^\w])_([^\s_][^_]*?)_(?![\w])/g, '$1<em>$2</em>');
    return s;
  }

  function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }

  function plainText(s) {
    return stripTags(
      inline(String(s), { softBreak: false })
    ).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  /* ---------------- 块级 ---------------- */
  const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
  const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const RE_QUOTE = /^ {0,3}> ?/;
  const RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const RE_TABLE_DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
  const RE_HTML_BLOCK = /^ {0,3}<\/?(address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|img|legend|li|link|main|menu|nav|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul|video|audio|pre|script|style|svg)\b/i;

  function render(src, opts) {
    opts = Object.assign({ softBreak: true }, opts || {});
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

      // YAML Front Matter（仅文件最开头）
      if (lines.length && /^---\s*$/.test(lines[0])) {
        let j = 1;
        while (j < lines.length && !/^---\s*$/.test(lines[j])) j++;
        if (j < lines.length) {
          out.push('<pre class="front-matter" data-src="0">' + esc(lines.slice(1, j).join('\n')) + '</pre>');
          i = j + 1;
        }
      }

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

         // 脚注定义 [^label]: text
         const fnDef = line.match(/^\[\^([^\]\s]+)\]:\s*(.*)$/);
         if (fnDef) {
           out.push('<p class="fn-def" data-fn="' + esc(fnDef[1]) + '">' + inline(fnDef[2]) + '</p>');
           i++;
           continue;
         }

         // 内容目录占位
         if (/^\[toc\]\s*$/i.test(line.trim())) {
           out.push('<div class="toc-block" data-src="' + i + '"><!--TOC--></div>');
           i++;
           continue;
         }

      // 代码块
      let fm = line.match(RE_FENCE);
      if (fm) {
        const marker = fm[1][0], len = fm[1].length, lang = fm[2] || '';
        const buf = [];
        const start = i;
        i++;
        while (i < lines.length) {
          const close = lines[i].match(RE_FENCE);
          if (close && close[1][0] === marker && close[1].length >= len && !close[2]) { i++; break; }
          buf.push(lines[i]); i++;
        }
        const code = buf.join('\n');
        const langLabel = lang || 'text';
        out.push(
          '<div class="code-block" data-src="' + start + '">' +
          '<div class="code-head"><span class="code-lang">' + esc(langLabel) + '</span>' +
          '<button class="code-copy" data-copy="1" title="复制代码">复制</button></div>' +
          '<pre class="code-body"><code class="lang-' + esc(langLabel.toLowerCase()) + '">' +
          highlight(code, lang) + '</code></pre></div>');
        continue;
      }

      // 行间公式 $$ ... $$
      if (/^\s*\$\$/.test(line)) {
        const start = i;
        const buf = [];
        const head = line.replace(/^\s*\$\$/, '');
        if (/\$\$\s*$/.test(head)) {
          buf.push(head.replace(/\$\$\s*$/, '')); i++;
        } else {
          if (head.trim()) buf.push(head);
          i++;
          while (i < lines.length && !/\$\$\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
          if (i < lines.length) { buf.push(lines[i].replace(/\$\$\s*$/, '')); i++; }
        }
        const tex = buf.join('\n').trim();
        const mhtml = mathHTML(tex, true);
        out.push('<div class="math-block" data-tex="' + esc(tex) + '" data-src="' + start + '">' +
          (mhtml || '<span class="math-raw">' + esc(tex) + '</span>') + '</div>');
        continue;
      }

      // 标题
      let hm = line.match(RE_HEADING);
      if (hm) {
        const lvl = hm[1].length;
        const text = hm[2].replace(/\s+#+\s*$/, '');
        out.push('<h' + lvl + ' id="h-' + i + '" data-src="' + i + '">' + inline(text, opts) + '</h' + lvl + '>');
        i++; continue;
      }

      // 分隔线
      if (RE_HR.test(line)) { out.push('<hr data-src="' + i + '">'); i++; continue; }

      // 引用
      if (RE_QUOTE.test(line)) {
        const start = i;
        const buf = [];
        while (i < lines.length && (RE_QUOTE.test(lines[i]) || (lines[i].trim() && buf.length && !isBlockStart(lines[i])))) {
          buf.push(lines[i].replace(RE_QUOTE, ''));
          i++;
        }
        out.push('<blockquote data-src="' + start + '">' + render(buf.join('\n'), opts) + '</blockquote>');
        continue;
      }

      // 表格
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1])) {
        const start = i;
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map(c => {
          const t = c.trim();
          if (/^:-+:$/.test(t) || /^:-+$/.test(t) && t.endsWith(':')) return 'center';
          if (/^:-+$/.test(t)) return 'left';
          if (/^-+:$/.test(t)) return 'right';
          return '';
        });
        const delimLine = lines[i + 1];
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
          rows.push(splitRow(lines[i])); i++;
        }
        // 分隔行的短横线数量不同 → 视为列宽比例
        const dashes = splitRow(delimLine).map(c => c.trim()).filter(c => c.length).map(c => (c.match(/-/g) || []).length);
        const dashSum = dashes.reduce((a, b) => a + b, 0) || 1;
        const uniform = dashes.every(d => Math.abs(d - dashes[0]) <= 1);
        let colgroup = '';
        if (!uniform && dashes.length === head.length && dashSum > 0) {
          colgroup = '<colgroup>';
          dashes.forEach(d => { colgroup += '<col style="width:' + ((d / dashSum) * 100).toFixed(2) + '%">'; });
          colgroup += '</colgroup>';
        }
        let t = '<div class="table-wrap"><table data-src="' + start + '">' + colgroup + '<thead><tr>';
        head.forEach((c, idx) => {
          t += '<th' + (aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '') + '>' + inline(c.trim(), opts) + '</th>';
        });
        t += '</tr></thead><tbody>';
        rows.forEach(r => {
          t += '<tr>';
          for (let c = 0; c < head.length; c++) {
            t += '<td' + (aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '') + '>' +
              inline((r[c] || '').trim(), opts) + '</td>';
          }
          t += '</tr>';
        });
        t += '</tbody></table></div>';
        out.push(t);
        continue;
      }

      // 列表
      if (RE_LIST.test(line)) {
        const res = parseList(lines, i, opts);
        out.push(res.html);
        i = res.next;
        continue;
      }

      // HTML 块
      if (RE_HTML_BLOCK.test(line)) {
        const start = i;
        const buf = [];
        while (i < lines.length && lines[i].trim()) { buf.push(lines[i]); i++; }
        out.push('<div class="html-block" data-src="' + start + '">' + buf.join('\n') + '</div>');
        continue;
      }

      // 段落
      const start = i;
      const buf = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
      out.push('<p data-src="' + start + '">' + inline(buf.join('\n'), opts) + '</p>');
    }

    const __html = out.join('\n');
    if (__html.indexOf('<!--TOC-->') >= 0) {
      const heads = [];
      __html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (m, lv, attrs, txt) => {
        const src = /data-src="(\d+)"/.exec(attrs);
        heads.push({ lv: +lv, txt: txt.replace(/<[^>]+>/g, '').trim(), line: src ? +src[1] : -1 });
        return m;
      });
      const items = heads.map(h =>
        '<div class="toc-item lv' + h.lv + '" data-line="' + h.line + '">' + esc(h.txt) + '</div>').join('');
      return __html.replace('<!--TOC-->', items || '<div class="toc-empty">（还没有标题）</div>');
    }
    return __html;
  }

  function isBlockStart(line) {
    return RE_FENCE.test(line) || /^\s*\$\$/.test(line) || RE_HEADING.test(line) || RE_HR.test(line) ||
      RE_QUOTE.test(line) || RE_LIST.test(line) || RE_HTML_BLOCK.test(line);
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '', esc2 = false;
    for (const ch of s) {
      if (esc2) { cur += ch; esc2 = false; continue; }
      if (ch === '\\') { cur += ch; esc2 = true; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  }

  function parseList(lines, i, opts) {
    const flat = [];
    const start = i;
    let inFence = false;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const nx = lines[i + 1];
        if (nx && (RE_LIST.test(nx) || /^\s{2,}\S/.test(nx))) { i++; continue; }
        break;
      }
      if (RE_FENCE.test(line)) { inFence = !inFence; i++; continue; }
      const m = line.match(RE_LIST);
      if (m && !inFence) {
        flat.push({ indent: m[1].replace(/\t/g, '    ').length, marker: m[2], text: m[3], line: i });
        i++;
        continue;
      }
      if (/^\s{2,}\S/.test(line) && flat.length) {
        flat[flat.length - 1].text += '\n' + line.trim();
        i++;
        continue;
      }
      break;
    }

    if (!flat.length) return { html: '', next: i };

    const minIndent = Math.min.apply(null, flat.map(f => f.indent));
    flat.forEach(f => { f.indent -= minIndent; });

    function build(pos, indent) {
      const first = flat[pos];
      const ordered = /\d/.test(first.marker);
      const startNum = ordered ? parseInt(first.marker, 10) : 1;
      let html = ordered ? '<ol' + (startNum !== 1 ? ' start="' + startNum + '"' : '') + ' data-src="' + start + '">' : '<ul data-src="' + start + '">';
      while (pos < flat.length && flat[pos].indent === indent) {
        const it = flat[pos];
        // 列表类型变了就断开，交给外层重新开一个列表
        if (/\d/.test(it.marker) !== ordered) break;
        pos++;
        let content = it.text;
        let cls = '', prefix = '';
        const task = content.match(/^\[( |x|X)\]\s+([\s\S]*)$/);
        if (task) {
          cls = ' class="task' + (task[1].toLowerCase() === 'x' ? ' done' : '') + '"';
          prefix = '<input type="checkbox" data-task-line="' + it.line + '"' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '>';
          content = task[2];
        }
        html += '<li' + cls + ' data-src="' + it.line + '">' + prefix +
          '<span class="li-text">' + inline(content, opts) + '</span>';
        if (pos < flat.length && flat[pos].indent > indent) {
          const sub = build(pos, flat[pos].indent);
          html += sub.html;
          pos = sub.pos;
        }
        html += '</li>';
      }
      html += ordered ? '</ol>' : '</ul>';
      return { html, pos };
    }

    let pos = 0, html = '';
    let guard = 0;
    while (pos < flat.length && guard++ < 5000) {
      const r = build(pos, flat[pos].indent);
      html += r.html;
      pos = r.pos > pos ? r.pos : pos + 1;
    }
    return { html, next: i };
  }

  /* ---------------- 大纲 ---------------- */
  function outline(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    const res = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(RE_FENCE);
      if (fm) {
        if (!fence) fence = fm[1][0];
        else if (fm[1][0] === fence) fence = null;
        continue;
      }
      if (fence) continue;
      const hm = lines[i].match(RE_HEADING);
      if (hm) {
        res.push({
          level: hm[1].length,
          text: plainText(hm[2].replace(/\s+#+\s*$/, '')) || '(无标题)',
          line: i,
          id: 'h-' + i
        });
      }
    }
    return res;
  }

  global.MD = { render, outline, highlight, esc, inline };
})(window);