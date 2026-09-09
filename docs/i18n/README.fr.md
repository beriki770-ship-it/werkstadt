**[English](../../README.md) · [Deutsch](README.de.md) · [עברית](README.he.md) · Français · [Español](README.es.md) · [Português](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

Werkstadt lit les journaux de session que Claude Code écrit déjà sur ta machine dans `~/.claude/projects/**/*.jsonl`, et en dessine un monde en 3D que tu peux parcourir. Chaque projet devient une planète, une île, ou — au niveau le plus détaillé — une ville : une rue par session, un bâtiment par fichier. Le serveur est écrit en Python pur, sans dépendances, et tourne uniquement sur ta propre machine. Il n'y a aucune étape de build : tu modifies un fichier, tu recharges le navigateur. Licence Apache-2.0.

## Installation en 30 secondes

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 ou plus récent, aucun `pip install`, aucune étape de build. La deuxième ligne télécharge la bibliothèque de textures et modèles (environ 100 Mo) depuis la release ; sans elle, le monde s'ouvre quand même, juste sans textures.

## Confidentialité

Werkstadt tourne entièrement sur ta machine : un serveur Python lié à `127.0.0.1`, et une page de navigateur. Rien n'est envoyé en ligne, il n'y a ni compte ni télémétrie d'aucune sorte. Les journaux de session sont seulement lus, jamais modifiés, déplacés ou supprimés. Ils peuvent contenir des secrets et des chemins de fichiers — traite toute capture d'écran ou tout enregistrement en conséquence. Avec `"redact": true` dans `config.json` (ou l'option `--redact`), chaque nom de projet, de session et chaque chemin de fichier est remplacé par un pseudonyme stable avant même de quitter le serveur.

## Sponsoring & missions

**[♥ Sponsoriser Werkstadt](https://digital.wildmoments.at/werkstadt/#sponsor)** — le projet est construit et maintenu par un seul studio, et le sponsoring finance la prochaine étape.

Werkstadt a été construit par **Wild Digital Moments**, un studio web au Tyrol, en Autriche. Pour un projet du même genre — une page produit en 3D, un monde de données vivant, un modèle interactif d'une machine : https://digital.wildmoments.at/werkstadt/

La documentation complète est en anglais → [README.md](../../README.md)
