using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Web.Script.Serialization;

namespace Lanyu
{
    /// <summary>把 ExportModel（JS 生成的结构化文档）写成真正的 .docx。</summary>
    internal static class DocxExport
    {
        private const string NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        private const string NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

        private sealed class ImagePart
        {
            public string Rid;
            public string FileName;
            public byte[] Data;
            public int WidthPx;
            public int HeightPx;
            public string Ext;
        }

        private static readonly List<ImagePart> Images = new List<ImagePart>();
        private static readonly List<KeyValuePair<string, string>> Links = new List<KeyValuePair<string, string>>();
        private static readonly List<int> OrderedNums = new List<int>();
        private static int _drawingId;

        public static void Write(string path, Dictionary<string, object> model, string baseDir)
        {
            Images.Clear();
            Links.Clear();
            OrderedNums.Clear();
            _drawingId = 0;

            var body = new StringBuilder();
            var blocks = AsList(Get(model, "blocks"));
            foreach (var node in blocks)
            {
                var b = node as Dictionary<string, object>;
                if (b == null) continue;
                var t = Str(b, "t");
                try
                {
                    switch (t)
                    {
                        case "h": WriteParagraph(body, AsList(Get(b, "runs")), "Heading" + Math.Min(6, Math.Max(1, Int(b, "level", 1))), null); break;
                        case "p": WriteParagraph(body, AsList(Get(b, "runs")), null, null); break;
                        case "quote": WriteParagraph(body, AsList(Get(b, "runs")), "Quote", null); break;
                        case "code": WriteCode(body, AsList(Get(b, "lines"))); break;
                        case "list": WriteList(body, AsList(Get(b, "items"))); break;
                        case "table": WriteTable(body, b, baseDir); break;
                        case "img": WriteImageParagraph(body, Str(b, "src"), Str(b, "alt"), Int(b, "width", 0), baseDir); break;
                        case "math": WriteParagraph(body, new List<object> { new Dictionary<string, object> { { "x", Str(b, "tex") }, { "c", 1 } } }, "MathBlock", null); break;
                        case "hr": body.Append("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"D0D7DE\"/></w:pBdr></w:pPr></w:p>"); break;
                    }
                }
                catch (Exception ex)
                {
                    Program.Log("docx block fail " + t + ": " + ex.Message);
                }
            }

            body.Append("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/>");
            body.Append("<w:pgMar w:top=\"1440\" w:right=\"1418\" w:bottom=\"1440\" w:left=\"1418\" w:header=\"851\" w:footer=\"992\" w:gutter=\"0\"/>");
            body.Append("</w:sectPr>");

            using (var fs = File.Create(path))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                AddText(zip, "[Content_Types].xml", ContentTypes());
                AddText(zip, "_rels/.rels", RootRels());
                AddText(zip, "docProps/core.xml", CoreProps());
                AddText(zip, "docProps/app.xml", AppProps());
                AddText(zip, "word/styles.xml", Styles());
                AddText(zip, "word/numbering.xml", Numbering());
                AddText(zip, "word/document.xml", DocumentXml(body));
                AddText(zip, "word/_rels/document.xml.rels", DocRels());
                foreach (var img in Images) AddBinary(zip, "word/media/" + img.FileName, img.Data);
            }
        }

        /* ---------------- 部件 ---------------- */

        private static string ContentTypes()
        {
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
            sb.Append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>");
            sb.Append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
            sb.Append("<Default Extension=\"png\" ContentType=\"image/png\"/>");
            sb.Append("<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>");
            sb.Append("<Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>");
            sb.Append("<Default Extension=\"gif\" ContentType=\"image/gif\"/>");
            sb.Append("<Default Extension=\"bmp\" ContentType=\"image/bmp\"/>");
            sb.Append("<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>");
            sb.Append("<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>");
            sb.Append("<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>");
            sb.Append("<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>");
            sb.Append("<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>");
            sb.Append("</Types>");
            return sb.ToString();
        }

        private static string RootRels()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                   "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                   "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
                   "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
                   "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>" +
                   "</Relationships>";
        }

        private static string DocRels()
        {
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
            sb.Append("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>");
            sb.Append("<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering\" Target=\"numbering.xml\"/>");
            foreach (var img in Images)
                sb.Append("<Relationship Id=\"" + img.Rid + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/" + img.FileName + "\"/>");
            foreach (var link in Links)
                sb.Append("<Relationship Id=\"" + link.Value + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"" + Esc(link.Key) + "\" TargetMode=\"External\"/>");
            sb.Append("</Relationships>");
            return sb.ToString();
        }

        private static string CoreProps()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                   "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
                   "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" " +
                   "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
                   "<dc:creator>Lanyu</dc:creator><cp:lastModifiedBy>Lanyu</cp:lastModifiedBy>" +
                   "<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ") + "</dcterms:created>" +
                   "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ") + "</dcterms:modified>" +
                   "</cp:coreProperties>";
        }

        private static string AppProps()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                   "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\">" +
                   "<Application>Lanyu</Application><AppVersion>1.2</AppVersion></Properties>";
        }

        private static string Styles()
        {
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<w:styles xmlns:w=\"" + NS_W + "\">");
            sb.Append("<w:docDefaults><w:rPrDefault><w:rPr>");
            sb.Append("<w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:eastAsia=\"Microsoft YaHei\" w:cs=\"Calibri\"/>");
            sb.Append("<w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:color w:val=\"24292F\"/>");
            sb.Append("</w:rPr></w:rPrDefault>");
            sb.Append("<w:pPrDefault><w:pPr><w:spacing w:before=\"0\" w:after=\"140\" w:line=\"300\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault>");
            sb.Append("</w:docDefaults>");
            sb.Append("<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>");

            int[] sizes = { 40, 32, 28, 24, 22, 21 };
            for (int i = 0; i < sizes.Length; i++)
            {
                sb.Append("<w:style w:type=\"paragraph\" w:styleId=\"Heading" + (i + 1) + "\">");
                sb.Append("<w:name w:val=\"heading " + (i + 1) + "\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/>");
                sb.Append("<w:pPr><w:keepNext/><w:spacing w:before=\"" + (i < 2 ? 360 : 280) + "\" w:after=\"120\"/><w:outlineLvl w:val=\"" + i + "\"/></w:pPr>");
                sb.Append("<w:rPr><w:b/><w:bCs/><w:sz w:val=\"" + sizes[i] + "\"/><w:szCs w:val=\"" + sizes[i] + "\"/></w:rPr>");
                sb.Append("</w:style>");
            }

            sb.Append("<w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/>");
            sb.Append("<w:pPr><w:ind w:left=\"480\" w:right=\"240\"/><w:pBdr><w:left w:val=\"single\" w:sz=\"18\" w:space=\"12\" w:color=\"D0D7DE\"/></w:pBdr></w:pPr>");
            sb.Append("<w:rPr><w:color w:val=\"57606A\"/></w:rPr></w:style>");

            sb.Append("<w:style w:type=\"paragraph\" w:styleId=\"CodeBlock\"><w:name w:val=\"Code Block\"/><w:basedOn w:val=\"Normal\"/>");
            sb.Append("<w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F6F8FA\"/></w:pPr>");
            sb.Append("<w:rPr><w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:eastAsia=\"Consolas\"/><w:sz w:val=\"18\"/><w:color w:val=\"24292F\"/></w:rPr></w:style>");

            sb.Append("<w:style w:type=\"paragraph\" w:styleId=\"MathBlock\"><w:name w:val=\"Math Block\"/><w:basedOn w:val=\"Normal\"/>");
            sb.Append("<w:pPr><w:jc w:val=\"center\"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>");

            sb.Append("<w:style w:type=\"character\" w:styleId=\"VerbatimChar\"><w:name w:val=\"Verbatim Char\"/>");
            sb.Append("<w:rPr><w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/><w:sz w:val=\"19\"/><w:color w:val=\"B5326A\"/></w:rPr></w:style>");

            sb.Append("</w:styles>");
            return sb.ToString();
        }

        private static string Numbering()
        {
            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<w:numbering xmlns:w=\"" + NS_W + "\">");

            // 无序：1 = bullet
            sb.Append("<w:abstractNum w:abstractNumId=\"1\"><w:multiLevelType w:val=\"hybridMultilevel\"/>");
            string[] bullets = { "•", "◦", "▪", "•" };
            for (int lvl = 0; lvl < 4; lvl++)
            {
                sb.Append("<w:lvl w:ilvl=\"" + lvl + "\"><w:start w:val=\"1\"/><w:numFmt w:val=\"bullet\"/>");
                sb.Append("<w:lvlText w:val=\"" + bullets[lvl] + "\"/><w:lvlJc w:val=\"left\"/>");
                sb.Append("<w:pPr><w:ind w:left=\"" + (420 + lvl * 420) + "\" w:hanging=\"420\"/></w:pPr>");
                sb.Append("<w:rPr><w:rFonts w:ascii=\"Symbol\" w:hAnsi=\"Symbol\" w:hint=\"default\"/></w:rPr></w:lvl>");
            }
            sb.Append("</w:abstractNum>");

            // 有序：2 = decimal
            sb.Append("<w:abstractNum w:abstractNumId=\"2\"><w:multiLevelType w:val=\"hybridMultilevel\"/>");
            for (int lvl = 0; lvl < 4; lvl++)
            {
                sb.Append("<w:lvl w:ilvl=\"" + lvl + "\"><w:start w:val=\"1\"/><w:numFmt w:val=\"decimal\"/>");
                sb.Append("<w:lvlText w:val=\"%" + (lvl + 1) + ".\"/><w:lvlJc w:val=\"left\"/>");
                sb.Append("<w:pPr><w:ind w:left=\"" + (420 + lvl * 420) + "\" w:hanging=\"420\"/></w:pPr></w:lvl>");
            }
            sb.Append("</w:abstractNum>");

            sb.Append("<w:num w:numId=\"1\"><w:abstractNumId w:val=\"1\"/></w:num>");
            sb.Append("<w:num w:numId=\"2\"><w:abstractNumId w:val=\"2\"/></w:num>");
            foreach (var id in OrderedNums)
                sb.Append("<w:num w:numId=\"" + id + "\"><w:abstractNumId w:val=\"2\"/><w:lvlOverride w:ilvl=\"0\"><w:startOverride w:val=\"1\"/></w:lvlOverride></w:num>");
            sb.Append("</w:numbering>");
            return sb.ToString();
        }

        private static string DocumentXml(StringBuilder body)
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                   "<w:document xmlns:w=\"" + NS_W + "\" xmlns:r=\"" + NS_R + "\" " +
                   "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" " +
                   "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" " +
                   "xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">" +
                   "<w:body>" + body + "</w:body></w:document>";
        }

        /* ---------------- 内容 ---------------- */

        private static void WriteParagraph(StringBuilder sb, List<object> runs, string style, string extraPPr)
        {
            sb.Append("<w:p><w:pPr>");
            if (style != null) sb.Append("<w:pStyle w:val=\"" + style + "\"/>");
            if (extraPPr != null) sb.Append(extraPPr);
            sb.Append("</w:pPr>");
            WriteRuns(sb, runs);
            sb.Append("</w:p>");
        }

        private static void WriteRuns(StringBuilder sb, List<object> runs)
        {
            foreach (var r in runs)
            {
                var d = r as Dictionary<string, object>;
                if (d == null) continue;
                var text = Str(d, "x");
                if (string.IsNullOrEmpty(text)) continue;

                bool bold = IsTrue(d, "b"), italic = IsTrue(d, "i"), strike = IsTrue(d, "s"), code = IsTrue(d, "c");
                var link = Str(d, "link");
                var rPr = new StringBuilder();
                if (bold) rPr.Append("<w:b/><w:bCs/>");
                if (italic) rPr.Append("<w:i/><w:iCs/>");
                if (strike) rPr.Append("<w:strike/>");
                if (code) rPr.Append("<w:rStyle w:val=\"VerbatimChar\"/>");
                if (link != null && link.Length > 0)
                    rPr.Append("<w:color w:val=\"0969DA\"/><w:u w:val=\"single\"/>");

                var run = "<w:r>" + (rPr.Length > 0 ? "<w:rPr>" + rPr + "</w:rPr>" : "") +
                          "<w:t xml:space=\"preserve\">" + Esc(text) + "</w:t></w:r>";

                if (link != null && link.Length > 0)
                {
                    var rid = LinkRid(link);
                    sb.Append("<w:hyperlink r:id=\"" + rid + "\">" + run + "</w:hyperlink>");
                }
                else sb.Append(run);
            }
        }

        private static void WriteCode(StringBuilder sb, List<object> lines)
        {
            if (lines.Count == 0) lines.Add("");
            foreach (var l in lines)
            {
                var text = l == null ? "" : Convert.ToString(l);
                sb.Append("<w:p><w:pPr><w:pStyle w:val=\"CodeBlock\"/></w:pPr><w:r><w:rPr><w:rStyle w:val=\"VerbatimChar\"/><w:color w:val=\"24292F\"/></w:rPr>");
                sb.Append("<w:t xml:space=\"preserve\">" + Esc(text) + "</w:t></w:r></w:p>");
            }
        }

        private static void WriteList(StringBuilder sb, List<object> items)
        {
            int orderedNumId = 0;
            foreach (var it in items)
            {
                var d = it as Dictionary<string, object>;
                if (d == null) continue;
                int level = Math.Min(3, Math.Max(0, Int(d, "level", 0)));
                bool ordered = IsTrue(d, "ordered");
                if (ordered && orderedNumId == 0) { orderedNumId = 10 + OrderedNums.Count; OrderedNums.Add(orderedNumId); }
                int numId = ordered ? orderedNumId : 1;
                sb.Append("<w:p><w:pPr><w:pStyle w:val=\"Normal\"/>");
                sb.Append("<w:numPr><w:ilvl w:val=\"" + level + "\"/><w:numId w:val=\"" + numId + "\"/></w:numPr>");
                sb.Append("<w:spacing w:after=\"60\"/></w:pPr>");
                WriteRuns(sb, AsList(Get(d, "runs")));
                sb.Append("</w:p>");
            }
        }

        private static void WriteTable(StringBuilder sb, Dictionary<string, object> b, string baseDir)
        {
            var header = AsList(Get(b, "header"));
            var rows = AsList(Get(b, "rows"));
            var aligns = AsList(Get(b, "aligns"));
            int cols = Math.Max(1, header.Count);
            if (cols == 0 && rows.Count > 0)
            {
                var first = AsList(rows[0]);
                cols = Math.Max(1, first.Count);
            }
            const int totalWidth = 9026;
            int colW = totalWidth / cols;

            sb.Append("<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>");
            sb.Append("<w:tblBorders>");
            foreach (var side in new[] { "top", "left", "bottom", "right", "insideH", "insideV" })
                sb.Append("<w:" + side + " w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"D0D7DE\"/>");
            sb.Append("</w:tblBorders>");
            sb.Append("<w:tblCellMar><w:top w:w=\"72\" w:type=\"dxa\"/><w:left w:w=\"108\" w:type=\"dxa\"/><w:bottom w:w=\"72\" w:type=\"dxa\"/><w:right w:w=\"108\" w:type=\"dxa\"/></w:tblCellMar>");
            sb.Append("</w:tblPr><w:tblGrid>");
            for (int i = 0; i < cols; i++) sb.Append("<w:gridCol w:w=\"" + colW + "\"/>");
            sb.Append("</w:tblGrid>");

            WriteRow(sb, header, cols, colW, aligns, true);
            foreach (var r in rows)
                WriteRow(sb, AsList(r), cols, colW, aligns, false);
            sb.Append("</w:tbl>");

            // 表格后补一个空段落，避免 Word 里表格紧贴下一段
            sb.Append("<w:p><w:pPr><w:spacing w:after=\"80\"/></w:pPr></w:p>");
        }

        private static void WriteRow(StringBuilder sb, List<object> cells, int cols, int colW, List<object> aligns, bool header)
        {
            sb.Append("<w:tr>");
            if (header) sb.Append("<w:trPr><w:tblHeader/></w:trPr>");
            for (int i = 0; i < cols; i++)
            {
                sb.Append("<w:tc><w:tcPr><w:tcW w:w=\"" + colW + "\" w:type=\"dxa\"/>");
                if (header) sb.Append("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F2F4F7\"/>");
                sb.Append("</w:tcPr><w:p><w:pPr><w:spacing w:before=\"20\" w:after=\"20\"/>");
                var align = i < aligns.Count ? Convert.ToString(aligns[i]) : "left";
                if (align == "center") sb.Append("<w:jc w:val=\"center\"/>");
                else if (align == "right") sb.Append("<w:jc w:val=\"right\"/>");
                sb.Append("</w:pPr>");
                var runs = i < cells.Count ? AsList(cells[i]) : new List<object>();
                if (header)
                {
                    foreach (var r in runs)
                    {
                        var d = r as Dictionary<string, object>;
                        if (d != null) d["b"] = 1;
                    }
                }
                WriteRuns(sb, runs);
                sb.Append("</w:p></w:tc>");
            }
            sb.Append("</w:tr>");
        }

        private static void WriteImageParagraph(StringBuilder sb, string src, string alt, int widthPx, string baseDir)
        {
            var img = LoadImage(src, baseDir);
            if (img == null) return;

            int wpx = widthPx > 0 ? widthPx : img.WidthPx;
            int hpx = (int)Math.Round(img.HeightPx * (double)wpx / Math.Max(1, img.WidthPx));

            const int maxEmu = 9026 * 635;          // A4 可用宽度
            long cx = wpx * 9525L, cy = hpx * 9525L;
            if (cx > maxEmu)
            {
                cy = cy * maxEmu / cx;
                cx = maxEmu;
            }

            _drawingId++;
            sb.Append("<w:p><w:pPr><w:jc w:val=\"center\"/><w:spacing w:before=\"120\" w:after=\"120\"/></w:pPr><w:r><w:drawing>");
            sb.Append("<wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">");
            sb.Append("<wp:extent cx=\"" + cx + "\" cy=\"" + cy + "\"/>");
            sb.Append("<wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>");
            sb.Append("<wp:docPr id=\"" + _drawingId + "\" name=\"Picture " + _drawingId + "\" descr=\"" + Esc(alt ?? "") + "\"/>");
            sb.Append("<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>");
            sb.Append("<a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">");
            sb.Append("<pic:pic><pic:nvPicPr><pic:cNvPr id=\"" + _drawingId + "\" name=\"" + Esc(img.FileName) + "\"/><pic:cNvPicPr/></pic:nvPicPr>");
            sb.Append("<pic:blipFill><a:blip r:embed=\"" + img.Rid + "\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>");
            sb.Append("<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"" + cx + "\" cy=\"" + cy + "\"/></a:xfrm>");
            sb.Append("<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>");
            sb.Append("</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>");
        }

        private static ImagePart LoadImage(string src, string baseDir)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(src)) return null;
                var existing = Images.Find(i => string.Equals(i.FileName, src, StringComparison.OrdinalIgnoreCase));
                byte[] data = null;
                string ext = "png";

                if (src.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    var idx = src.IndexOf(',');
                    if (idx < 0) return null;
                    var meta = src.Substring(0, idx);
                    data = Convert.FromBase64String(src.Substring(idx + 1));
                    if (meta.Contains("jpeg")) ext = "jpg";
                    else if (meta.Contains("gif")) ext = "gif";
                }
                else
                {
                    var path = src;
                    if (!Path.IsPathRooted(path)) path = Path.Combine(baseDir ?? "", src.Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(path)) return null;
                    data = File.ReadAllBytes(path);
                    ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
                    if (ext == "jpeg") ext = "jpg";
                }

                if (ext != "png" && ext != "jpg" && ext != "gif")
                {
                    data = ToPng(data);
                    ext = "png";
                }

                int w, h;
                using (var ms = new MemoryStream(data))
                using (var bmp = Image.FromStream(ms))
                {
                    w = bmp.Width; h = bmp.Height;
                }

                var part = new ImagePart
                {
                    Rid = "rId" + (100 + Images.Count),
                    FileName = "image" + (Images.Count + 1) + "." + ext,
                    Data = data,
                    WidthPx = w,
                    HeightPx = h,
                    Ext = ext
                };
                Images.Add(part);
                return part;
            }
            catch (Exception ex)
            {
                Program.Log("image fail " + src + ": " + ex.Message);
                return null;
            }
        }

        private static byte[] ToPng(byte[] data)
        {
            using (var input = new MemoryStream(data))
            using (var img = Image.FromStream(input))
            using (var output = new MemoryStream())
            {
                img.Save(output, ImageFormat.Png);
                return output.ToArray();
            }
        }

        private static string LinkRid(string url)
        {
            foreach (var kv in Links) if (kv.Key == url) return kv.Value;
            var rid = "rId" + (500 + Links.Count);
            Links.Add(new KeyValuePair<string, string>(url, rid));
            return rid;
        }

        /* ---------------- 工具 ---------------- */

        private static void AddText(ZipArchive zip, string name, string text)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
            using (var s = entry.Open())
            {
                var bytes = new UTF8Encoding(false).GetBytes(text);
                s.Write(bytes, 0, bytes.Length);
            }
        }

        private static void AddBinary(ZipArchive zip, string name, byte[] data)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
            using (var s = entry.Open()) s.Write(data, 0, data.Length);
        }

        private static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
        }

        private static object Get(Dictionary<string, object> d, string k)
        {
            object v; return d != null && d.TryGetValue(k, out v) ? v : null;
        }

        private static string Str(Dictionary<string, object> d, string k)
        {
            var v = Get(d, k); return v == null ? "" : Convert.ToString(v);
        }

        private static bool IsTrue(Dictionary<string, object> d, string k)
        {
            var v = Get(d, k);
            if (v == null) return false;
            if (v is bool) return (bool)v;
            return Convert.ToString(v) == "1" || Convert.ToString(v).ToLowerInvariant() == "true";
        }

        private static int Int(Dictionary<string, object> d, string k, int def)
        {
            var v = Get(d, k);
            if (v == null) return def;
            try { return Convert.ToInt32(v, CultureInfo.InvariantCulture); } catch { return def; }
        }

        private static List<object> AsList(object o)
        {
            var list = new List<object>();
            var arr = o as IEnumerable;
            if (arr == null || o is string) return list;
            foreach (var x in arr) list.Add(x);
            return list;
        }
    }
}
