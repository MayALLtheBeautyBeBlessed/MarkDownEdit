/* ============================================================
   MarkEdit —— 应用逻辑
   ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const el = {
    editor: $('editor'), hl: $('hl'), gutter: $('gutter'), preview: $('preview'),
    sourcePane: $('sourcePane'), previewPane: $('previewPane'), panes: $('panes'),
    splitter: $('splitter'), sidebar: $('sidebar'),
    docName: $('docName'), docPath: $('docPath'),
    outlineList: $('outlineList'), fileTree: $('fileTree'),
    welcome: $('welcome'), recentList: $('recentList'),
    findbar: $('findbar'), findInput: $('findInput'), replaceInput: $('replaceInput'),
    findCount: $('findCount'),
    stState: $('stState'), stSaved: $('stSaved'), stWords: $('stWords'),
    stChars: $('stChars'), stCursor: $('stCursor'), stRead: $('stRead'), stZoom: $('stZoom'),
    toast: $('toast'), ctxmenu: $('ctxmenu'), settings: $('settingsModal'), closeModal: $('closeModal'),
    printRoot: null,
    tabbar: $('tabbar'),
    help: $('helpModal'),
    bgLayer: $('bgLayer'),
    wyPane: $('wyPane'), wyDoc: $('wyDoc')
  };

  const host = window.chrome && window.chrome.webview ? window.chrome.webview : null;

  const DEFAULT_PREFS = {
    theme: 'light', font: 'sans', size: 15, width: 780, lh: 1.75,
    softBreak: true, lineNo: true, autoSave: true, sync: true, view: 'wysiwyg',
    autoSaveMs: 180000,
    fullscreenBorderless: true, panelAlpha: 45, sidebarWidth: 262,
    bgImage: '', bgOpacity: 35, bgBlur: 0, bgDim: 0, bgSize: 'cover', bgRepeat: false,
    panelBlur: false, textColor: ''
  };

  const state = {
    path: null,
    name: '未命名',
    content: '',
    savedAt: null,
    dirty: false,
    view: 'split',
    prefs: Object.assign({}, DEFAULT_PREFS),
    recent: [],
    tree: null,
    rootDir: null,
    tabs: [],
    active: -1,
    find: { matches: [], index: -1, query: '' },
    lastSavedText: '',
    composing: false
  };

  let wy = null;
  let wyRefreshTimer = null;
  let wyScrollRaf = 0;

  /* ---------------- 即时渲染编辑器 ---------------- */
  function createWysiwyg() {
    if (typeof window.Wysiwyg !== 'function') return null;
    return new window.Wysiwyg({
      root: el.wyDoc,
      render: src => window.MD.render(src, { softBreak: state.prefs.softBreak }),
      onChange: (content) => {
        state.content = content;
        state.dirty = content !== state.lastSavedText;
        syncActiveTab();
        updateDocChrome();
        setStatus('editing');
        scheduleRender();
        scheduleAutosave();
      },
      onCaret: (line, col) => {
        el.stCursor.textContent = '行 ' + line + '，列 ' + col;
        markOutlineAtLine(line);
      },
      onScroll: () => {
        if (wyScrollRaf) return;
        wyScrollRaf = requestAnimationFrame(() => {
          wyScrollRaf = 0;
          const topLine = currentWysiwygLine();
          if (topLine != null) markOutlineAtLine(topLine);
        });
      },
      onLink: url => post({ cmd: 'openExternal', url: url }),
      onCopy: btn => {
        const code = btn.closest('.code-block').querySelector('code');
        navigator.clipboard.writeText(code.innerText).then(() => {
          btn.textContent = '已复制';
          setTimeout(() => btn.textContent = '复制', 1200);
        });
      },
      onImage: file => handleImageFile(file),
pickImage: () => post({ cmd: 'pickImage' }),
      toRel: p => {
        if (!p || !state.path) return p;
        const dir = state.path.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        let s = String(p).replace(/^file:\/\/\//, '');
        if (/^[A-Za-z]:\//.test(s) && s.toLowerCase().indexOf(dir.toLowerCase() + '/') === 0) {
          s = s.slice(dir.length + 1);
        }
        return s;
      },
      fixImages: root => fixImages(root)
    });
  }

  function syncWysiwyg() {
    if (!wy) return;
    if (state.view !== 'wysiwyg') return;
    if (wy.getContent() !== state.content) wy.load(state.content);
  }

  /* ---------------- 宿主桥 ---------------- */
  function post(msg) {
    if (host) host.postMessage(msg);
  }

  /* 任何位置点链接都交给系统浏览器，绝不让 WebView2 自己导航 */
  document.addEventListener('click', ev => {
    const a = ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;
    let href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    if (/^www\./i.test(href)) href = 'https://' + href;
    ev.preventDefault();
    ev.stopPropagation();
    post({ cmd: 'openExternal', url: href });
  }, true);

  if (host) {
    /* 分片消息拼回（大文件超过 WebView2 单条消息上限时走这条路） */
    function takeChunk(m) {
      if (!state._chunks || state._chunks.length !== m.n) state._chunks = new Array(m.n);
      state._chunks[m.i] = m.s;
      if (state._chunks.filter(Boolean).length !== m.n) return null;
      const full = state._chunks.join('');
      state._chunks = null;
      try { return JSON.parse(full); } catch (e) { return null; }
    }

    function dispatch(m) {
      if (!m || !m.type) return;
      switch (m.type) {
        case 'file': openFileData(m); break;
        case 'saved': {
          const tabId = state._pendingSave;
          state._pendingSave = null;
          let t = state.tabs.find(x => x.id === tabId) || activeTab();
          if (t) {
            t.path = m.path;
            t.name = baseName(m.path);
            t.savedAt = new Date();
            t.dirty = false;
            t.lastSavedText = t.content;
          }
          if (t && state.tabs[state.active] === t) {
            state.path = t.path;
            state.name = t.name;
            state.savedAt = t.savedAt;
            state.dirty = false;
            state.lastSavedText = t.content;
            updateDocChrome();
            setStatus('saved');
          }
          renderTabs();
          break;
        }
        case 'tree': state.tree = m.tree; state.rootDir = m.root; renderTree(); break;
        case 'recent': state.recent = m.items || []; renderRecent(); break;
        case 'prefs': applyPrefs(parseJSON(m.json)); break;
        case 'image': insertImagePath(m.rel, m.path); break;
case 'info':
          state.dataDir = m.dataDir;
          state.isTempDir = !!m.isTemp;
          $('dataDirPath').textContent = m.dataDir || '未知';
          $('dataDirPath').title = m.dataDir || '';
          $('dataDirWarn').style.display = m.isTemp ? 'block' : 'none';
          break;
        case 'fullscreen':
          state.fullscreen = !!m.on;
          document.body.classList.toggle('is-fullscreen', !!m.on);
          break;
        case 'askClose':
          askClose();
          break;
        case 'assoc':
          toast(m.ok ? '已注册到「打开方式」' : '注册失败，见日志');
          break;
        case 'assocDefault':
          toast(m.ok ? '已把 .md 的默认程序设为 MarkEdit' : '设置失败，见日志', 2600);
          break;
        case 'bgpicked':
          state.prefs.bgImage = m.path;
          applyBackground();
          savePrefs();
          toast('背景已设置');
          break;
        case 'exported': toast('已导出：' + m.path); break;
        case 'pdf': toast(m.ok ? 'PDF 已导出' : 'PDF 导出失败'); endPrint(); break;
        case 'error': toast(m.message, 2600); break;
        case 'confirm': if (state._confirmCb) { state._confirmCb(m.ok); state._confirmCb = null; } break;
      }
    }

    host.addEventListener('message', ev => {
      const m = ev.data;
      if (m && m.type === 'chunk') {
        const whole = takeChunk(m);
        if (whole) dispatch(whole);
        return;
      }
      dispatch(m);
    });
  }

  function parseJSON(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }
  function baseName(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(); }

  /* ---------------- 超时保护：没有宿主时用示例文档 ---------------- */
  const DEMO = [
    '# MarkEdit',
    '',
    '> 一个安静的 Markdown 编辑器。左边是源码，右边是它现在的样子。',
    '',
    '## 它能做什么',
    '',
    '- **双栏 / 源码 / 阅读** 三种视图，`Ctrl+1/2/3` 随手切换',
    '- 大纲、文件夹树、实时字数、段落内换行',
    '- 代码高亮、表格、任务清单、图片粘贴',
    '- 自动保存 + 崩溃草稿恢复',
    '- 导出 HTML、导出 PDF',
    '',
    '### 代码',
    '',
    '```js',
    'function greet(name) {',
    '  // 中文注释也不会乱',
    '  return `你好，${name}！`;',
    '}',
    '```',
    '',
    '### 表格',
    '',
    '| 功能 | 快捷键 | 说明 |',
    '| :--- | :---: | ---: |',
    '| 保存 | Ctrl+S | 自动写盘 |',
    '| 查找 | Ctrl+F | 支持替换 |',
    '| 加粗 | Ctrl+B | 包裹选区 |',
    '',
    '### 任务清单',
    '',
    '- [x] 选一个顺眼的主题',
    '- [ ] 写下第一行字',
    '- [ ] 把这篇导出成 PDF',
    '',
    '---',
    '',
    '行内公式用 `$E=mc^2$` 表示，行间公式：',
    '',
    '$$\\int_a^b f(x)\\,dx = F(b) - F(a)$$',
    '',
    '快捷键 `Ctrl+\\` 收起侧栏，`F11` 全屏。祝写得开心。'
  ].join('\n');

  /* ---------------- 启动 ---------------- */
  function boot() {
    wy = createWysiwyg();
    bindUI();
    ensurePrintRoot();
    post({ cmd: 'getPrefs' });
    post({ cmd: 'info' });
    post({ cmd: 'recent', op: 'list' });
    setTimeout(() => {
      if (!host) {
        openContent('示例.md', DEMO, null);
        return;
      }
      if (!state.tabs.length) { newTab('未命名', '', null); }
      if (!state.content) showWelcome(true);
    }, 260);
    if (host) post({ cmd: 'ready' });
  }

  function showWelcome(v) {
    el.welcome.classList.toggle('hidden', !v);
  }

  /* ---------------- 偏好 ---------------- */
  function applyPrefs(p) {
    state.prefs = Object.assign({}, DEFAULT_PREFS, p || {});
    const pr = state.prefs;
    document.documentElement.dataset.theme = pr.theme;
    document.documentElement.dataset.font = pr.font;
    document.documentElement.style.setProperty('--fs-body', pr.size + 'px');
    document.documentElement.style.setProperty('--maxw', pr.width + 'px');
    document.documentElement.style.setProperty('--lh-body', pr.lh);
document.documentElement.style.setProperty('--panel-alpha', (pr.panelAlpha == null ? 45 : pr.panelAlpha) + '%');
    document.documentElement.style.setProperty('--panel-blur', pr.panelBlur ? '10px' : '0px');
    document.documentElement.style.setProperty('--sidebar-w', (pr.sidebarWidth || 262) + 'px');
    applyTextColor(pr.textColor);
    el.gutter.classList.toggle('hidden', !pr.lineNo);
    applyBackground();
    syncSettingsUI();
    renderPreview();
    refreshGutter();
    if (pr.view && pr.view !== state.view) setView(pr.view, true);
    if (wy) {
      clearTimeout(wyRefreshTimer);
      wyRefreshTimer = setTimeout(() => {
        if (state.view === 'wysiwyg') wy.refresh();
      }, 120);
    }
  }

  function savePrefs() {
    post({ cmd: 'setPrefs', json: JSON.stringify(state.prefs) });
  }

function pathToUrl(p) {
    if (!p) return '';
    if (/^(file|https?|data):/i.test(p)) return p;
    return 'file:///' + encodeURI(String(p).replace(/\\/g, '/'));
  }

function normalizeHex(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^#?[0-9a-fA-F]{3}$/.test(v)) {
      v = v.replace('#', '');
      return '#' + v.split('').map(c => c + c).join('');
    }
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) return '#' + v.replace('#', '').toUpperCase();
    return null;
  }

  function applyTextColor(color) {
    const root = document.documentElement;
    const hex = normalizeHex(color);
    if (!hex) {
      root.style.removeProperty('--text');
      root.style.removeProperty('--text-mid');
      root.style.removeProperty('--text-dim');
      return;
    }
    root.style.setProperty('--text', hex);
    root.style.setProperty('--text-mid', 'color-mix(in srgb, ' + hex + ' 76%, var(--bg))');
    root.style.setProperty('--text-dim', 'color-mix(in srgb, ' + hex + ' 52%, var(--bg))');
  }

  function applyBackground() {
    const pr = state.prefs;
    const has = !!pr.bgImage;
    document.body.classList.toggle('has-bg', has);
    const layer = el.bgLayer || document.getElementById('bgLayer');
    if (!layer) return;
    if (has) {
      layer.style.backgroundImage = 'url("' + pathToUrl(pr.bgImage) + '")';
      layer.style.backgroundSize = pr.bgSize || 'cover';
      layer.style.backgroundRepeat = pr.bgRepeat ? 'repeat' : 'no-repeat';
      layer.style.filter = 'blur(' + (pr.bgBlur || 0) + 'px)';
      document.documentElement.style.setProperty('--bg-opacity', String((pr.bgOpacity || 0) / 100));
      document.documentElement.style.setProperty('--bg-dim', String((pr.bgDim || 0) / 100));
    } else {
      layer.style.backgroundImage = 'none';
      document.documentElement.style.setProperty('--bg-opacity', '0');
    }
    const thumb = $('bgThumb');
    if (thumb) {
      thumb.classList.toggle('has', has);
      thumb.style.backgroundImage = has ? 'url("' + pathToUrl(pr.bgImage) + '")' : '';
      thumb.textContent = has ? '' : '未设置';
    }
  }

  function syncSettingsUI() {
    const pr = state.prefs;
    document.querySelectorAll('#setTheme button').forEach(b => b.classList.toggle('active', b.dataset.v === pr.theme));
    document.querySelectorAll('#setFont button').forEach(b => b.classList.toggle('active', b.dataset.v === pr.font));
    $('setSize').value = pr.size; $('valSize').textContent = pr.size + 'px';
    $('setWidth').value = pr.width; $('valWidth').textContent = pr.width + 'px';
    $('setLh').value = pr.lh; $('valLh').textContent = (+pr.lh).toFixed(2);
    $('setSoftBreak').checked = !!pr.softBreak;
    $('setLineNo').checked = !!pr.lineNo;
    $('setAutoSave').checked = !!pr.autoSave;
    $('setSync').checked = !!pr.sync;
    const ms = Number(pr.autoSaveMs) || 5000;
    $('setAutoSaveSec').value = Math.round(ms / 1000);
    $('setPanelBlur').checked = !!pr.panelBlur;
    const hex = normalizeHex(pr.textColor) || '';
    $('setTextColorHex').value = hex;
    $('setTextColor').value = hex || (pr.theme === 'dark' || pr.theme === 'night' ? '#d8d8dc' : '#24292f');
    $('setBgOpacity').value = pr.bgOpacity;
    $('valBgOpacity').textContent = pr.bgOpacity + '%';
    $('setBgBlur').value = pr.bgBlur;
    $('valBgBlur').textContent = pr.bgBlur + ' px';
    $('setBgDim').value = pr.bgDim;
    $('valBgDim').textContent = pr.bgDim + '%';
    $('setBgRepeat').checked = !!pr.bgRepeat;
    $('setFsBorderless').checked = pr.fullscreenBorderless !== false;
    $('setPanelAlpha').value = pr.panelAlpha == null ? 45 : pr.panelAlpha;
    $('valPanelAlpha').textContent = (pr.panelAlpha == null ? 45 : pr.panelAlpha) + '%';
    document.querySelectorAll('#setBgSize button').forEach(b => b.classList.toggle('active', b.dataset.v === pr.bgSize));
  }

  /* ---------------- 文档 / 标签页 ---------------- */
  let tabSeq = 0;

  function openFileData(m) {
    openContent(m.name || baseName(m.path), m.content || '', m.path);
  }

  function activeTab() { return state.tabs[state.active] || null; }

  function applyTab(t) {
    state.path = t.path;
    state.name = t.name;
    state.content = t.content;
    state.lastSavedText = t.lastSavedText;
    state.dirty = t.dirty;
    state.savedAt = t.savedAt;
    el.editor.value = t.content;
    el.editor.setSelectionRange(0, 0);
    showWelcome(false);
    updateDocChrome();
    renderAll();
    if (wy) wy.load(t.content);
    setStatus(t.dirty ? 'editing' : (t.path ? 'saved' : 'new'));
    refreshGutter();
    requestAnimationFrame(() => {
      if (wy) el.wyPane.scrollTop = t.scroll ? t.scroll.wy : 0;
      el.editor.scrollTop = t.scroll ? t.scroll.src : 0;
      el.previewPane.scrollTop = t.scroll ? t.scroll.pv : 0;
      syncScroll();
    });
  }

  function stashTab() {
    const t = activeTab();
    if (!t) return;
    t.path = state.path;
    t.name = state.name;
    t.content = state.content;
    t.dirty = state.dirty;
    t.savedAt = state.savedAt;
    t.scroll = {
      wy: el.wyPane.scrollTop,
      src: el.editor.scrollTop,
      pv: el.previewPane.scrollTop
    };
  }

  function syncActiveTab() {
    const t = activeTab();
    if (!t) return;
    t.content = state.content;
    t.dirty = state.dirty;
  }

  function activateTab(i) {
    if (i < 0 || i >= state.tabs.length || i === state.active) return;
    if (state.active >= 0) stashTab();
    state.active = i;
    applyTab(state.tabs[i]);
    renderTabs();
  }

  function newTab(name, content, path) {
    if (state.active >= 0) stashTab();
    const t = {
      id: ++tabSeq,
      path: path || null,
      name: name || '未命名',
      content: content || '',
      lastSavedText: content || '',
      savedAt: null,
      dirty: false,
      scroll: { wy: 0, src: 0, pv: 0 }
    };
    state.tabs.push(t);
    state.active = state.tabs.length - 1;
    applyTab(t);
    renderTabs();
    return t;
  }

  function openContent(name, content, path) {
    // 已经打开过同一个文件 → 切过去
    if (path) {
      const exist = state.tabs.findIndex(t => t.path && t.path.toLowerCase() === path.toLowerCase());
      if (exist >= 0) { activateTab(exist); return; }
    }
    const cur = activeTab();
    // 当前是个空白的未命中文档 → 直接复用
    if (cur && !cur.path && !cur.content.trim() && !cur.dirty) {
      cur.name = name || '未命名';
      cur.content = content || '';
      cur.lastSavedText = cur.content;
      cur.path = path || null;
      applyTab(cur);
      renderTabs();
      return;
    }
    newTab(name, content, path);
  }

  function closeTab(i, force) {
    const t = state.tabs[i];
    if (!t) return;
    if (!force && t.dirty && !t.path) {
      post({ cmd: 'confirm', id: 'close-tab', message: '「' + t.name + '」还没有保存，仍然关闭吗？' });
      state._confirmCb = ok => { if (ok) closeTab(i, true); };
      return;
    }
    if (t.dirty && t.path) {
      state._pendingSave = t.id;
      post({ cmd: 'save', path: t.path, content: t.content });
    }
    state.tabs.splice(i, 1);
    if (!state.tabs.length) {
      state.active = -1;
      newTab('未命名', '', null);
      return;
    }
    const next = Math.min(i, state.tabs.length - 1);
    state.active = -1;
    activateTab(next);
    renderTabs();
  }

function switchTab(dir) {
    const n = state.tabs.length;
    if (n < 2) return;
    activateTab((state.active + dir + n) % n);
  }

  function renderTabs() {
    if (!el.tabbar) return;
    const tabs = state.tabs;
    const sig = state.active + '|' + tabs.map(t => t.name + (t.dirty ? '*' : '')).join('|');
    if (sig === renderTabs._sig) return;
    renderTabs._sig = sig;
    let html = '';
    tabs.forEach((t, i) => {
      const dirty = t.dirty ? '<span class="tab-dot"></span>' : '';
      html += '<div class="tab' + (i === state.active ? ' active' : '') + '" data-i="' + i + '" title="' +
        escapeAttr(t.path || t.name) + '">' + dirty + '<span class="tab-name">' + escapeHtml(t.name) + '</span>' +
        '<button class="tab-close" data-close="' + i + '" title="关闭">✕</button></div>';
    });
    html += '<button class="tab-add" id="tabAdd" title="新建标签页 Ctrl+T">＋</button>';
    el.tabbar.innerHTML = html;
  }

  function updateDocChrome() {
    const dirty = state.dirty ? '<span class="dirty"> ●</span>' : '';
    el.docName.innerHTML = escapeHtml(state.name) + dirty;
    el.docPath.textContent = state.path || '尚未保存';
    el.docPath.title = state.path || '';
    document.title = state.name + ' — MarkEdit';
    post({ cmd: 'setTitle', title: state.name + (state.dirty ? ' •' : '') + ' — MarkEdit' });
    if (el.tabbar) renderTabs();
  }

  function setStatus(kind) {
    const map = {
      saved: ['已保存', 'saved', state.savedAt ? fmtTime(state.savedAt) : '刚刚'],
      editing: ['编辑中…', 'editing', state.savedAt ? fmtTime(state.savedAt) : '—'],
      new: ['新建', '', '未写入磁盘'],
      error: ['出错', '', '']
    };
    const v = map[kind] || map.new;
    el.stState.textContent = v[0];
    el.stState.className = 'sb-item ' + v[1];
    el.stSaved.textContent = kind === 'saved' ? v[2] : (state.savedAt ? '上次保存 ' + fmtTime(state.savedAt) : '未保存');
  }

  function fmtTime(d) {
    const p = n => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------------- 渲染 ---------------- */
  let renderTimer = null, hlTimer = null;

  function renderAll() {
    renderPreview();
    renderHighlight();
    renderOutline();
    refreshGutter();
    updateCounts();
    positionCaretInfo();
  }

  function renderPreview() {
    if (!el.preview) return;
    const html = window.MD.render(state.content, { softBreak: state.prefs.softBreak });
    el.preview.innerHTML = html || '<p class="ol-empty">空文档</p>';
    fixImages(el.preview);
  }

  /** 把相对图片路径按文档所在目录解析成 file:// 绝对路径 */
  function fixImages(root) {
    if (!root || !state.path) return;
    const dir = state.path.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
    const base = 'file:///' + encodeURI(dir) + '/';
    root.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (!src || /^(https?:|data:|file:|blob:)/i.test(src)) return;
      if (!img.getAttribute('data-src')) img.setAttribute('data-src', src);
      img.setAttribute('src', base + encodeURI(src.replace(/^\.\//, '')));
    });
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (state.view !== 'wysiwyg') renderPreview();
      renderOutline();
      updateCounts();
    }, 90);
    clearTimeout(hlTimer);
    hlTimer = setTimeout(renderHighlight, 40);
  }

  function renderHighlight() {
    if (state.content.length > 300000) { el.hl.textContent = ''; return; }
    el.hl.innerHTML = highlightMarkdown(state.content) + '\n ';
    syncScroll();
  }

  function highlightMarkdown(text) {
    const stash = [];
    const keep = html => { stash.push(html); return '\u0001' + (stash.length - 1) + '\u0001'; };
    let s = escapeHtml(text);

    // 行内代码
    s = s.replace(/(`+)([\s\S]*?)\1/g, (m, f, c) => keep('<span class="mk-code">' + f + c + f + '</span>'));

    // 逐行标记
    s = s.split('\n').map(line => {
      if (/^\s*(```|~~~)/.test(line)) return '<span class="mk-code">' + line + '</span>';
      let l = line.replace(/^(\s*)(#{1,6})(?=\s)/, (m, a, h) => a + '<span class="mk-h">' + h + '</span>');
      l = l.replace(/^(\s*)(&gt;\s?)/, (m, a, q) => a + '<span class="mk-quote">' + q + '</span>');
      l = l.replace(/^(\s*)([-*+]\s|\d{1,9}[.)]\s)/, (m, a, k) => a + '<span class="mk-list">' + k + '</span>');
      l = l.replace(/^(\s*)(---+|\*\*\*+|___+)\s*$/, (m, a, k) => a + '<span class="mk-dim">' + k + '</span>');
      return l;
    }).join('\n');

    // 链接与图片
    s = s.replace(/(!?\[)([^\]]*)(\]\()([^)\s]+)((?:\s+&quot;[^&]*&quot;)?\))/g,
      (m, a, t, b, url, c) => '<span class="mk-link">' + a + t + b + url + c + '</span>');

    // 强调
    s = s.replace(/(\*\*|__)([^*_\n]+)(\1)/g, '<span class="mk-bold">$1$2$3</span>');
    s = s.replace(/(?<![*\w])(\*)([^*\n]+)(\*)(?!\*)/g, '<span class="mk-em">$1$2$3</span>');

    return s.replace(/\u0001(\d+)\u0001/g, (m, n) => stash[+n] || '');
  }

  function refreshGutter() {
    if (!state.prefs.lineNo) return;
    const n = el.editor.value.split('\n').length;
    if (el.gutter.childElementCount !== n) {
      let html = '';
      for (let i = 1; i <= n; i++) html += '<div>' + i + '</div>';
      el.gutter.innerHTML = html;
    }
    syncScroll();
  }

  function syncScroll() {
    if (el.hl) {
      el.hl.scrollTop = el.editor.scrollTop;
      el.hl.scrollLeft = el.editor.scrollLeft;
    }
    el.gutter.scrollTop = el.editor.scrollTop;
  }

  function updateCounts() {
    const text = state.content;
    const cjk = (text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
    const words = (text.match(/[A-Za-z0-9_'-]+/g) || []).length;
    const total = cjk + words;
    el.stWords.textContent = total.toLocaleString() + ' 字';
    el.stChars.textContent = text.length.toLocaleString() + ' 字符';
    el.stRead.textContent = Math.max(1, Math.round(total / 300)) + ' 分钟';
  }

  function positionCaretInfo() {
    const pos = el.editor.selectionStart;
    const before = el.editor.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    el.stCursor.textContent = '行 ' + line + '，列 ' + col;
  }

  /* ---------------- 大纲 ---------------- */
  function renderOutline() {
    const items = window.MD.outline(state.content);
    if (!items.length) {
      el.outlineList.innerHTML = '<div class="ol-empty">还没有标题<br>用 # 试试</div>';
      return;
    }
    el.outlineList.innerHTML = items.map((it, i) =>
      '<div class="ol-item l' + it.level + '" data-line="' + it.line + '" data-id="' + it.id + '" title="' + escapeHtml(it.text) + '">' +
      '<span class="ol-idx">' + (i + 1) + '</span><span class="ol-text">' + escapeHtml(it.text) + '</span></div>'
    ).join('');
    markActiveOutline();
  }

  function markActiveOutline() {
    if (state.view === 'wysiwyg') { markOutlineAtLine(currentWysiwygLine() || 0); return; }
    markOutlineAtLine(currentTopLine());
  }

  function currentTopLine() {
    const lh = parseFloat(getComputedStyle(el.editor).lineHeight) || 24;
    return Math.max(0, Math.floor(el.editor.scrollTop / lh));
  }

  function markOutlineAtLine(line) {
    const nodes = [...el.outlineList.querySelectorAll('.ol-item')];
    if (!nodes.length) return;
    let active = null;
    for (const n of nodes) {
      if (+n.dataset.line <= line) active = n; else break;
    }
    nodes.forEach(n => n.classList.toggle('active', n === active));
  }

  function currentWysiwygLine() {
    if (!wy || !el.wyPane) return null;
    const top = el.wyPane.scrollTop + 90;
    const blocks = el.wyDoc.querySelectorAll('.blk');
    let line = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = wy.blocks[i];
      if (!b) continue;
      if (blocks[i].offsetTop > top) break;
      line = b.startLine;
    }
    return line;
  }

  function jumpToLine(line) {
    if (state.view === 'wysiwyg' && wy) {
      wy.focusLine(line);
      return;
    }
    const lines = el.editor.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
    el.editor.focus();
    el.editor.setSelectionRange(pos, pos);
    const lh = parseFloat(getComputedStyle(el.editor).lineHeight) || 24;
    el.editor.scrollTop = Math.max(0, line * lh - 80);
    syncScroll();
    if (state.view === 'preview' || state.view === 'split') scrollPreviewToLine(line);
  }

  function scrollPreviewToLine(line) {
    const nodes = [...el.preview.querySelectorAll('[data-src]')];
    let target = null;
    for (const n of nodes) {
      if (+n.dataset.src <= line) target = n; else break;
    }
    if (target && state.prefs.sync) {
      const top = target.offsetTop - el.preview.clientHeight * 0.18;
      el.preview.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  /* ---------------- 文件树 ---------------- */
  function renderTree() {
    if (!state.tree) {
      el.fileTree.innerHTML = '<div class="ft-empty">还没有打开文件夹<br>点右上角按钮选择</div>';
      return;
    }
    const build = node => {
      let html = '';
      (node.dirs || []).forEach(d => {
        html += '<div class="ft-node dir" data-path="' + escapeAttr(d.path) + '" data-dir="1">' +
          '<span class="caret">▾</span><span class="ico">📁</span><span class="ft-name">' + escapeHtml(d.name) + '</span></div>';
        html += '<div class="ft-children">' + build(d) + '</div>';
      });
      (node.files || []).forEach(f => {
        html += '<div class="ft-node file" data-path="' + escapeAttr(f.path) + '">' +
          '<span class="caret"></span><span class="ico">📄</span><span class="ft-name">' + escapeHtml(f.name) + '</span></div>';
      });
      return html;
    };
    el.fileTree.innerHTML = '<div class="ft-node dir root" data-path="' + escapeAttr(state.rootDir) + '" data-dir="1">' +
      '<span class="caret">▾</span><span class="ico">🗂</span><span class="ft-name">' + escapeHtml(baseName(state.rootDir)) + '</span></div>' +
      '<div class="ft-children">' + build(state.tree) + '</div>';
    markActiveFile();
  }

  function markActiveFile() {
    el.fileTree.querySelectorAll('.ft-node.file').forEach(n => {
      n.classList.toggle('active', state.path && n.dataset.path === state.path);
    });
  }

  /* ---------------- 最近文件 ---------------- */
  function renderRecent() {
    if (!state.recent.length) {
      el.recentList.innerHTML = '<div class="wr-empty">还没有打开过文件</div>';
      return;
    }
    el.recentList.innerHTML = state.recent.slice(0, 6).map(r =>
      '<div class="wr-item" data-path="' + escapeAttr(r.path) + '">' +
      '<span class="wr-name">' + escapeHtml(r.name) + '</span>' +
      '<span class="wr-dir">' + escapeHtml(r.dir || '') + '</span></div>'
    ).join('');
  }

  /* ---------------- 编辑命令 ---------------- */
  function withEditor(fn) {
    el.editor.focus();
    const s = el.editor.selectionStart, e = el.editor.selectionEnd;
    const before = el.editor.value;
    const out = fn(before, s, e);
    if (out == null) return;
    const [text, selStart, selEnd] = out;
    if (text !== before) {
      el.editor.value = text;
      state.content = text;
      onChanged();
    }
    el.editor.setSelectionRange(selStart, selEnd == null ? selStart : selEnd);
    positionCaretInfo();
  }

  function wrap(before, after, placeholder) {
    withEditor((text, s, e) => {
      const sel = text.slice(s, e) || placeholder || '';
      const out = text.slice(0, s) + before + sel + after + text.slice(e);
      return [out, s + before.length, s + before.length + sel.length];
    });
  }

  function prefixLines(prefix, toggle) {
    withEditor((text, s, e) => {
      let start = text.lastIndexOf('\n', s - 1) + 1;
      let end = text.indexOf('\n', e);
      if (end === -1) end = text.length;
      const block = text.slice(start, end);
      const lines = block.split('\n');
      const all = lines.every(l => l.startsWith(prefix));
      const next = lines.map(l => {
        if (toggle && all) return l.startsWith(prefix) ? l.slice(prefix.length) : l;
        if (l.startsWith(prefix)) return l;
        return prefix + l;
      }).join('\n');
      const out = text.slice(0, start) + next + text.slice(end);
      return [out, start, start + next.length];
    });
  }

  function insertBlock(str) {
    withEditor((text, s, e) => {
      const lineStart = text.lastIndexOf('\n', s - 1) + 1;
      const needsNL = lineStart === s && s !== 0 ? '' : '\n';
      const out = text.slice(0, s) + needsNL + str + text.slice(e);
      const caret = s + needsNL.length + str.length;
      return [out, caret, caret];
    });
  }

  function cmd(name) {
    if (state.view === 'wysiwyg' && wy) {
      if (name === 'find') return toggleFind(true);
      return wy.cmd(name);
    }
    switch (name) {
      case 'bold': return wrap('**', '**', '加粗文本');
      case 'italic': return wrap('*', '*', '斜体文本');
      case 'strike': return wrap('~~', '~~', '删除线');
      case 'code': return wrap('`', '`', 'code');
      case 'mark': return wrap('==', '==', '高亮');
      case 'h1': return prefixLines('# ', true);
      case 'h2': return prefixLines('## ', true);
      case 'h3': return prefixLines('### ', true);
      case 'quote': return prefixLines('> ', true);
      case 'ul': return prefixLines('- ', true);
      case 'ol': return prefixLines('1. ', true);
      case 'task': return prefixLines('- [ ] ', true);
      case 'hr': return insertBlock('\n---\n');
      case 'table': return insertBlock('\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n');
      case 'link': return wrap('[', '](https://)', '链接文字');
      case 'image': return wrap('![', '](assets/)', '图片描述');
      case 'find': return toggleFind(true);
    }
  }

  /* ---------------- 变更处理 ---------------- */
  function onChanged() {
    state.content = el.editor.value;
    state.dirty = state.content !== state.lastSavedText;
    syncActiveTab();
    updateDocChrome();
    setStatus('editing');
    scheduleRender();
    refreshGutter();
    scheduleAutosave();
    if (state.composing) renderHighlight();
  }

  let autosaveTimer = null;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    if (!state.prefs.autoSave) return;
    const wait = Math.max(400, Number(state.prefs.autoSaveMs) || 1400);
    autosaveTimer = setTimeout(doSave, wait);
  }

  function doSave(silentAuto) {
    if (!state.path) {
      if (silentAuto) {
        try { localStorage.setItem('markedit.draft', JSON.stringify({ name: state.name, content: state.content, at: Date.now() })); } catch (e) { }
        return;
      }
      const t0 = activeTab();
      if (t0) { t0.content = state.content; state._pendingSave = t0.id; }
      post({ cmd: 'saveAs', content: state.content, defaultName: state.name === '未命名' ? '未命名.md' : state.name });
      return;
    }
    const t = activeTab();
    if (t) { t.content = state.content; state._pendingSave = t.id; }
    post({ cmd: 'save', path: state.path, content: state.content });
  }

  /* ---------------- 即时渲染里的格式化 ---------------- */
  function wyCmd(name) {
    if (!wy) return;
    switch (name) {
      case 'bold': return wy.wrapSelection('**', '**');
      case 'italic': return wy.wrapSelection('*', '*');
      case 'strike': return wy.wrapSelection('~~', '~~');
      case 'code': return wy.wrapSelection('`', '`');
      case 'mark': return wy.wrapSelection('==', '==');
      case 'h1': return wy.togglePrefix('# ');
      case 'h2': return wy.togglePrefix('## ');
      case 'h3': return wy.togglePrefix('### ');
      case 'quote': return wy.togglePrefix('> ');
      case 'ul': return wy.togglePrefix('- ');
      case 'ol': return wy.togglePrefix('1. ');
      case 'task': return wy.togglePrefix('- [ ] ');
      case 'hr': return wy.insertSnippet('\n---\n');
      case 'table': return wy.insertSnippet('\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n');
      case 'link': return wy.wrapSelection('[', '](https://)');
      case 'image': return wy.wrapSelection('![', '](assets/)');
    }
  }

  /* ---------------- 状态栏 / 视图 ---------------- */
  function setView(v, silent) {
    if (!v) v = 'wysiwyg';
    if (v !== 'wysiwyg' && wy && state.view === 'wysiwyg') wy.flush();
    state.view = v;
    if (!silent) { state.prefs.view = v; savePrefs(); }
    document.body.dataset.view = v;
    document.querySelectorAll('#viewSwitch button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    if (v !== 'split') el.splitter.style.display = 'none';
    else el.splitter.style.display = '';
    if (v === 'wysiwyg') {
      syncWysiwyg();
    } else {
      el.editor.value = state.content;
      renderAll();
    }
    requestAnimationFrame(() => { syncScroll(); });
  }

  function toggleSidebar(force) {
    const collapse = force === undefined ? !el.sidebar.classList.contains('collapsed') : force;
    el.sidebar.classList.toggle('collapsed', collapse);
  }

  /* ---------------- 查找替换 ---------------- */
  function toggleFind(show) {
    const on = show === undefined ? !el.findbar.classList.contains('show') : show;
    if (on && state.view === 'wysiwyg') {
      setView('source');
      toast('查找在源码视图中进行');
    }
    el.findbar.classList.toggle('show', on);
    if (on) {
      el.findInput.focus();
      el.findInput.select();
      runFind(true);
    } else {
      el.editor.focus();
      el.findbar.classList.remove('show');
    }
  }

  function runFind(keepIndex, dir) {
    const q = el.findInput.value;
    if (!q) { state.find = { matches: [], index: -1, query: '' }; el.findCount.textContent = '0/0'; return; }
    const text = el.editor.value;
    const hay = text.toLowerCase(), needle = q.toLowerCase();
    const matches = [];
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { matches.push([i, i + q.length]); i += Math.max(1, needle.length); }
    state.find.matches = matches;
    state.find.query = q;
    if (!matches.length) { el.findCount.textContent = '0/0'; return; }
    let idx = state.find.index;
    if (!keepIndex || idx < 0 || idx >= matches.length) {
      const caret = el.editor.selectionStart;
      idx = matches.findIndex(m => m[0] >= caret);
      if (idx < 0) idx = 0;
    }
    if (dir === 1) idx = (idx + 1) % matches.length;
    if (dir === -1) idx = (idx - 1 + matches.length) % matches.length;
    state.find.index = idx;
    const [s, e] = matches[idx];
    el.editor.focus();
    el.editor.setSelectionRange(s, e);
    el.findCount.textContent = (idx + 1) + '/' + matches.length;
  }

  function replaceOne() {
    const m = state.find.matches[state.find.index];
    if (!m) return;
    const rep = el.replaceInput.value;
    const text = el.editor.value;
    el.editor.setRangeText(rep, m[0], m[1], 'end');
    state.content = el.editor.value;
    onChanged();
    runFind(false);
  }

  function replaceAll() {
    const q = el.findInput.value, rep = el.replaceInput.value;
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const text = el.editor.value.replace(re, rep);
    el.editor.value = text;
    state.content = text;
    onChanged();
    runFind(false);
    toast('已全部替换');
  }

  /* ---------------- 图片 ---------------- */
  function insertImagePath(rel, abs) {
    if (state.view === 'wysiwyg' && wy) {
      const src = abs ? 'file:///' + String(abs).replace(/\\/g, '/') : rel;
      document.execCommand('insertHTML', false,
        '<img src="' + src + '" data-src="' + rel + '" alt="">');
      wy.syncCurrent();
      wy.afterMediaInsert();
      return;
    }
    const snippet = '![](' + rel + ')';
    withEditor((text, s) => [text.slice(0, s) + snippet + text.slice(s), s + snippet.length]);
  }

  async function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      post({ cmd: 'saveImage', dataUrl: reader.result, docPath: state.path || '' });
      if (!host) { withEditor((t, s) => [t.slice(0, s) + '![' + file.name + '](assets/' + file.name + ')' + t.slice(s), s]); }
    };
    reader.readAsDataURL(file);
  }

  /* ---------------- 打印 / 导出 ---------------- */
  function ensurePrintRoot() {
    if (!el.printRoot) {
      el.printRoot = document.createElement('article');
      el.printRoot.id = 'printRoot';
      el.printRoot.className = 'preview';
      document.body.appendChild(el.printRoot);
    }
  }

  function startPrint() {
    ensurePrintRoot();
    el.printRoot.innerHTML = window.MD.render(state.content, { softBreak: state.prefs.softBreak });
    el.printRoot.querySelectorAll('.code-copy').forEach(n => n.remove());
    fixImages(el.printRoot);
  }

  function endPrint() {
    if (el.printRoot) el.printRoot.innerHTML = '';
  }

  function exportPdf() {
    startPrint();
    post({ cmd: 'printPdf', defaultName: (state.name.replace(/\.[^.]+$/, '') || '未命名') + '.pdf' });
  }

  function exportWord() {
    if (!window.ExportModel) { toast('导出模块未加载'); return; }
    const model = window.ExportModel.build(state.content);
    const nm = (state.name.replace(/\.[^.]+$/, '') || '未命名') + '.docx';
    post({ cmd: 'exportWord', model: JSON.stringify(model), defaultName: nm, docPath: state.path || '' });
  }

  function exportHtml() {
    const body = window.MD.render(state.content, { softBreak: state.prefs.softBreak });
    const css = [...document.styleSheets]
      .filter(s => s.href && s.href.endsWith('app.css'))
      .map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch (e) { return ''; } })
      .join('\n');
    const doc = '<!DOCTYPE html><html lang="zh-CN" data-theme="' + state.prefs.theme + '"><head><meta charset="utf-8">' +
      '<title>' + escapeHtml(state.name) + '</title><style>' + css +
      '\nbody{background:var(--bg);margin:0}.preview{max-width:820px;margin:0 auto;padding:60px 24px}</style></head>' +
      '<body><article class="preview">' + body + '</article></body></html>';
    post({ cmd: 'exportHtml', html: doc, defaultName: (state.name.replace(/\.[^.]+$/, '') || '未命名') + '.html' });
  }

  /* ---------------- 设置 ---------------- */
function openHelp(show) {
    const on = show === undefined ? !el.help.classList.contains('show') : show;
    el.help.classList.toggle('show', on);
  }

  function openSettings(show) {
    el.settings.classList.toggle('show', show === undefined ? !el.settings.classList.contains('show') : show);
  }

  function bindPrefInput(id, key, transform) {
    const n = $(id);
    n.addEventListener('input', () => {
      state.prefs[key] = transform ? transform(n.value) : n.value;
      applyPrefs(state.prefs);
      savePrefs();
    });
  }

  /* ---------------- 工具 ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  let toastTimer = null;
  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms || 1600);
  }

  function showContextMenu(x, y, items) {
    const row = (it, i) => {
      if (it === '-') return '<div class="sep"></div>';
      const sub = it.sub
        ? '<div class="ctxsub">' + it.sub.map((s, j) =>
            s === '-' ? '<div class="sep"></div>' :
              '<button data-sub="' + i + ':' + j + '">' + s.label +
              (s.key ? '<kbd>' + s.key + '</kbd>' : '') + '</button>').join('') + '</div>'
        : '';
      return '<div class="ctxitem' + (it.sub ? ' has-sub' : '') + '">' +
        '<button data-i="' + i + '">' + it.label +
        (it.key ? '<kbd>' + it.key + '</kbd>' : '') +
        (it.sub ? '<span class="arrow">›</span>' : '') + '</button>' + sub + '</div>';
    };
    el.ctxmenu.innerHTML = items.map(row).join('');
    el.ctxmenu.style.left = Math.min(x, innerWidth - 200) + 'px';
    el.ctxmenu.style.top = Math.min(y, innerHeight - 40 - items.length * 30) + 'px';
    el.ctxmenu.classList.add('show');

    // 子菜单：过长时上移，避免超出窗口
    el.ctxmenu.addEventListener('mouseover', ev => {
      const item = ev.target.closest('.ctxitem.has-sub');
      if (!item) return;
      const sub = item.querySelector('.ctxsub');
      if (!sub) return;
      sub.style.top = '-6px';
      const r = sub.getBoundingClientRect();
      const over = r.bottom - (innerHeight - 10);
      if (over > 0) sub.style.top = (-6 - over) + 'px';
    });

    // 靠近右边时子菜单往左展开
    const flip = el.ctxmenu.getBoundingClientRect().right > innerWidth - 180;
    el.ctxmenu.querySelectorAll('.ctxsub').forEach(s => s.classList.toggle('flip', flip));

    el.ctxmenu.onclick = ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      let it = null;
      if (b.dataset.sub) {
        const [i, j] = b.dataset.sub.split(':').map(Number);
        it = items[i] && items[i].sub ? items[i].sub[j] : null;
      } else if (b.dataset.i) {
        it = items[+b.dataset.i];
      }
      if (it && it.action) it.action();
      el.ctxmenu.classList.remove('show');
    };
  }
  document.addEventListener('mousedown', ev => {
    if (!el.ctxmenu.contains(ev.target)) el.ctxmenu.classList.remove('show');
  });

  /* ---------------- 设置面板：拖动 ---------------- */
  function bindModalDrag() {
    const card = document.querySelector('#settingsModal .modal-card');
    const head = card && card.querySelector('.modal-head');
    if (!card || !head) return;
    let dragging = false, ox = 0, oy = 0;

    head.addEventListener('mousedown', ev => {
      if (ev.target.closest('button')) return;
      ev.preventDefault();
      const r = card.getBoundingClientRect();
      card.classList.add('dragged');
      card.style.left = r.left + 'px';
      card.style.top = r.top + 'px';
      card.style.margin = '0';
      dragging = true;
      ox = ev.clientX - r.left;
      oy = ev.clientY - r.top;
      head.classList.add('dragging');
    });

    window.addEventListener('mousemove', ev => {
      if (!dragging) return;
      const w = card.offsetWidth, h = card.offsetHeight;
      const x = Math.min(Math.max(6, ev.clientX - ox), innerWidth - w - 6);
      const y = Math.min(Math.max(6, ev.clientY - oy), innerHeight - h - 6);
      card.style.left = x + 'px';
      card.style.top = y + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      head.classList.remove('dragging');
    });

    // 双击标题回到居中
    head.addEventListener('dblclick', () => {
      card.classList.remove('dragged');
      card.style.left = '';
      card.style.top = '';
    });
  }
  /* ---------------- 插入表格对话框 ---------------- */
  function openTableDialog() {
    const m = $('tableModal');
    $('tblCols').value = 3;
    $('tblRows').value = 4;
    m.classList.add('show');
    setTimeout(() => { $('tblCols').focus(); $('tblCols').select(); }, 30);
  }
  function closeTableDialog() { $('tableModal').classList.remove('show'); }
  function confirmTableDialog() {
    const cols = Math.max(1, Math.min(12, parseInt($('tblCols').value, 10) || 3));
    const rows = Math.max(1, Math.min(50, parseInt($('tblRows').value, 10) || 4));
    closeTableDialog();
    if (state.view === 'wysiwyg' && wy) wy.cmd('table', { rows: rows, cols: cols });
    else cmd('table');
  }
  function bindTableDialog() {
    $('tblCancel').addEventListener('click', closeTableDialog);
    $('tblOk').addEventListener('click', confirmTableDialog);
    $('tableModal').addEventListener('mousedown', ev => { if (ev.target === $('tableModal')) closeTableDialog(); });
    $('tableModal').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); confirmTableDialog(); }
      if (ev.key === 'Escape') { ev.preventDefault(); closeTableDialog(); }
    });
  }
  /* ---------------- 关闭确认 ---------------- */
  function askClose() {
    if (state.view === 'wysiwyg' && wy) wy.flush();
    const dirty = state.tabs.filter(t => t.dirty);
    if (!dirty.length) { post({ cmd: 'closeNow' }); return; }

    if (dirty.length === 1) {
      $('closeText').textContent = '「' + (dirty[0].name || '未命名') + '」还有未保存的修改。';
      $('closeHint').textContent = '';
    } else {
      $('closeText').textContent = '有 ' + dirty.length + ' 个文档还没保存。';
      $('closeHint').textContent = '「保存并关闭」会保存当前文档：' + (activeTab() ? activeTab().name : '');
    }
    el.closeModal.classList.add('show');
    $('closeSave').focus();
  }

  function closeModal(show) {
    el.closeModal.classList.toggle('show', !!show);
  }

  function bindCloseModal() {
    $('closeCancel').addEventListener('click', () => closeModal(false));
    $('closeDiscard').addEventListener('click', () => { closeModal(false); post({ cmd: 'closeNow' }); });
    $('closeSave').addEventListener('click', () => {
      if (state.view === 'wysiwyg' && wy) wy.flush();
      closeModal(false);
      post({ cmd: 'closeSave', content: state.content });
    });
    el.closeModal.addEventListener('mousedown', ev => { if (ev.target === el.closeModal) closeModal(false); });
    document.addEventListener('keydown', ev => {
      if (!el.closeModal.classList.contains('show')) return;
      if (ev.key === 'Escape') { closeModal(false); ev.stopPropagation(); }
      if (ev.key === 'Enter') { $('closeSave').click(); ev.stopPropagation(); }
    }, true);
  }
  /* ---------------- 统一命令入口（菜单 / 快捷键） ---------------- */
  let typewriterOn = false;

  function showSide(tab) {
    const btn = document.querySelector('.side-tab[data-tab="' + tab + '"]');
    if (btn) btn.click();
    el.sidebar.classList.remove('collapsed');
  }

  function toggleTypewriter() {
    typewriterOn = !typewriterOn;
    toast(typewriterOn ? '打字机模式：开' : '打字机模式：关');
  }

  function doAction(name) {
    if (!name) return;
    if (name.indexOf('view-') === 0) return setView(name.slice(5));
    if (name.indexOf('theme-') === 0) {
      state.prefs.theme = name.slice(6);
      applyPrefs(state.prefs);
      savePrefs();
      return;
    }

    const editorCmds = ['bold', 'italic', 'strike', 'mark', 'code', 'link', 'image', 'clear',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'headingUp', 'headingDown', 'quote', 'ul', 'ol',
      'task', 'codeblock', 'math', 'hr', 'indent', 'outdent',
      'toc', 'frontmatter', 'footnote', 'linkref', 'paraAbove', 'paraBelow'];
    if (name === 'table') { return (state.view === 'wysiwyg' && wy) ? openTableDialog() : cmd('table'); }

    if (editorCmds.indexOf(name) >= 0) {
      if (state.view === 'wysiwyg' && wy) return wy.cmd(name);
      return cmd(name);
    }

    switch (name) {
      case 'new': return newDoc();
      case 'newFile': return post({ cmd: 'newFile' });
      case 'open': return post({ cmd: 'open' });
      case 'openFolder': return post({ cmd: 'openFolder' });
      case 'save': return doSave();
      case 'saveAs': return post({ cmd: 'saveAs', content: state.content, defaultName: state.name });
      case 'exportWord': return exportWord();
      case 'exportHtml': return exportHtml();
      case 'exportPdf': return exportPdf();
      case 'print': return window.print();
      case 'reveal': return post({ cmd: 'reveal', path: state.path || '' });
      case 'registerAssoc': return post({ cmd: 'registerAssoc' });
      case 'setDefaultAssoc': return post({ cmd: 'setDefaultAssoc' });
      case 'closeTab': return closeTab(state.active);
      case 'undo': return (state.view === 'wysiwyg' && wy) ? wy.undo() : document.execCommand('undo');
      case 'redo': return (state.view === 'wysiwyg' && wy) ? wy.redo() : document.execCommand('redo');
      case 'cut': return document.execCommand('cut');
      case 'copy': return document.execCommand('copy');
      case 'paste': return navigator.clipboard.readText().then(t => insertPlain(t)).catch(() => { });
      case 'pastePlain': return navigator.clipboard.readText().then(t => insertPlain(t)).catch(() => { });
      case 'copyMd': return navigator.clipboard.writeText(state.content).then(() => toast('已复制 Markdown'));
      case 'selectAll': return document.execCommand('selectAll');
      case 'find': return toggleFind(true);
      case 'replace': toggleFind(true); el.replaceInput.focus(); return;
      case 'sidebar': return toggleSidebar();
      case 'outline': return showSide('outline');
      case 'files': return showSide('files');
      case 'zoomIn': return zoom(1);
      case 'zoomOut': return zoom(-1);
      case 'zoomReset': return zoom(0);
      case 'fullscreen': return post({ cmd: 'toggleFullscreen', borderless: !!state.prefs.fullscreenBorderless });
      case 'focusMode': document.body.classList.toggle('focus-mode'); return;
      case 'typewriter': return toggleTypewriter();
      case 'settings': return openSettings(true);
      case 'help': return openHelp(true);
      case 'about': return toast('MarkEdit 1.6 · 本地 Markdown 编辑器');
    }
  }

  function insertPlain(text) {
    if (!text) return;
    if (state.view === 'wysiwyg' && wy) { document.execCommand('insertText', false, text); wy.syncCurrent(); return; }
    withEditor((t, s) => [t.slice(0, s) + text + t.slice(s), s + text.length]);
  }

  /* 打字机模式：光标所在行保持居中 */
  document.addEventListener('selectionchange', () => {
    if (!typewriterOn || state.view !== 'wysiwyg') return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let node = sel.focusNode;
    if (node && node.nodeType === 3) node = node.parentNode;
    const blk = node && node.closest ? node.closest('.blk') : null;
    if (!blk || !el.wyPane) return;
    const r = blk.getBoundingClientRect();
    const pr = el.wyPane.getBoundingClientRect();
    const target = el.wyPane.scrollTop + (r.top - pr.top) - pr.height / 2 + r.height / 2;
    el.wyPane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  });
  /* ---------------- 事件绑定 ---------------- */
  function bindUI() {
    setView(state.prefs.view || 'wysiwyg', true);

    el.editor.addEventListener('input', onChanged);
    el.editor.addEventListener('scroll', () => { syncScroll(); schedulePreviewSync(); markActiveOutline(); });
    el.editor.addEventListener('click', positionCaretInfo);
    el.editor.addEventListener('keyup', positionCaretInfo);
    el.editor.addEventListener('select', positionCaretInfo);
    el.editor.addEventListener('compositionstart', () => { state.composing = true; el.editor.classList.add('ime'); });
    el.editor.addEventListener('compositionupdate', () => { state.content = el.editor.value; renderHighlight(); });
    el.editor.addEventListener('compositionend', () => {
      state.composing = false;
      el.editor.classList.remove('ime');
      onChanged();
    });

    // 粘贴图片
    el.editor.addEventListener('paste', ev => {
      const items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          ev.preventDefault();
          const file = it.getAsFile();
          if (file) handleImageFile(file);
          return;
        }
      }
    });

    // 拖放
    ['dragover', 'drop'].forEach(t => document.addEventListener(t, ev => {
      ev.preventDefault();
      if (t !== 'drop') return;
      const files = ev.dataTransfer && ev.dataTransfer.files;
      if (!files || !files.length) return;
      for (const f of files) {
        if (/^image\//.test(f.type)) handleImageFile(f);
        else if (/\.(md|markdown|txt|mkd)$/i.test(f.name)) {
          const r = new FileReader();
          r.onload = () => openContent(f.name, String(r.result), null);
          r.readAsText(f, 'utf-8');
        }
      }
    }));

    // 标签栏
    if (el.tabbar) {
      el.tabbar.addEventListener('click', ev => {
        const close = ev.target.closest('.tab-close');
        if (close) { ev.stopPropagation(); closeTab(+close.dataset.close); return; }
        if (ev.target.closest('#tabAdd')) { newDoc(); return; }
        const tab = ev.target.closest('.tab');
        if (tab) activateTab(+tab.dataset.i);
      });
      el.tabbar.addEventListener('auxclick', ev => {
        const tab = ev.target.closest('.tab');
        if (tab && ev.button === 1) { ev.preventDefault(); closeTab(+tab.dataset.i); }
      });
    }

    // 键盘（Typora 键位）
    document.addEventListener('keydown', ev => {
      if (ev.defaultPrevented) return;
      const mod = ev.ctrlKey || ev.metaKey;
      const key = ev.key;
      const k = key.toLowerCase();

      if (key === 'Escape') {
        if (window.Menus) window.Menus.close();
        if (state.fullscreen) { post({ cmd: 'toggleFullscreen', borderless: false }); state.fullscreen = false; return; }
        if (el.help.classList.contains('show')) return openHelp(false);
        if (el.settings.classList.contains('show')) return openSettings(false);
        if (el.findbar.classList.contains('show')) return toggleFind(false);
        return;
      }

      if (!mod) {
        if (key === 'F1') { ev.preventDefault(); return doAction('help'); }
        if (key === 'F11') { ev.preventDefault(); return doAction('fullscreen'); }
        if (key === 'F8') { ev.preventDefault(); return doAction('focusMode'); }
        if (key === 'F9') { ev.preventDefault(); return doAction('typewriter'); }
        return;
      }

      const shift = ev.shiftKey;
      // Ctrl+Shift 系列
      if (shift) {
        if (k === 's') { ev.preventDefault(); return doAction('saveAs'); }
        if (k === 'v') { ev.preventDefault(); return doAction('pastePlain'); }
        if (k === 'c') { ev.preventDefault(); return doAction('copyMd'); }
        if (k === 'm') { ev.preventDefault(); return doAction('math'); }
        if (k === 'k') { ev.preventDefault(); return doAction('codeblock'); }
        if (k === 'q') { ev.preventDefault(); return doAction('quote'); }
        if (k === 'x') { ev.preventDefault(); return doAction('task'); }
        if (k === '[' || k === '{') { ev.preventDefault(); return doAction('ol'); }
        if (k === ']' || k === '}') { ev.preventDefault(); return doAction('ul'); }
        if (k === '`' || k === '~') { ev.preventDefault(); return doAction('code'); }
        if (k === 'l') { ev.preventDefault(); return doAction('sidebar'); }
        if (k === '1') { ev.preventDefault(); return doAction('outline'); }
        if (k === '2') { ev.preventDefault(); return doAction('files'); }
        if (k === '=') { ev.preventDefault(); return doAction('zoomIn'); }
        if (k === '-') { ev.preventDefault(); return doAction('zoomOut'); }
        if (k === '9') { ev.preventDefault(); return doAction('zoomReset'); }
        return;
      }

      // Ctrl 系列
      if (k === 's') { ev.preventDefault(); return doAction('save'); }
      if (k === 'o') { ev.preventDefault(); return doAction('open'); }
      if (k === 'n') { ev.preventDefault(); return doAction(ev.altKey ? 'newFile' : 'new'); }
      if (k === 'w') { ev.preventDefault(); return doAction('closeTab'); }
      if (k === 'p') { ev.preventDefault(); return doAction('print'); }
      if (k === 'tab') { ev.preventDefault(); return switchTab(ev.shiftKey ? -1 : 1); }
      if (k === 'f') { ev.preventDefault(); return doAction('find'); }
      if (k === 'h') { ev.preventDefault(); return doAction('replace'); }
      if (k === 'b') { ev.preventDefault(); return doAction('bold'); }
      if (k === 'i') { ev.preventDefault(); return doAction('italic'); }
      if (k === 'u') { ev.preventDefault(); return; }
      if (k === 'k') { ev.preventDefault(); return doAction('link'); }
      if (k === '/') { ev.preventDefault(); return doAction('view-source'); }
      if (k === '\\') { ev.preventDefault(); return doAction('clear'); }
      if (k === 'y') { ev.preventDefault(); return doAction('redo'); }
      if (k === '=' || k === '+') { ev.preventDefault(); return doAction('headingUp'); }
      if (k === '-') { ev.preventDefault(); return doAction('headingDown'); }
      if (key >= '0' && key <= '6') {
        ev.preventDefault();
        return doAction(key === '0' ? 'p' : 'h' + key);
      }
    });

    // 顶栏
    document.querySelectorAll('#viewSwitch button').forEach(b =>
      b.addEventListener('click', () => setView(b.dataset.view)));
    $('btnSidebar').addEventListener('click', () => toggleSidebar());

    // 侧栏拖拽调宽
    (function bindSideResize() {
      const handle = $('sideResizer');
      if (!handle) return;
      let dragging = false, startX = 0, startW = 0;
      handle.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (el.sidebar.classList.contains('collapsed')) return;
        dragging = true;
        startX = ev.clientX;
        startW = el.sidebar.getBoundingClientRect().width;
        handle.classList.add('dragging');
        document.body.classList.add('resizing-side');
      });
      window.addEventListener('mousemove', ev => {
        if (!dragging) return;
        const w = Math.round(Math.min(560, Math.max(180, startW + (ev.clientX - startX))));
        state.prefs.sidebarWidth = w;
        document.documentElement.style.setProperty('--sidebar-w', w + 'px');
      });
      window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-side');
        savePrefs();
      });
      handle.addEventListener('dblclick', () => {
        state.prefs.sidebarWidth = 262;
        document.documentElement.style.setProperty('--sidebar-w', '262px');
        savePrefs();
      });
    })();
    $('btnTheme').addEventListener('click', cycleTheme);
    $('btnSettings').addEventListener('click', () => openSettings());
    $('settingsClose').addEventListener('click', () => openSettings(false));
    $('btnHelp').addEventListener('click', () => openHelp());
    $('helpClose').addEventListener('click', () => openHelp(false));
    el.help.addEventListener('mousedown', ev => { if (ev.target === el.help) openHelp(false); });
    $('btnFullscreen').addEventListener('click', () => {
      post({ cmd: 'toggleFullscreen', borderless: !!state.prefs.fullscreenBorderless });
    });

    // 菜单栏
    if (window.Menus) window.Menus.build($('menus'), doAction);
    bindCloseModal();
    bindTableDialog();
    bindModalDrag();

    // 欢迎页
    $('wNew').addEventListener('click', newDoc);
    $('wOpen').addEventListener('click', () => post({ cmd: 'open' }));
    $('wFolder').addEventListener('click', () => post({ cmd: 'openFolder' }));
    el.recentList.addEventListener('click', ev => {
      const it = ev.target.closest('.wr-item');
      if (it) post({ cmd: 'openPath', path: it.dataset.path });
    });

    // 侧栏
    document.querySelectorAll('.side-tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.side-tab').forEach(x => x.classList.toggle('active', x === t));
      const tab = t.dataset.tab;
      el.outlineList.classList.toggle('hidden', tab !== 'outline');
      el.fileTree.classList.toggle('hidden', tab !== 'files');
      $('sideHint').textContent = tab === 'outline' ? 'Ctrl+点击标题可跳转' : '点击文件即可打开';
    }));
    $('btnFolder').addEventListener('click', () => post({ cmd: 'openFolder' }));

    el.outlineList.addEventListener('click', ev => {
      const it = ev.target.closest('.ol-item');
      if (it) jumpToLine(+it.dataset.line);
    });

    el.fileTree.addEventListener('click', ev => {
      const n = ev.target.closest('.ft-node');
      if (!n) return;
      if (n.dataset.dir) {
        const kids = n.nextElementSibling;
        if (kids && kids.classList.contains('ft-children')) {
          const hidden = kids.style.display === 'none';
          kids.style.display = hidden ? '' : 'none';
          n.querySelector('.caret').textContent = hidden ? '▾' : '▸';
        }
        return;
      }
      post({ cmd: 'openPath', path: n.dataset.path });
    });

    // 预览交互
    el.preview.addEventListener('click', ev => {
      const copy = ev.target.closest('.code-copy');
      if (copy) {
        const code = copy.closest('.code-block').querySelector('code');
        navigator.clipboard.writeText(code.innerText).then(() => {
          copy.textContent = '已复制';
          setTimeout(() => copy.textContent = '复制', 1200);
        });
        return;
      }
      const a = ev.target.closest('a');
      if (a) {
        ev.preventDefault();
        post({ cmd: 'openExternal', url: a.getAttribute('href') });
        return;
      }
      const cb = ev.target.closest('input[type=checkbox]');
      if (cb && cb.dataset.taskLine != null) {
        toggleTask(+cb.dataset.taskLine);
        return;
      }
      const h = ev.target.closest('[data-src]');
      if (h && ev.altKey) jumpToLine(+h.dataset.src);
    });

    // 滚轮同步
    el.preview.addEventListener('scroll', () => {
      if (!state.prefs.sync || state.view !== 'split' || previewScrolling) return;
      editorScrolling = true;
      const lh = parseFloat(getComputedStyle(el.editor).lineHeight) || 24;
      const ratio = el.preview.scrollTop / Math.max(1, el.preview.scrollHeight - el.preview.clientHeight);
      el.editor.scrollTop = ratio * Math.max(0, el.editor.scrollHeight - el.editor.clientHeight);
      syncScroll();
      requestAnimationFrame(() => { editorScrolling = false; });
    });

    // 分隔条拖拽
    let dragging = false;
    el.splitter.addEventListener('mousedown', ev => {
      ev.preventDefault(); dragging = true;
      el.splitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
    });
    window.addEventListener('mousemove', ev => {
      if (!dragging) return;
      const rect = el.panes.getBoundingClientRect();
      const left = Math.min(Math.max(240, ev.clientX - rect.left), rect.width - 240);
      el.sourcePane.style.flex = '0 0 ' + left + 'px';
      el.previewPane.style.flex = '1';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.splitter.classList.remove('dragging');
      document.body.style.cursor = '';
    });

    // 查找条
    el.findInput.addEventListener('input', () => runFind(false));
    el.findInput.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); runFind(true, ev.shiftKey ? -1 : 1); }
    });
    $('findNext').addEventListener('click', () => runFind(true, 1));
    $('findPrev').addEventListener('click', () => runFind(true, -1));
    $('findClose').addEventListener('click', () => toggleFind(false));
    $('replaceOne').addEventListener('click', replaceOne);
    $('replaceAll').addEventListener('click', replaceAll);

    // 设置
    document.querySelectorAll('#setTheme button').forEach(b => b.addEventListener('click', () => {
      state.prefs.theme = b.dataset.v; applyPrefs(state.prefs); savePrefs();
    }));
    document.querySelectorAll('#setFont button').forEach(b => b.addEventListener('click', () => {
      state.prefs.font = b.dataset.v; applyPrefs(state.prefs); savePrefs();
    }));
    bindPrefInput('setSize', 'size', Number);
    bindPrefInput('setWidth', 'width', Number);
    bindPrefInput('setLh', 'lh', Number);
    $('setSoftBreak').addEventListener('change', e => { state.prefs.softBreak = e.target.checked; savePrefs(); renderPreview(); });
    $('setLineNo').addEventListener('change', e => { state.prefs.lineNo = e.target.checked; savePrefs(); el.gutter.classList.toggle('hidden', !e.target.checked); refreshGutter(); });
    $('setAutoSave').addEventListener('change', e => { state.prefs.autoSave = e.target.checked; savePrefs(); });
    $('setAutoSaveSec').addEventListener('change', e => {
      let sec = Math.round(Number(e.target.value));
      if (!isFinite(sec)) sec = 5;
      sec = Math.max(1, Math.min(600, sec));
      e.target.value = sec;
      state.prefs.autoSaveMs = sec * 1000;
      savePrefs();
      toast('自动保存间隔 ' + sec + ' 秒');
    });
    $('setPanelBlur').addEventListener('change', e => {
      state.prefs.panelBlur = e.target.checked;
      document.documentElement.style.setProperty('--panel-blur', e.target.checked ? '10px' : '0px');
      savePrefs();
    });
    function commitTextColor(value) {
      const hex = normalizeHex(value);
      if (hex === null) { toast('颜色格式不对，示例：#3A6FF7'); return; }
      state.prefs.textColor = hex || '';
      applyTextColor(hex);
      syncSettingsUI();
      savePrefs();
    }
    $('setTextColor').addEventListener('input', e => commitTextColor(e.target.value));
    $('setTextColorHex').addEventListener('change', e => commitTextColor(e.target.value));
    $('textColorReset').addEventListener('click', () => {
      state.prefs.textColor = '';
      applyTextColor('');
      syncSettingsUI();
      savePrefs();
      toast('字体颜色跟随主题');
    });
    $('bgPick').addEventListener('click', () => post({ cmd: 'pickBackground' }));
    $('bgClear').addEventListener('click', () => {
      state.prefs.bgImage = '';
      applyBackground();
      savePrefs();
      toast('已清除背景');
    });
    $('setBgOpacity').addEventListener('input', e => {
      state.prefs.bgOpacity = +e.target.value;
      $('valBgOpacity').textContent = e.target.value + '%';
      applyBackground(); savePrefs();
    });
    $('setBgBlur').addEventListener('input', e => {
      state.prefs.bgBlur = +e.target.value;
      $('valBgBlur').textContent = e.target.value + ' px';
      applyBackground(); savePrefs();
    });
    $('setBgDim').addEventListener('input', e => {
      state.prefs.bgDim = +e.target.value;
      $('valBgDim').textContent = e.target.value + '%';
      applyBackground(); savePrefs();
    });
    document.querySelectorAll('#setBgSize button').forEach(b => b.addEventListener('click', () => {
      state.prefs.bgSize = b.dataset.v;
      applyBackground(); savePrefs(); syncSettingsUI();
    }));
    $('setBgRepeat').addEventListener('change', e => {
      state.prefs.bgRepeat = e.target.checked;
      applyBackground(); savePrefs();
    });
    $('setFsBorderless').addEventListener('change', e => {
      state.prefs.fullscreenBorderless = e.target.checked;
      savePrefs();
      toast(e.target.checked ? '全屏将隐藏窗口边框' : '全屏将保留窗口边框');
    });
    $('setPanelAlpha').addEventListener('input', e => {
      state.prefs.panelAlpha = +e.target.value;
      $('valPanelAlpha').textContent = e.target.value + '%';
      document.documentElement.style.setProperty('--panel-alpha', e.target.value + '%');
      savePrefs();
    });
    $('setSync').addEventListener('change', e => { state.prefs.sync = e.target.checked; savePrefs(); });
    $('settingsReset').addEventListener('click', () => {
      state.prefs = Object.assign({}, DEFAULT_PREFS);
      applyPrefs(state.prefs); savePrefs(); toast('已恢复默认设置');
    });
    el.settings.addEventListener('mousedown', ev => { if (ev.target === el.settings) openSettings(false); });

    // 右键菜单
    document.addEventListener('contextmenu', ev => {
      // 即时渲染里的表格：给单元格菜单
      if (state.view === 'wysiwyg' && wy && wy.tableEdit && ev.target.closest('td, th')) {
        ev.preventDefault();
        showContextMenu(ev.clientX, ev.clientY, [
          { label: '上方插入行', action: () => wy.addRow('above') },
          { label: '下方插入行', key: 'Ctrl+Enter', action: () => wy.addRow('below') },
          { label: '左侧插入列', action: () => wy.addCol('left') },
          { label: '右侧插入列', action: () => wy.addCol('right') },
          '-',
          { label: '上移该行', action: () => wy.moveRow(-1) },
          { label: '下移该行', action: () => wy.moveRow(1) },
          { label: '左移该列', action: () => wy.moveCol(-1) },
          { label: '右移该列', action: () => wy.moveCol(1) },
          '-',
          { label: '删除行', key: 'Ctrl+Shift+⌫', action: () => wy.delRow() },
          { label: '删除列', action: () => wy.delCol() },
          '-',
          { label: '复制表格', action: () => { navigator.clipboard.writeText(wy.blocks[wy.tableEdit ? wy.tableEdit.index : 0].src); toast('表格源码已复制'); } },
          { label: '删除表格', action: () => wy.deleteTable() },
          '-',
          { label: '退出表格编辑', key: 'Esc', action: () => wy.commitTable() }
        ]);
        return;
      }
      if (ev.target.closest('input, textarea') || ev.target.closest('.preview')) {
        ev.preventDefault();
        showContextMenu(ev.clientX, ev.clientY, [
          { label: '剪切', key: 'Ctrl+X', action: () => document.execCommand('cut') },
          { label: '复制', key: 'Ctrl+C', action: () => document.execCommand('copy') },
          { label: '粘贴', key: 'Ctrl+V', action: () => document.execCommand('paste') },
          '-',
          { label: '加粗', key: 'Ctrl+B', action: () => cmd('bold') },
          { label: '斜体', key: 'Ctrl+I', action: () => cmd('italic') },
          { label: '行内代码', key: 'Ctrl+Shift+`', action: () => cmd('code') },
          {
            label: '插入', sub: [
              { label: '图像…', key: 'Ctrl+Shift+I', action: () => doAction('image') },
              '-',
              { label: '脚注', action: () => doAction('footnote') },
              { label: '链接引用', action: () => doAction('linkref') },
              { label: '水平分割线', action: () => doAction('hr') },
              '-',
              { label: '表格', key: 'Ctrl+T', action: () => doAction('table') },
              { label: '代码块', key: 'Ctrl+Shift+K', action: () => doAction('codeblock') },
              { label: '公式块', key: 'Ctrl+Shift+M', action: () => doAction('math') },
              { label: '内容目录', action: () => doAction('toc') },
              { label: 'YAML Front Matter', action: () => doAction('frontmatter') },
              '-',
              { label: '段落（上方）', action: () => doAction('paraAbove') },
              { label: '段落（下方）', action: () => doAction('paraBelow') }
            ]
          },
          { label: '插入链接', key: 'Ctrl+K', action: () => cmd('link') },
          '-',
          { label: '全选', key: 'Ctrl+A', action: () => { el.editor.focus(); el.editor.select(); } }
        ]);
      }
    });
  }

  // 滚动同步节流
  let previewScrolling = false, editorScrolling = false;
  function schedulePreviewSync() {
    if (!state.prefs.sync || state.view !== 'split' || editorScrolling) return;
    previewScrolling = true;
    const max = el.editor.scrollHeight - el.editor.clientHeight;
    const ratio = max > 0 ? el.editor.scrollTop / max : 0;
    el.preview.scrollTop = ratio * Math.max(0, el.preview.scrollHeight - el.preview.clientHeight);
    requestAnimationFrame(() => { previewScrolling = false; });
  }

  function toggleTask(line) {
    const lines = el.editor.value.split('\n');
    const l = lines[line];
    if (l == null) return;
    if (/\[ \]/.test(l)) lines[line] = l.replace('[ ]', '[x]');
    else if (/\[[xX]\]/.test(l)) lines[line] = l.replace(/\[[xX]\]/, '[ ]');
    else return;
    el.editor.value = lines.join('\n');
    state.content = el.editor.value;
    onChanged();
    renderPreview();
  }

  function newDoc() {
    newTab('未命名', '', null);
    showWelcome(false);
    if (state.view === 'wysiwyg' && wy) wy.beginEdit(0, 0);
    else el.editor.focus();
  }

  function copyAll() {
    navigator.clipboard.writeText(state.content).then(() => toast('已复制全文'));
  }

  const THEMES = ['light', 'dark', 'sepia', 'night'];
  function cycleTheme() {
    const i = THEMES.indexOf(state.prefs.theme);
    state.prefs.theme = THEMES[(i + 1) % THEMES.length];
    applyPrefs(state.prefs);
    savePrefs();
    toast('主题：' + ({ light: '浅色', dark: '深色', sepia: '护眼', night: '夜蓝' })[state.prefs.theme]);
  }

  let zoomLevel = 100;
  function zoom(dir) {
    if (dir === 0) zoomLevel = 100;
    else zoomLevel = Math.min(160, Math.max(70, zoomLevel + dir * 10));
    document.documentElement.style.setProperty('--fs-body', Math.round(state.prefs.size * zoomLevel / 100) + 'px');
    el.stZoom.textContent = zoomLevel + '%';
  }

  /* ---------------- 启动 ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 暴露给宿主自检
  window.__markedit = { state, openContent, setView, save: doSave, cmd, doAction, openTableDialog, renderPreview, startPrint, endPrint, get wy() { return wy; }, exportModel: () => JSON.stringify(window.ExportModel.build(state.content)) };
})();