# 澜汐的写作手册

> 
> 傲娇是壳，温柔是核。写东西也一样——先把话说漂亮，再让人看见里面的东西。

这是一份用来测试 **MarkEdit** 渲染效果的示例文档，顺便当作说明书。它覆盖了你会用到的绝大多数语法。

## 基础排版

普通段落里可以写 *斜体*、**加粗**、***加粗斜体***、~~删除线~~、`行内代码`，还有 ==高亮标记==。

需要换行时直接回车即可（可在设置里关掉）。链接写成 [AstrBot 文档](https://docs.astrbot.app)，裸链接也能识别：https://github.com

---

## 列表

1. 有序列表第一项
2. 第二项，里面还能嵌：
  - 无序子项 A
  - 无序子项 B
3. 第三项

- [x] 已完成的任务
- [ ] 还没做的任务
- [ ] 点一下复选框，源码里的 `[ ]` 会同步变化

## 表格

| 功能 | 快捷键 | 备注 |
| :--- | :---: | ---: |
| 保存 | Ctrl+S | 自动写盘 |
| 另存为 | Ctrl+Shift+S | 选择路径 |
| 查找 | Ctrl+F | 支持替换 |
| 切换视图 | Ctrl+1/2/3 | 双栏 / 源码 / 阅读 |

## 图片

点一下图片，右下角会出现手柄，拖动即可改变宽度（会写回源码里的 `width`）。

![](assets/demo.png)

## 代码

def whale\_song(pitch: float = 0.42) -> str:
    """鲸歌：低频、绵长，能传很远。"""
    notes = \[pitch \* (1 + i / 12) for i in range(7)\]
    return "~".join(f"{n:.2f}Hz" for n in notes)


if \_\_name\_\_ == "\_\_main\_\_":
    print(whale\_song())  # 42.00Hz~45.50Hz~...

.preview h2 {
  font-size: 1.5em;
  border-bottom: 1px solid var(--border);
  padding-bottom: .24em;
}

# 看一眼目录结构

```
ls -la ~/.astrbot\_launcher/instances
```

## 引用与公式

> 
> 她说：「谁要陪你去啊。」
> （尾鳍却悄悄勾住了你的袖子。）

行内公式可以写 ∫0T​vdt，也可以写 eiπ+1=0。

行间公式：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

$$
\mathbf{F} = m\frac{d^2\mathbf{x}}{dt^2}, \qquad
\nabla \times \mathbf{B} = \mu_0\mathbf{J} + \mu_0\varepsilon_0\frac{\partial \mathbf{E}}{\partial t}
$$

## 收尾

写完之后：

1. `Ctrl+S` 保存
2. 右上角导出 → **导出 PDF**
3. 或者直接拖到任何支持 Markdown 的地方

祝你写得顺手。