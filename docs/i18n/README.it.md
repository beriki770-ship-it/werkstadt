**[English](../../README.md) · [Deutsch](README.de.md) · [עברית](README.he.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · Italiano · [Русский](README.ru.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

Werkstadt legge le trascrizioni di sessione che Claude Code scrive già sul tuo computer in `~/.claude/projects/**/*.jsonl`, e le trasforma in un mondo 3D da esplorare volando. Ogni progetto diventa un pianeta, un'isola o — al livello più dettagliato — una città: una strada per sessione, un edificio per file. Il server è scritto in solo Python, senza dipendenze, e gira esclusivamente sul tuo computer. Non c'è nessuna fase di build: modifichi un file e ricarichi il browser. Licenza Apache-2.0.

## Installazione in 30 secondi

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 o più recente, nessun `pip install`, nessuna fase di build. La seconda riga scarica la libreria di texture e modelli (circa 100 MB) dalla release; senza di essa il mondo si apre comunque, solo senza texture.

## Privacy

Werkstadt gira interamente sul tuo computer: un server Python legato a `127.0.0.1`, e una pagina del browser. Niente viene caricato online, non c'è account né telemetria di alcun tipo. Le trascrizioni di sessione vengono solo lette, mai modificate, spostate o cancellate. Possono contenere segreti e percorsi di file, quindi tratta ogni screenshot o registrazione di conseguenza. Con `"redact": true` in `config.json` (o il flag `--redact`), ogni nome di progetto, sessione e percorso di file viene sostituito con uno pseudonimo stabile prima ancora di lasciare il server.

## Sponsorizzazione e lavoro

**[♥ Sponsorizza Werkstadt](https://digital.wildmoments.at/werkstadt/#sponsor)** — il progetto è costruito e mantenuto da un unico studio, e la sponsorizzazione finanzia la fase successiva.

Werkstadt è stato costruito da **Wild Digital Moments**, uno studio web in Tirolo, Austria. Per un progetto simile — una pagina prodotto in 3D, un mondo di dati dal vivo, un modello interattivo di una macchina: https://digital.wildmoments.at/werkstadt/

La documentazione completa è in inglese → [README.md](../../README.md)
