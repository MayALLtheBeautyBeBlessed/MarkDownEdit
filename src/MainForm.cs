using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Lanyu
{
    internal static class Program
    {
        internal static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory;
        internal static string DataDir = Path.Combine(AppDir, "data");
        internal static readonly string WebDir = Path.Combine(AppDir, "web");

        private static string LogPath
        {
            get { return Path.Combine(DataDir, "startup.log"); }
        }

        internal static void Log(string msg)
        {
            try
            {
                Directory.CreateDirectory(DataDir);
                var fi = new FileInfo(LogPath);
                if (fi.Exists && fi.Length > 512 * 1024) fi.Delete();
                File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg + "\r\n", Encoding.UTF8);
            }
            catch { }
        }

        /// <summary>优先把 data 放在程序目录（便携）；没有写权限时退回 %LOCALAPPDATA%。</summary>
        private static string ResolveDataDir()
        {
            try
            {
                var local = Path.Combine(AppDir, "data");
                Directory.CreateDirectory(local);
                var probe = Path.Combine(local, ".writetest");
                File.WriteAllText(probe, "1");
                File.Delete(probe);
                return local;
            }
            catch
            {
                var fallback = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lanyu");
                Directory.CreateDirectory(fallback);
                return fallback;
            }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            DataDir = ResolveDataDir();
            Log("=== start: " + string.Join(" ", args));
            try { Assoc.Register(); } catch (Exception ex) { Log("assoc auto fail: " + ex.Message); }
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Log("UNHANDLED: " + e.ExceptionObject);
            Application.ThreadException += (s, e) => Log("THREAD EXC: " + e.Exception);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(args));
            }
            catch (Exception ex)
            {
                Log("FATAL: " + ex);
                MessageBox.Show(ex.ToString(), "Lanyu 启动失败");
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly WebView2 _web = new WebView2();
        private readonly string _shotPath;
        private readonly string _eval;
        private readonly string _evalFile;
        private readonly string _pdfPath;
        private readonly string _docxPath;
        private readonly string _startupFile;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private readonly JavaScriptSerializer _jsonBig = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };

internal string CurrentPath;
        private bool _allowClose;

        private bool _fullscreen;
        private FormBorderStyle _prevBorder = FormBorderStyle.Sizable;
        private FormWindowState _prevState = FormWindowState.Normal;
        private Rectangle _prevBounds;
        private bool _lastBorderless = true;
        private bool _prevTopMost;
        private F11Filter _f11Filter;

        public MainForm(string[] args)
        {
            foreach (var a in args)
            {
                if (a.StartsWith("--shot=", StringComparison.OrdinalIgnoreCase))
                    _shotPath = a.Substring("--shot=".Length).Trim('"');
                else if (a.StartsWith("--docx=", StringComparison.OrdinalIgnoreCase))
                    _docxPath = a.Substring("--docx=".Length).Trim('"');
                else if (a.StartsWith("--evalfile=", StringComparison.OrdinalIgnoreCase))
                    _evalFile = a.Substring("--evalfile=".Length).Trim('"');
                else if (a.StartsWith("--pdf=", StringComparison.OrdinalIgnoreCase))
                    _pdfPath = a.Substring("--pdf=".Length).Trim('"');
                else if (a.StartsWith("--eval=", StringComparison.OrdinalIgnoreCase))
                    _eval = a.Substring("--eval=".Length);
                else if (!a.StartsWith("--"))
                    _startupFile = a;
            }

            Text = "Lanyu";
            MinimumSize = new Size(820, 520);
            ClientSize = new Size(1360, 860);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(30, 30, 30);
            Font = new Font("Microsoft YaHei UI", 9f);
            KeyPreview = true;

            try
            {
                var exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (exeIcon != null) Icon = exeIcon;
            }
            catch { }

            _web.Dock = DockStyle.Fill;
            _web.DefaultBackgroundColor = Color.FromArgb(30, 30, 30);
            Controls.Add(_web);

            Load += async (s, e) => await InitAsync();
            FormClosed += (s, e) =>
            {
                try { if (_f11Filter != null) Application.RemoveMessageFilter(_f11Filter); } catch { }
            };
        }

        private async Task InitAsync()
        {
            try
            {
                Directory.CreateDirectory(Program.DataDir);
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "webview2"));
                await _web.EnsureCoreWebView2Async(env);
                var core = _web.CoreWebView2;
                var st = core.Settings;
                st.AreDefaultContextMenusEnabled = false;
                st.IsStatusBarEnabled = false;
                st.AreBrowserAcceleratorKeysEnabled = false;
                st.IsZoomControlEnabled = false;
                st.IsSwipeNavigationEnabled = false;
                st.IsGeneralAutofillEnabled = false;
                st.IsPasswordAutosaveEnabled = false;
                st.AreDevToolsEnabled = true;

                core.WebMessageReceived += OnWebMessage;
                core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
                core.NavigationStarting += (s, e) =>
                {
                    if (e.Uri != null && (e.Uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                                          || e.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
                    {
                        e.Cancel = true;
                        OpenExternal(e.Uri);
                    }
                };
                core.DocumentTitleChanged += (s, e) => Text = core.DocumentTitle;

                // WebView2 会把 F11 当成浏览器加速键吞掉，所以在消息泵层面先截住
                if (_f11Filter == null)
                {
                    _f11Filter = new F11Filter(this);
                    Application.AddMessageFilter(_f11Filter);
                }

                var index = Path.Combine(Program.WebDir, "index.html");
                if (!File.Exists(index))
                {
                    MessageBox.Show("找不到 web\\index.html，程序不完整。", "Lanyu");
                    Close();
                    return;
                }

                var opened = false;
                core.NavigationCompleted += (s, e) =>
                {
                    if (opened) return;
                    opened = true;
                    if (!string.IsNullOrEmpty(_startupFile) && File.Exists(_startupFile))
                    {
                        Task.Delay(350).ContinueWith(_ => BeginInvoke(new Action(() => DoOpenPath(_startupFile))));
                    }
                };
                core.Navigate(new Uri(index).AbsoluteUri);
                Program.Log("navigated to " + index);

                if (!string.IsNullOrEmpty(_shotPath) || !string.IsNullOrEmpty(_pdfPath) || !string.IsNullOrEmpty(_docxPath) || !string.IsNullOrEmpty(_evalFile) || !string.IsNullOrEmpty(_eval))
                {
                    int delay = File.Exists(_startupFile ?? "") ? 4000 : 3000;
                    await Task.Delay(delay);

                    var evalScript = _eval;
                    if (!string.IsNullOrEmpty(_evalFile) && File.Exists(_evalFile))
                        evalScript = File.ReadAllText(_evalFile, Encoding.UTF8);
                    if (!string.IsNullOrEmpty(evalScript))
                    {
                        try { await core.ExecuteScriptAsync(evalScript); }
                        catch (Exception ex) { Program.Log("eval fail " + ex.Message); }
                        await Task.Delay(700);
                    }

                    if (!string.IsNullOrEmpty(_docxPath))
                    {
                        try
                        {
                            var raw = await core.ExecuteScriptAsync("window.__lanyu.exportModel()");
                            var json = _json.Deserialize<string>(raw);
                            var model = _json.Deserialize<Dictionary<string, object>>(json);
                            var dir = string.IsNullOrEmpty(_startupFile) ? Program.AppDir : Path.GetDirectoryName(_startupFile);
                            DocxExport.Write(_docxPath, model, dir);
                            Program.Log("docx written " + _docxPath);
                        }
                        catch (Exception ex) { Program.Log("docx fail " + ex.Message); }
                        await Task.Delay(300);
                        Application.Exit();
                        return;
                    }

                    if (!string.IsNullOrEmpty(_pdfPath))
                    {
                        var ps = core.Environment.CreatePrintSettings();
                        ps.ShouldPrintBackgrounds = true;
                        ps.ShouldPrintHeaderAndFooter = false;
                        await core.ExecuteScriptAsync("window.__lanyu.startPrint()");
                        await Task.Delay(300);
                        var okPdf = await core.PrintToPdfAsync(_pdfPath, ps);
                        Program.Log("pdf=" + okPdf + " -> " + _pdfPath);
                        await Task.Delay(200);
                _allowClose = true;
                        Application.Exit();
                        return;
                    }

                    if (string.IsNullOrEmpty(_shotPath)) return;   // 只跑 --evalfile 时不截图、不退出
                    Directory.CreateDirectory(Path.GetDirectoryName(_shotPath));
                    using (var fs = File.Create(_shotPath))
                        await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
                    Program.Log("shot saved " + _shotPath);
                    await Task.Delay(200);
                _allowClose = true;
                    Application.Exit();
                }
            }
            catch (Exception ex)
            {
                Program.Log("INIT FAIL: " + ex);
                MessageBox.Show(ex.ToString(), "初始化失败");
            }
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var dict = _json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                if (dict == null) return;
                var cmd = Str(dict, "cmd");
                if (cmd == "setTitle")
                {
                    Text = Str(dict, "title");
                    return;
                }
                switch (cmd)
                {
                    case "open": DoOpen(); break;
                    case "openPath": DoOpenPath(Str(dict, "path")); break;
                    case "save": DoSave(Str(dict, "path"), Str(dict, "content")); break;
                    case "saveAs": DoSaveAs(Str(dict, "content"), Str(dict, "defaultName")); break;
                    case "openFolder": DoOpenFolder(); break;
                    case "listDir": DoListDir(Str(dict, "path")); break;
                    case "saveImage": DoSaveImage(dict); break;
                    case "pickBackground": DoPickBackground(); break;
                    case "pickImage": DoPickImage(); break;
                    case "newFile": DoNewFile(); break;
                    case "logmsg": Program.Log("JS: " + Str(dict, "msg")); break;
                    case "closeNow": _allowClose = true; Close(); break;
                    case "closeSave": DoCloseSave(Str(dict, "content")); break;
                    case "info":
                        Post(new
                        {
                            type = "info",
                            dataDir = Program.DataDir,
                            appDir = Program.AppDir,
                            exePath = Application.ExecutablePath,
                            isTemp = Program.DataDir.StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase)
                        });
                        break;
case "openDataDir": OpenFolderPath(Program.DataDir); break;
                    case "registerAssoc":
                        var okAssoc = Assoc.Register();
                        Post(new { type = "assoc", ok = okAssoc });
                        break;
                    case "setDefaultAssoc":
                        var okDef = Assoc.ForceDefault();
                        Post(new { type = "assocDefault", ok = okDef });
                        break;
                    case "exportHtml": DoExportHtml(Str(dict, "html"), Str(dict, "defaultName")); break;
                    case "printPdf": DoPrintPdf(Str(dict, "defaultName")); break;
                    case "exportWord": DoExportWord(Str(dict, "model"), Str(dict, "defaultName"), Str(dict, "docPath")); break;
                    case "saveTextFile": DoSaveTextFile(Str(dict, "content"), Str(dict, "defaultName"), Str(dict, "filter")); break;
                    case "getPrefs": DoGetPrefs(); break;
                    case "setPrefs": DoSetPrefs(Str(dict, "json")); break;
                    case "recent": DoRecent(dict); break;
                    case "confirm":
                        var ok = MessageBox.Show(Str(dict, "message"), "Lanyu",
                            MessageBoxButtons.OKCancel, MessageBoxIcon.Question) == DialogResult.OK;
                        Post(new { type = "confirm", id = Str(dict, "id"), ok = ok });
                        break;
                    case "alert":
                        MessageBox.Show(Str(dict, "message"), "Lanyu");
                        break;
                    case "openExternal": OpenExternal(Str(dict, "url")); break;
                    case "reveal": Reveal(Str(dict, "path")); break;
                    case "toggleFullscreen":
                        _lastBorderless = !dict.ContainsKey("borderless") || Convert.ToBoolean(dict["borderless"]);
                        ToggleFullscreen(_lastBorderless);
                        break;
                    case "quit": Close(); break;
                }
            }
            catch (Exception ex)
            {
                Program.Log("MSG FAIL: " + ex);
            }
        }

        private static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? v.ToString() : "";
        }

        /* 超长消息分片投递：每片 256KB，前端拼回 */
        private void PostChunked(object payload)
        {
            var json = _jsonBig.Serialize(payload);
            const int size = 256 * 1024;
            var total = (json.Length + size - 1) / size;
            for (var i = 0; i < total; i++)
            {
                var part = json.Substring(i * size, Math.Min(size, json.Length - i * size));
                var msg = _jsonBig.Serialize(new Dictionary<string, object>
                {
                    { "cmd", "chunk" }, { "i", i }, { "n", total }, { "s", part }
                });
                _web.CoreWebView2.PostWebMessageAsJson(msg);
            }
        }

        private void Post(object payload)
        {
            try { _web.CoreWebView2.PostWebMessageAsJson(_json.Serialize(payload)); }
            catch (Exception ex)
            {
                Program.Log("POST FAIL: " + ex.Message);
                // 大消息：WebView2 单条消息有上限，改用分片发送
                try { PostChunked(payload); }
                catch (Exception ex2) { Program.Log("POST CHUNK FAIL: " + ex2.Message); }
            }
        }

        /* ---------------- 文件 ---------------- */

        private void DoOpen()
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = "打开 Markdown 文件";
                dlg.Filter = "Markdown|*.md;*.markdown;*.mdown;*.mkd|文本文件|*.txt|所有文件|*.*";
                if (dlg.ShowDialog(this) == DialogResult.OK) DoOpenPath(dlg.FileName);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (_allowClose || e.CloseReason == CloseReason.WindowsShutDown || e.CloseReason == CloseReason.TaskManagerClosing)
            {
                base.OnFormClosing(e);
                return;
            }
            e.Cancel = true;
            Post(new { type = "askClose" });
        }

        private void DoCloseSave(string content)
        {
            try
            {
                if (string.IsNullOrEmpty(CurrentPath))
                {
                    using (var dlg = new SaveFileDialog())
                    {
                        dlg.Title = "保存后关闭";
                        dlg.Filter = "Markdown|*.md|文本文件|*.txt|所有文件|*.*";
                        dlg.FileName = "未命名.md";
                        if (dlg.ShowDialog(this) != DialogResult.OK) return;
                        File.WriteAllText(dlg.FileName, content ?? "", new UTF8Encoding(false));
                        CurrentPath = dlg.FileName;
                        AddRecent(CurrentPath);
                    }
                }
                else
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(CurrentPath));
                    File.WriteAllText(CurrentPath, content ?? "", new UTF8Encoding(false));
                    AddRecent(CurrentPath);
                }
                _allowClose = true;
                Close();
            }
            catch (Exception ex)
            {
                Post(new { type = "error", message = "保存失败：" + ex.Message });
            }
        }

/// <summary>新建一个真正落盘的空白 md 文件，然后打开它。</summary>
        private void DoNewFile()
        {
            using (var dlg = new SaveFileDialog())
            {
                dlg.Title = "新建 Markdown 文件";
                dlg.Filter = "Markdown|*.md|文本文件|*.txt|所有文件|*.*";
                dlg.FileName = "未命名.md";
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    if (!File.Exists(dlg.FileName)) File.WriteAllText(dlg.FileName, "", new UTF8Encoding(false));
                    DoOpenPath(dlg.FileName);
                }
                catch (Exception ex)
                {
                    Post(new { type = "error", message = "新建文件失败：" + ex.Message });
                }
            }
        }

        private void DoOpenPath(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path)) return;
                var text = File.ReadAllText(path, DetectEncoding(path));
                CurrentPath = path;
                Post(new
                {
                    type = "file",
                    path = path,
                    name = Path.GetFileName(path),
                    content = text,
                    mtime = File.GetLastWriteTime(path).ToString("o")
                });
                AddRecent(path);
            }
            catch (Exception ex)
            {
                MessageBox.Show("打开失败：" + ex.Message, "Lanyu");
            }
        }

        private static Encoding DetectEncoding(string path)
        {
            try
            {
                var bytes = File.ReadAllBytes(path);
                if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) return new UTF8Encoding(true);
                if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) return Encoding.Unicode;
                if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) return Encoding.BigEndianUnicode;
            }
            catch { }
            return new UTF8Encoding(false);
        }

        private void DoSave(string path, string content)
        {
            try
            {
                if (string.IsNullOrEmpty(path)) { DoSaveAs(content, "未命名.md"); return; }
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, content, new UTF8Encoding(false));
                CurrentPath = path;
                AddRecent(path);
                Post(new { type = "saved", path = path, mtime = File.GetLastWriteTime(path).ToString("o") });
            }
            catch (Exception ex)
            {
                Post(new { type = "error", message = "保存失败：" + ex.Message });
            }
        }

        private void DoSaveAs(string content, string defaultName)
        {
            using (var dlg = new SaveFileDialog())
            {
                dlg.Title = "另存为";
                dlg.Filter = "Markdown|*.md|文本文件|*.txt|所有文件|*.*";
                dlg.FileName = string.IsNullOrEmpty(defaultName) ? "未命名.md" : defaultName;
                if (dlg.ShowDialog(this) == DialogResult.OK) DoSave(dlg.FileName, content);
            }
        }

        private void DoSaveTextFile(string content, string defaultName, string filter)
        {
            using (var dlg = new SaveFileDialog())
            {
                dlg.Title = "保存";
                dlg.Filter = string.IsNullOrEmpty(filter) ? "所有文件|*.*" : filter;
                dlg.FileName = defaultName;
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    File.WriteAllText(dlg.FileName, content, new UTF8Encoding(false));
                    Post(new { type = "exported", path = dlg.FileName });
                }
                catch (Exception ex) { MessageBox.Show(ex.Message, "Lanyu"); }
            }
        }

        /* ---------------- 导出 ---------------- */

        private void DoExportHtml(string html, string defaultName)
        {
            using (var dlg = new SaveFileDialog())
            {
                dlg.Title = "导出 HTML";
                dlg.Filter = "HTML|*.html";
                dlg.FileName = string.IsNullOrEmpty(defaultName) ? "导出.html" : defaultName;
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    File.WriteAllText(dlg.FileName, html, new UTF8Encoding(false));
                    Post(new { type = "exported", path = dlg.FileName });
                }
                catch (Exception ex) { MessageBox.Show(ex.Message, "Lanyu"); }
            }
        }

        private void DoExportWord(string modelJson, string defaultName, string docPath)
        {
            using (var dlg = new SaveFileDialog())
            {
                dlg.Title = "导出 Word 文档";
                dlg.Filter = "Word 文档|*.docx";
                dlg.FileName = string.IsNullOrEmpty(defaultName) ? "导出.docx" : defaultName;
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    var model = _json.Deserialize<Dictionary<string, object>>(modelJson);
                    DocxExport.Write(dlg.FileName, model,
                        string.IsNullOrEmpty(docPath) ? Program.AppDir : Path.GetDirectoryName(docPath));
                    Post(new { type = "exported", path = dlg.FileName });
                }
                catch (Exception ex)
                {
                    Program.Log("docx fail: " + ex);
                    Post(new { type = "error", message = "导出 Word 失败：" + ex.Message });
                }
            }
        }

        private async void DoPrintPdf(string defaultName)
        {
            using (var dlg = new SaveFileDialog())
            {
                dlg.Title = "导出 PDF";
                dlg.Filter = "PDF|*.pdf";
                dlg.FileName = string.IsNullOrEmpty(defaultName) ? "导出.pdf" : defaultName;
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    var settings = _web.CoreWebView2.Environment.CreatePrintSettings();
                    settings.MarginTop = 0.55;
                    settings.MarginBottom = 0.55;
                    settings.MarginLeft = 0.6;
                    settings.MarginRight = 0.6;
                    settings.ShouldPrintBackgrounds = true;
                    settings.ShouldPrintHeaderAndFooter = false;
                    var ok = await _web.CoreWebView2.PrintToPdfAsync(dlg.FileName, settings);
                    Post(new { type = "pdf", ok = ok, path = dlg.FileName });
                }
                catch (Exception ex)
                {
                    Post(new { type = "error", message = "导出 PDF 失败：" + ex.Message });
                }
            }
        }

        /* ---------------- 目录 / 图片 ---------------- */

        private void DoOpenFolder()
        {
            using (var dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择要浏览的文件夹";
                if (dlg.ShowDialog(this) == DialogResult.OK) DoListDir(dlg.SelectedPath);
            }
        }

        private void DoListDir(string root)
        {
            try
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return;
                var node = BuildNode(new DirectoryInfo(root), 0);
                Post(new { type = "tree", root = root, tree = node });
            }
            catch (Exception ex)
            {
                Post(new { type = "error", message = "读取目录失败：" + ex.Message });
            }
        }

        private object BuildNode(DirectoryInfo dir, int depth)
        {
            var files = new List<object>();
            try
            {
                foreach (var f in dir.GetFiles().OrderBy(f => f.Name))
                {
                    var ext = f.Extension.ToLowerInvariant();
                    if (ext == ".md" || ext == ".markdown" || ext == ".mdown" || ext == ".txt" || ext == ".mkd")
                        files.Add(new { name = f.Name, path = f.FullName, size = f.Length, mtime = f.LastWriteTime.ToString("o") });
                }
            }
            catch { }

            var dirs = new List<object>();
            if (depth < 3)
            {
                try
                {
                    foreach (var d in dir.GetDirectories().OrderBy(d => d.Name))
                    {
                        if (d.Name.StartsWith(".") || d.Name.Equals("node_modules", StringComparison.OrdinalIgnoreCase)) continue;
                        var child = BuildNode(d, depth + 1) as Dictionary<string, object>;
                        if (child == null) continue;
                        if (((List<object>)child["files"]).Count == 0 && ((List<object>)child["dirs"]).Count == 0) continue;
                        dirs.Add(child);
                    }
                }
                catch { }
            }
            return new Dictionary<string, object>
            {
                { "name", dir.Name },
                { "path", dir.FullName },
                { "files", files },
                { "dirs", dirs }
            };
        }

        private void DoSaveImage(Dictionary<string, object> dict)
        {
            try
            {
                var dataUrl = Str(dict, "dataUrl");
                var docPath = Str(dict, "docPath");
                var idx = dataUrl.IndexOf(',');
                if (idx < 0) return;
                var meta = dataUrl.Substring(0, idx);
                var b64 = dataUrl.Substring(idx + 1);
                var ext = ".png";
                if (meta.Contains("jpeg")) ext = ".jpg";
                else if (meta.Contains("gif")) ext = ".gif";
                else if (meta.Contains("webp")) ext = ".webp";
                else if (meta.Contains("svg")) ext = ".svg";

                var baseDir = string.IsNullOrEmpty(docPath) ? Program.DataDir : Path.GetDirectoryName(docPath);
                var assets = Path.Combine(baseDir, "assets");
                Directory.CreateDirectory(assets);
                var name = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + ext;
                var full = Path.Combine(assets, name);
                File.WriteAllBytes(full, Convert.FromBase64String(b64));
                Post(new { type = "image", path = full, rel = "assets/" + name });
            }
            catch (Exception ex)
            {
                Post(new { type = "error", message = "保存图片失败：" + ex.Message });
            }
        }

        /// <summary>选一张图片作为背景，复制到 data\backgrounds 下，保证整个文件夹可迁移。</summary>
        private void DoPickBackground()
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = "选择背景图片";
                dlg.Filter = "图片|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif|所有文件|*.*";
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    var dir = Path.Combine(Program.DataDir, "backgrounds");
                    Directory.CreateDirectory(dir);
                    foreach (var old in Directory.GetFiles(dir, "bg-*"))
                    {
                        try { File.Delete(old); } catch { }
                    }
                    var ext = Path.GetExtension(dlg.FileName);
                    var target = Path.Combine(dir, "bg-" + DateTime.Now.ToString("yyyyMMddHHmmss") + ext);
                    File.Copy(dlg.FileName, target, true);
                    Post(new { type = "bgpicked", path = target, name = Path.GetFileName(dlg.FileName) });
                }
                catch (Exception ex)
                {
                    Post(new { type = "error", message = "设置背景失败：" + ex.Message });
                }
            }
        }

        /// <summary>插入图片：选一张图，复制到文档同目录 assets 下，返回相对路径。</summary>
        private void DoPickImage()
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = "插入图片";
                dlg.Filter = "图片|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp|所有文件|*.*";
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    var baseDir = string.IsNullOrEmpty(CurrentPath) ? Program.DataDir : Path.GetDirectoryName(CurrentPath);
                    var assets = Path.Combine(baseDir, "assets");
                    Directory.CreateDirectory(assets);
                    var name = "img-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + Path.GetExtension(dlg.FileName);
                    var target = Path.Combine(assets, name);
                    File.Copy(dlg.FileName, target, true);
                    Post(new { type = "image", path = target, rel = "assets/" + name });
                }
                catch (Exception ex)
                {
                    Post(new { type = "error", message = "插入图片失败：" + ex.Message });
                }
            }
        }

        /* ---------------- 配置 ---------------- */

        private void DoGetPrefs()
        {
            var p = Path.Combine(Program.DataDir, "prefs.json");
            var text = File.Exists(p) ? File.ReadAllText(p, Encoding.UTF8) : "{}";
            Post(new { type = "prefs", json = text });
        }

        private void DoSetPrefs(string json)
        {
            try { File.WriteAllText(Path.Combine(Program.DataDir, "prefs.json"), json, new UTF8Encoding(false)); }
            catch (Exception ex) { Program.Log("prefs fail " + ex.Message); }
        }

        private void DoRecent(Dictionary<string, object> dict)
        {
            var p = Path.Combine(Program.DataDir, "recent.json");
            List<string> list = new List<string>();
            try
            {
                if (File.Exists(p))
                    list = _json.Deserialize<List<string>>(File.ReadAllText(p, Encoding.UTF8)) ?? new List<string>();
            }
            catch { }
            list = list.Where(File.Exists).ToList();

            if (Str(dict, "op") == "add")
            {
                var path = Str(dict, "path");
                list.RemoveAll(x => string.Equals(x, path, StringComparison.OrdinalIgnoreCase));
                list.Insert(0, path);
                if (list.Count > 12) list = list.Take(12).ToList();
                try { File.WriteAllText(p, _json.Serialize(list), new UTF8Encoding(false)); } catch { }
            }
            var items = list.Select(x => new
            {
                path = x,
                name = Path.GetFileName(x),
                dir = Path.GetDirectoryName(x)
            }).ToList();
            Post(new { type = "recent", items = items });
        }

        private void AddRecent(string path)
        {
            DoRecent(new Dictionary<string, object> { { "op", "add" }, { "path", path } });
        }

        /* ---------------- 系统 ---------------- */

private void OpenFolderPath(string path)
        {
            try
            {
                if (!string.IsNullOrEmpty(path) && Directory.Exists(path))
                    Process.Start("explorer.exe", "\"" + path + "\"");
            }
            catch { }
        }

        private void Reveal(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path)) return;
                if (File.Exists(path)) Process.Start("explorer.exe", "/select,\"" + path + "\"");
                else if (Directory.Exists(path)) Process.Start("explorer.exe", "\"" + path + "\"");
            }
            catch { }
        }

        private void OpenExternal(string url)
        {
            try
            {
                if (string.IsNullOrEmpty(url)) return;
                if (url.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) || url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
        }

        internal void OnF11()
        {
            ToggleFullscreen(_lastBorderless);
        }

        /// <summary>全屏：borderless=true 时去掉窗口边框并铺满整块屏幕（盖住任务栏）。</summary>
        private void ToggleFullscreen(bool borderless)
        {
            if (!_fullscreen)
            {
                _prevBorder = FormBorderStyle;
                _prevState = WindowState;
                _prevBounds = Bounds;

                WindowState = FormWindowState.Normal;
                if (borderless)
                {
                    FormBorderStyle = FormBorderStyle.None;
                    _prevTopMost = TopMost;
                    TopMost = true;              // 盖住任务栏
                    var screen = Screen.FromControl(this);
                    Bounds = screen.Bounds;
                }
                else
                {
                    WindowState = FormWindowState.Maximized;
                }
                _fullscreen = true;
            }
            else
            {
                WindowState = FormWindowState.Normal;
                TopMost = _prevTopMost;
                FormBorderStyle = _prevBorder;
                Bounds = _prevBounds;
                if (_prevState == FormWindowState.Maximized) WindowState = FormWindowState.Maximized;
                _fullscreen = false;
            }

            if (_web.CoreWebView2 != null)
            {
                try { _web.CoreWebView2.ExecuteScriptAsync("setTimeout(function(){window.dispatchEvent(new Event('resize'));},30)"); } catch { }
            }
            Program.Log("fullscreen on=" + _fullscreen + " borderless=" + borderless + " bounds=" + Bounds);
            Post(new { type = "fullscreen", on = _fullscreen, borderless = borderless });
        }
    }

    /// <summary>把本程序注册到「打开方式」列表（只写 HKCU，不需要管理员）。</summary>
    internal static class Assoc
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        private const uint SHCNE_ASSOCCHANGED = 0x08000000;

        /* 只有值真的变了才写，避免每次启动都触发资源管理器刷新 */
        private static bool SetIfChanged(Microsoft.Win32.RegistryKey key, string name, object value)
        {
            var cur = key.GetValue(name);
            if (value is byte[])
            {
                var b = cur as byte[];
                if (b != null && b.Length == 0) return false;
                key.SetValue(name, value, RegistryValueKind.Binary);
                return true;
            }
            if (cur != null && cur.ToString() == Convert.ToString(value)) return false;
            key.SetValue(name, value);
            return true;
        }

        internal static bool Register()
        {
            var changed = false;
            try
            {
                var exe = Application.ExecutablePath;
                var cmd = "\"" + exe + "\" \"%1\"";

                using (var prog = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Lanyu.md"))
                {
                    changed |= SetIfChanged(prog, null, "Markdown 文档");
                    using (var ico = prog.CreateSubKey("DefaultIcon")) changed |= SetIfChanged(ico, null, exe + ",0");
                    using (var c2 = prog.CreateSubKey(@"shell\open\command")) changed |= SetIfChanged(c2, null, cmd);
                }

                using (var app = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Applications\Lanyu.exe"))
                {
                    changed |= SetIfChanged(app, "FriendlyAppName", "Lanyu");
                    using (var ico = app.CreateSubKey("DefaultIcon")) changed |= SetIfChanged(ico, null, exe + ",0");
                    using (var c2 = app.CreateSubKey(@"shell\open\command")) changed |= SetIfChanged(c2, null, cmd);
                    using (var st = app.CreateSubKey("SupportedTypes"))
                    {
                        changed |= SetIfChanged(st, ".md", "");
                        changed |= SetIfChanged(st, ".markdown", "");
                        changed |= SetIfChanged(st, ".mdown", "");
                        changed |= SetIfChanged(st, ".txt", "");
                    }
                }

                foreach (var ext in new[] { ".md", ".markdown", ".mdown", ".txt" })
                {
                    using (var ow = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ext + @"\OpenWithProgids"))
                        changed |= SetIfChanged(ow, "Lanyu.md", new byte[0]);
                }

                // 让 .md 默认由我们打开（仅当没有指定过、或已经是我们时；不抢用户已有的选择）
                foreach (var ext in new[] { ".md", ".markdown", ".mdown" })
                {
                    using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ext))
                    {
                        var cur = k.GetValue(null) as string;
                        if (string.IsNullOrEmpty(cur) || cur == "Lanyu.md" || cur == "MarkEdit.md")
                            changed |= SetIfChanged(k, null, "Lanyu.md");
                    }
                }

                // 改名遗留：清掉旧的 MarkEdit.md / Applications\MarkEdit.exe
                foreach (var legacy in new[] { @"Software\Classes\MarkEdit.md", @"Software\Classes\Applications\MarkEdit.exe" })
                {
                    try
                    {
                        if (Registry.CurrentUser.OpenSubKey(legacy) != null)
                        {
                            Registry.CurrentUser.DeleteSubKeyTree(legacy, false);
                            changed = true;
                        }
                    }
                    catch { }
                }
                // 关键：只有真的改了才通知资源管理器，否则每次启动桌面图标都会重载一遍
                if (changed) SHChangeNotify(SHCNE_ASSOCCHANGED, 0, IntPtr.Zero, IntPtr.Zero);
                return true;
            }
            catch (Exception ex)
            {
                Program.Log("assoc fail: " + ex.Message);
                return false;
            }
        }

        /// <summary>强制把 .md/.markdown/.mdown 的默认程序设为 Lanyu（会清掉资源管理器的 UserChoice）。</summary>
        internal static bool ForceDefault()
        {
            try
            {
                foreach (var ext in new[] { ".md", ".markdown", ".mdown" })
                {
                    try
                    {
                        Registry.CurrentUser.DeleteSubKeyTree(
                            @"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\" + ext + @"\UserChoice", false);
                    }
                    catch { }
                    using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ext))
                        k.SetValue(null, "Lanyu.md");
                    using (var prog = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Lanyu.md\DefaultIcon"))
                        prog.SetValue(null, Application.ExecutablePath + ",0");
                }
                SHChangeNotify(SHCNE_ASSOCCHANGED, 0, IntPtr.Zero, IntPtr.Zero);
                return true;
            }
            catch (Exception ex)
            {
                Program.Log("force default fail: " + ex.Message);
                return false;
            }
        }
    }
    /// <summary>在消息泵层捕获 F11，避免被 WebView2 的浏览器加速键吃掉。</summary>
    internal sealed class F11Filter : IMessageFilter
    {
        private readonly MainForm _form;
        public F11Filter(MainForm form) { _form = form; }

        public bool PreFilterMessage(ref Message m)
        {
            const int WM_KEYDOWN = 0x0100;
            const int VK_F11 = 0x7A;
            if (m.Msg == WM_KEYDOWN && m.WParam.ToInt32() == VK_F11)
            {
                _form.OnF11();
                return true;
            }
            return false;
        }
    }
}