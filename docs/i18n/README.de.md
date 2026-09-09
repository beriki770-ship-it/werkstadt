**[English](../../README.md) · Deutsch · [עברית](README.he.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

Werkstadt liest die Sitzungsprotokolle, die Claude Code ohnehin auf deinem Rechner unter `~/.claude/projects/**/*.jsonl` speichert, und zeichnet daraus eine 3D-Welt zum Durchfliegen. Jedes Projekt wird ein Planet, eine Insel oder — am detailliertesten — eine Stadt: eine Straße pro Sitzung, ein Gebäude pro Datei. Der Server ist reines Python, ohne zusätzliche Pakete, und läuft ausschließlich auf deinem eigenen Rechner. Es gibt keinen Build-Schritt: Datei ändern, Browser neu laden. Lizenz: Apache-2.0.

## Installation in 30 Sekunden

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 oder neuer, kein `pip install`, kein Build-Schritt. Die zweite Zeile lädt die 100 MB große Asset-Bibliothek (Texturen, HDRIs, Modelle) aus dem Release herunter; ohne sie öffnet sich die Welt trotzdem, nur ohne Texturen.

## Datenschutz

Werkstadt läuft vollständig auf deinem eigenen Rechner: ein Python-Server, gebunden an `127.0.0.1`, dazu eine Browserseite. Nichts wird hochgeladen, es gibt kein Konto und keine Telemetrie jeglicher Art. Die Sitzungsprotokolle werden nur lesend geöffnet und nie verändert, verschoben oder gelöscht. Sie können Geheimnisse und Dateipfade enthalten — behandle jeden Screenshot oder jede Aufnahme entsprechend. Mit `"redact": true` in `config.json` (oder dem Flag `--redact`) wird jeder Projektname, jede Sitzung und jeder Dateipfad durch ein stabiles Pseudonym ersetzt, bevor er den Server überhaupt verlässt.

## Sponsoring & Auftrag

**[♥ Werkstadt sponsern](https://digital.wildmoments.at/werkstadt/#sponsor)** — das Projekt wird von einem einzelnen Studio gebaut und gepflegt, und Sponsoring finanziert die nächste Phase.

Werkstadt wurde von **Wild Digital Moments** gebaut, einem Webstudio in Tirol, Österreich. Für ein Projekt wie dieses — eine 3D-Produktseite, eine lebendige Datenwelt, ein interaktives Modell einer Maschine: https://digital.wildmoments.at/werkstadt/

Die vollständige Dokumentation ist auf Englisch → [README.md](../../README.md)
