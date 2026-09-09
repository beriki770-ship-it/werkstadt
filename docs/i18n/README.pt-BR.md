**[English](../../README.md) · [Deutsch](README.de.md) · [עברית](README.he.md) · [Français](README.fr.md) · [Español](README.es.md) · Português · [Italiano](README.it.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

O Werkstadt lê as transcrições de sessão que o Claude Code já grava na sua máquina em `~/.claude/projects/**/*.jsonl`, e transforma isso em um mundo 3D que você pode sobrevoar. Cada projeto vira um planeta, uma ilha ou — no nível mais detalhado — uma cidade: uma rua por sessão, um prédio por arquivo. O servidor é Python puro, sem dependências, e roda só na sua própria máquina. Não existe etapa de build: você edita um arquivo e recarrega o navegador. Licença Apache-2.0.

## Instalação em 30 segundos

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 ou mais novo, sem `pip install`, sem etapa de build. A segunda linha baixa a biblioteca de texturas e modelos (uns 100 MB) direto do release; sem ela o mundo abre do mesmo jeito, só que sem texturas.

## Privacidade

O Werkstadt roda inteiramente na sua máquina: um servidor Python preso a `127.0.0.1`, e uma página de navegador. Nada é enviado para a internet, não existe conta nem telemetria de nenhum tipo. As transcrições de sessão são só lidas, nunca modificadas, movidas ou apagadas. Elas podem conter segredos e caminhos de arquivo, então trate qualquer print ou gravação levando isso em conta. Com `"redact": true` no `config.json` (ou a flag `--redact`), todo nome de projeto, sessão e caminho de arquivo é trocado por um pseudônimo estável antes mesmo de sair do servidor.

## Patrocínio e contratação

**[♥ Patrocinar o Werkstadt](https://digital.wildmoments.at/werkstadt/#sponsor)** — o projeto é construído e mantido por um único estúdio, e o patrocínio é o que paga a próxima fase.

O Werkstadt foi construído pela **Wild Digital Moments**, um estúdio web no Tirol, Áustria. Para um projeto parecido — uma página de produto em 3D, um mundo de dados ao vivo, um modelo interativo de uma máquina: https://digital.wildmoments.at/werkstadt/

A documentação completa está em inglês → [README.md](../../README.md)
