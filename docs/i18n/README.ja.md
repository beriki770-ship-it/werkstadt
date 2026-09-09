**[English](../../README.md) · [Deutsch](README.de.md) · [עברית](README.he.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md) · 日本語 · [한국어](README.ko.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

Werkstadt は、Claude Code がすでに自分のマシン上の `~/.claude/projects/**/*.jsonl` に書き出しているセッション記録を読み取り、飛び回れる3Dの世界として描き出します。プロジェクトはそれぞれ惑星、島、あるいは最も詳細なレベルでは都市になります。1セッションが1本の通り、1ファイルが1棟の建物です。サーバーは Python 標準ライブラリのみで書かれていて依存パッケージはなく、自分のマシン上でのみ動きます。ビルド作業は一切不要です。ファイルを編集してブラウザを再読み込みするだけです。ライセンスは Apache-2.0。

## 30秒でインストール

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 以降が必要で、`pip install` もビルド作業も不要です。2行目はリリースから約100MBのテクスチャとモデルのライブラリをダウンロードします。これを省略しても世界は開きますが、テクスチャなしの状態になります。

## プライバシー

Werkstadt は完全に自分のマシン上で動きます。`127.0.0.1` にバインドされた Python サーバーと、ブラウザのページだけです。何もアップロードされず、アカウントもテレメトリも一切ありません。セッション記録は読み取り専用で開かれ、変更・移動・削除されることはありません。記録には秘密情報やファイルパスが含まれる可能性があるので、スクリーンショットや録画はそのつもりで扱ってください。`config.json` で `"redact": true` を設定するか `--redact` フラグを使うと、プロジェクト名、セッション名、ファイルパスがすべて、サーバーを出る前に一定の仮名に置き換えられます。

## スポンサーと依頼

**[♥ Werkstadt をスポンサーする](https://digital.wildmoments.at/werkstadt/#sponsor)** — このプロジェクトは一つのスタジオが構築・維持しており、スポンサー料が次の開発段階の資金になります。

Werkstadt は、オーストリア・チロル州のウェブスタジオ **Wild Digital Moments** が作りました。同じような案件——3Dの製品ページ、生きたデータの世界、機械のインタラクティブなモデルなど——のご相談はこちらへ:https://digital.wildmoments.at/werkstadt/

完全なドキュメントは英語です → [README.md](../../README.md)
