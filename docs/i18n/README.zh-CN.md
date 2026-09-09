**[English](../../README.md) · [Deutsch](README.de.md) · [עברית](README.he.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · 中文 · [日本語](README.ja.md) · [한국어](README.ko.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

Werkstadt 读取 Claude Code 已经写在你电脑上的会话记录（路径是 `~/.claude/projects/**/*.jsonl`），把它们画成一个可以飞进去的三维世界。每个项目会变成一颗星球、一座岛屿,或者——最详细的情况下——一座城市:一次会话一条街,一个文件一栋楼。服务端只用 Python 标准库写成,没有任何依赖,只在你自己的电脑上运行。没有构建步骤:改个文件,刷新浏览器就行。许可证是 Apache-2.0。

## 30 秒安装

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

需要 Python 3.9 或更新版本,不用 `pip install`,没有构建步骤。第二行会从发布版下载贴图和模型库(大约 100 MB);不下载世界也照样打开,只是没有贴图。

## 隐私

Werkstadt 完全运行在你自己的电脑上:一个绑定在 `127.0.0.1` 的 Python 服务端,加一个浏览器页面。没有任何东西会上传,没有账号,也没有任何形式的遥测。会话记录只被读取,程序从不修改、移动或删除它们。这些记录可能包含密钥和文件路径,所以任何截图或录屏都要相应处理。在 `config.json` 里设置 `"redact": true`(或者用 `--redact` 参数),每个项目名、会话名和文件路径在离开服务端之前就会被替换成一个固定的假名。

## 赞助与合作

**[♥ 赞助 Werkstadt](https://digital.wildmoments.at/werkstadt/#sponsor)** —— 这个项目由一家工作室独立构建和维护,赞助资金用来支持下一阶段的开发。

Werkstadt 由 **Wild Digital Moments** 制作,一家位于奥地利蒂罗尔州的网页工作室。如果你想要类似的项目——三维产品页面、实时数据世界、机器的交互式模型:https://digital.wildmoments.at/werkstadt/

完整文档为英文 → [README.md](../../README.md)
