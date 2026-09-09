**[English](../../README.md) · [Deutsch](README.de.md) · [עברית](README.he.md) · [Français](README.fr.md) · Español · [Português](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

Werkstadt lee las transcripciones de sesión que Claude Code ya escribe en tu máquina en `~/.claude/projects/**/*.jsonl`, y las convierte en un mundo en 3D que puedes recorrer volando. Cada proyecto se convierte en un planeta, una isla o —con más detalle— una ciudad: una calle por sesión, un edificio por archivo. El servidor está escrito solo con Python, sin dependencias, y corre únicamente en tu propia máquina. No hay paso de compilación: editas un archivo y recargas el navegador. Licencia Apache-2.0.

## Instalación en 30 segundos

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 o más nuevo, sin `pip install`, sin paso de compilación. La segunda línea descarga la biblioteca de texturas y modelos (unos 100 MB) desde la release; sin ella, el mundo igual se abre, solo que sin texturas.

## Privacidad

Werkstadt corre por completo en tu máquina: un servidor Python vinculado a `127.0.0.1`, y una página de navegador. Nada se sube a internet, no hay cuenta ni telemetría de ningún tipo. Las transcripciones de sesión se leen sin modificarlas, moverlas ni borrarlas nunca. Pueden contener secretos y rutas de archivos, así que trata cualquier captura de pantalla o grabación en consecuencia. Con `"redact": true` en `config.json` (o la opción `--redact`), cada nombre de proyecto, sesión y ruta de archivo se reemplaza por un seudónimo estable antes de que salga del servidor.

## Patrocinio y contratación

**[♥ Patrocinar Werkstadt](https://digital.wildmoments.at/werkstadt/#sponsor)** — el proyecto lo construye y mantiene un solo estudio, y el patrocinio paga la siguiente fase.

Werkstadt fue construido por **Wild Digital Moments**, un estudio web en Tirol, Austria. Para un proyecto parecido —una página de producto en 3D, un mundo de datos en vivo, un modelo interactivo de una máquina—: https://digital.wildmoments.at/werkstadt/

La documentación completa está en inglés → [README.md](../../README.md)
