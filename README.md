# QuestionAI-extension

Detector de clickbait em tempo real (Chrome MV3). Fala com a `QuestionAI-api`.

## Install (dev)

1. Abra `chrome://extensions`, ative o modo desenvolvedor.
2. "Carregar sem compactação" → selecione esta pasta.

## Configure

No popup da extensão, ajuste a **URL da API** (padrão: produção no Render;
use `http://localhost:8000` para a API local). A escolha fica salva no
`chrome.storage`.

## API contract

- `GET /health`
- `POST /predict?headline=...&model=kmeans`

Resposta: `headline, is_clickbait, clickbait_status, probability, confidence, bait_type`.
