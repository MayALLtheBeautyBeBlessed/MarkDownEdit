# 第三方组件与许可

Lanyu 自身的代码（`src/`、`web/` 中除 `vendor/` 外的文件）采用 [MIT 许可](LICENSE)。

下面是随程序分发或依赖的第三方组件，各自的许可与归属如下。

## 随程序分发

### KaTeX 0.16.x

- 位置：`web/vendor/katex.js`、`web/vendor/katex.css`、`web/vendor/fonts/*.woff2`
- 许可：**MIT**
- 版权：Copyright (c) 2013-2020 Khan Academy and other contributors
- 完整许可文本：[`web/vendor/KaTeX-LICENSE.txt`](web/vendor/KaTeX-LICENSE.txt)
- 项目主页：<https://katex.org>

## 运行时依赖（不随包分发）

### Microsoft Edge WebView2

- 作用：承载界面渲染（HTML/JS 引擎）
- 分发方式：发布包里附带的是 WebView2 **SDK 的可再分发组件**（`Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.WinForms.dll`、`WebView2Loader.dll`），按 Microsoft 的可再分发条款提供
- 运行时本身（Edge WebView2 Runtime）**不打包**，由系统提供（Windows 11 / 已更新的 Windows 10 自带）
- 许可：Microsoft 软件许可条款 <https://learn.microsoft.com/microsoft-edge/webview2/>

### .NET Framework 4.x

- 作用：宿主程序（WinForms）
- 同样不打包运行时，使用系统自带的 .NET Framework 4.x

## 字体

程序界面只使用**系统已安装的字体**（`Cascadia Code`、`Consolas`、`JetBrains Mono`、`Microsoft YaHei UI` 等），不附带任何字体文件。

`web/vendor/fonts/` 里的字体文件属于 KaTeX（数学公式排版专用），随 KaTeX 以 MIT 许可分发。

## 关于「与其它 Markdown 编辑器相似」

Lanyu 的所有代码由本项目从零编写，没有复制任何其它编辑器的源代码、主题文件、图标或文案。

界面布局、快捷键、菜单结构与交互方式属于**通用功能与操作习惯**，不构成著作权意义上的复制；本项目也不使用任何其它产品的名称、标识或图标进行宣传。

文内出现的其它产品名称（例如 Typora）仅用于**说明交互方式**（如「所见即所得」「公式块编辑态」），不代表任何关联、赞助或背书。
