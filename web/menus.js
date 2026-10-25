/* ============================================================
   MarkEdit · 菜单栏（Typora 风格）
   ============================================================ */
(function (global) {
  'use strict';

  const MENUS = [
    {
      title: '文件',
      items: [
        { label: '新建标签页', key: 'Ctrl+N', act: 'new' },
        { label: '新建空白文件…', key: 'Ctrl+Alt+N', act: 'newFile' },
        { label: '打开…', key: 'Ctrl+O', act: 'open' },
        { label: '打开文件夹…', act: 'openFolder' },
        { sep: true },
        { label: '保存', key: 'Ctrl+S', act: 'save' },
        { label: '另存为…', key: 'Ctrl+Shift+S', act: 'saveAs' },
        { sep: true },
        { label: '导出 Word…', act: 'exportWord' },
        { label: '导出 HTML…', act: 'exportHtml' },
        { label: '导出 PDF…', act: 'exportPdf' },
        { label: '打印…', key: 'Alt+Shift+P', act: 'print' },
        { sep: true },
        { label: '打开文件位置', act: 'reveal' },
        { label: '注册到「打开方式」', act: 'registerAssoc' },
      { label: '设为 .md 默认程序', act: 'setDefaultAssoc' },
        { label: '关闭标签页', key: 'Ctrl+W', act: 'closeTab' }
      ]
    },
    {
      title: '编辑',
      items: [
        { label: '撤销', key: 'Ctrl+Z', act: 'undo' },
        { label: '重做', key: 'Ctrl+Y', act: 'redo' },
        { sep: true },
        { label: '剪切', key: 'Ctrl+X', act: 'cut' },
        { label: '复制', key: 'Ctrl+C', act: 'copy' },
        { label: '粘贴', key: 'Ctrl+V', act: 'paste' },
        { label: '粘贴为纯文本', key: 'Ctrl+Shift+V', act: 'pastePlain' },
        { label: '复制为 Markdown', key: 'Ctrl+Shift+C', act: 'copyMd' },
        { sep: true },
        { label: '全选', key: 'Ctrl+A', act: 'selectAll' },
        { sep: true },
        { label: '查找', key: 'Ctrl+F', act: 'find' },
        { label: '查找和替换', key: 'Ctrl+H', act: 'replace' }
      ]
    },
    {
      title: '段落',
      items: [
        { label: '一级标题', key: 'Ctrl+1', act: 'h1' },
        { label: '二级标题', key: 'Ctrl+2', act: 'h2' },
        { label: '三级标题', key: 'Ctrl+3', act: 'h3' },
        { label: '四级标题', key: 'Ctrl+4', act: 'h4' },
        { label: '五级标题', key: 'Ctrl+5', act: 'h5' },
        { label: '六级标题', key: 'Ctrl+6', act: 'h6' },
        { label: '段落', key: 'Ctrl+0', act: 'p' },
        { sep: true },
        { label: '提升标题级别', key: 'Ctrl+=', act: 'headingUp' },
        { label: '降低标题级别', key: 'Ctrl+-', act: 'headingDown' },
        { sep: true },
        { label: '表格', act: 'table' },
        { label: '公式块', key: 'Ctrl+Shift+M', act: 'math' },
        { label: '代码块', key: 'Ctrl+Shift+K', act: 'codeblock' },
        { label: '引用', key: 'Ctrl+Shift+Q', act: 'quote' },
        { sep: true },
        { label: '有序列表', key: 'Ctrl+Shift+[', act: 'ol' },
        { label: '无序列表', key: 'Ctrl+Shift+]', act: 'ul' },
        { label: '任务列表', key: 'Ctrl+Shift+X', act: 'task' },
        { sep: true },
        { label: '增加缩进', key: 'Ctrl+]', act: 'indent' },
        { label: '减少缩进', key: 'Ctrl+[', act: 'outdent' },
        { sep: true },
        { label: '水平分割线', act: 'hr' }
      ]
    },
    {
      title: '格式',
      items: [
        { label: '加粗', key: 'Ctrl+B', act: 'bold' },
        { label: '斜体', key: 'Ctrl+I', act: 'italic' },
        { label: '删除线', key: 'Alt+Shift+5', act: 'strike' },
        { label: '高亮', act: 'mark' },
        { label: '行内代码', key: 'Ctrl+Shift+`', act: 'code' },
        { sep: true },
        { label: '链接…', key: 'Ctrl+K', act: 'link' },
        { label: '图片…', act: 'image' },
        { sep: true },
        { label: '清除格式', key: 'Ctrl+\\', act: 'clear' }
      ]
    },
    {
      title: '视图',
      items: [
        { label: '即时渲染', act: 'view-wysiwyg' },
        { label: '双栏', act: 'view-split' },
        { label: '源码模式', key: 'Ctrl+/', act: 'view-source' },
        { label: '阅读模式', act: 'view-preview' },
        { sep: true },
        { label: '专注模式', key: 'F8', act: 'focusMode' },
        { label: '打字机模式', key: 'F9', act: 'typewriter' },
        { sep: true },
        { label: '显示 / 隐藏侧栏', key: 'Ctrl+Shift+L', act: 'sidebar' },
        { label: '大纲', key: 'Ctrl+Shift+1', act: 'outline' },
        { label: '文件列表', key: 'Ctrl+Shift+2', act: 'files' },
        { sep: true },
        { label: '放大', key: 'Ctrl+Shift+=', act: 'zoomIn' },
        { label: '缩小', key: 'Ctrl+Shift+-', act: 'zoomOut' },
        { label: '实际大小', key: 'Ctrl+Shift+9', act: 'zoomReset' },
        { label: '全屏', key: 'F11', act: 'fullscreen' }
      ]
    },
    {
      title: '主题',
      items: [
        { label: '浅色', act: 'theme-light' },
        { label: '深色', act: 'theme-dark' },
        { label: '护眼', act: 'theme-sepia' },
        { label: '夜蓝', act: 'theme-night' },
        { sep: true },
        { label: '设置…', act: 'settings' }
      ]
    },
    {
      title: '帮助',
      items: [
        { label: '快捷键', key: 'F1', act: 'help' },
        { label: '关于 MarkEdit', act: 'about' }
      ]
    }
  ];

  let openIndex = -1;
  let root = null;
  let onAction = null;

  function build(container, handler) {
    root = container;
    onAction = handler;
    root.innerHTML = MENUS.map((m, mi) => {
      const items = m.items.map((it, ii) => {
        if (it.sep) return '<div class="menu-sep"></div>';
        return '<button class="menu-item" data-menu="' + mi + '" data-item="' + ii + '">' +
          '<span>' + it.label + '</span>' +
          (it.key ? '<kbd>' + it.key + '</kbd>' : '') + '</button>';
      }).join('');
      return '<div class="menu" data-menu="' + mi + '">' +
        '<button class="menu-title">' + m.title + '</button>' +
        '<div class="menu-pop">' + items + '</div></div>';
    }).join('');

    root.addEventListener('mousedown', ev => {
      const title = ev.target.closest('.menu-title');
      if (title) {
        ev.preventDefault();
        const idx = +title.parentNode.dataset.menu;
        toggle(idx);
        return;
      }
      const item = ev.target.closest('.menu-item');
      if (item) {
        ev.preventDefault();
        const mi = +item.dataset.menu;
        const it = MENUS[mi].items[+item.dataset.item];
        close();
        if (it && it.act && onAction) onAction(it.act);
      }
    });

    root.addEventListener('mouseover', ev => {
      if (openIndex < 0) return;
      const title = ev.target.closest('.menu-title');
      if (!title) return;
      const idx = +title.parentNode.dataset.menu;
      if (idx !== openIndex) open(idx);
    });

    document.addEventListener('mousedown', ev => {
      if (openIndex >= 0 && !root.contains(ev.target)) close();
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && openIndex >= 0) { close(); ev.stopPropagation(); }
    }, true);
  }

  function toggle(i) { if (openIndex === i) close(); else open(i); }

  function open(i) {
    close();
    openIndex = i;
    const el = root.querySelector('.menu[data-menu="' + i + '"]');
    if (el) el.classList.add('open');
  }

  function close() {
    if (!root) return;
    root.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
    openIndex = -1;
  }

  global.Menus = { build: build, close: close, MENUS: MENUS };
})(window);
