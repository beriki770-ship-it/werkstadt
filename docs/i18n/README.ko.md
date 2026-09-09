**[English](../../README.md) · [Deutsch](README.de.md) · [עברית](README.he.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · 한국어 · [हिन्दी](README.hi.md) · [العربية](README.ar.md)**

# Werkstadt

Werkstadt는 Claude Code가 이미 내 컴퓨터의 `~/.claude/projects/**/*.jsonl`에 기록해 둔 세션 로그를 읽어서, 날아다니며 둘러볼 수 있는 3D 세계로 그려냅니다. 각 프로젝트는 행성이 되거나, 섬이 되거나, 가장 자세한 단계에서는 도시가 됩니다 — 세션 하나가 거리 하나, 파일 하나가 건물 하나입니다. 서버는 순수 파이썬 표준 라이브러리로만 작성되어 의존성이 없고, 오직 내 컴퓨터에서만 실행됩니다. 빌드 단계는 없습니다 — 파일을 고치고 브라우저를 새로고침하면 끝입니다. 라이선스는 Apache-2.0입니다.

## 30초 설치

```
git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 이상이 필요하고, `pip install`도 빌드 단계도 없습니다. 두 번째 줄은 릴리스에서 약 100MB짜리 텍스처와 모델 라이브러리를 내려받습니다. 이 과정을 건너뛰어도 세계는 열리지만, 텍스처 없이 나옵니다.

## 개인정보 보호

Werkstadt는 전적으로 내 컴퓨터에서만 실행됩니다: `127.0.0.1`에 바인딩된 파이썬 서버와 브라우저 페이지 하나뿐입니다. 어디에도 업로드되지 않고, 계정도 없고, 어떤 종류의 텔레메트리도 없습니다. 세션 로그는 읽기 전용으로만 열리며, 프로그램이 그것을 수정하거나 옮기거나 지우는 일은 없습니다. 로그에는 비밀 정보와 파일 경로가 들어 있을 수 있으니, 스크린샷이나 녹화도 그에 맞게 다뤄야 합니다. `config.json`에서 `"redact": true`를 설정하거나 `--redact` 플래그를 쓰면, 모든 프로젝트 이름, 세션 이름, 파일 경로가 서버를 떠나기도 전에 고정된 가명으로 바뀝니다.

## 후원과 의뢰

**[♥ Werkstadt 후원하기](https://digital.wildmoments.at/werkstadt/#sponsor)** — 이 프로젝트는 하나의 스튜디오가 만들고 유지하고 있고, 후원금이 다음 단계의 개발 비용이 됩니다.

Werkstadt는 오스트리아 티롤의 웹 스튜디오 **Wild Digital Moments**가 만들었습니다. 비슷한 작업 — 3D 제품 페이지, 살아있는 데이터 세계, 기계의 인터랙티브 모델 — 이 필요하다면: https://digital.wildmoments.at/werkstadt/

전체 문서는 영어로 되어 있습니다 → [README.md](../../README.md)
