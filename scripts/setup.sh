#!/usr/bin/env bash
# Instala todo lo necesario para Enhancer. Idempotente: lo que ya está, se salta.
#
#   bash scripts/setup.sh           # instalar / completar lo que falte
#   bash scripts/setup.sh --check   # solo revisar, sin cambiar nada
#
# Requisitos del sistema (no se instalan solos porque necesitan sudo):
#   Python 3.10 (python3.10 + python3.10-venv), ffmpeg, Node.js >= 20, driver NVIDIA (opcional).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

VENV="$ROOT/venv"
PY="$VENV/bin/python"
MODEL_DIR="$ROOT/modelos/resemble-enhance"
MODEL_FILE="$MODEL_DIR/enhancer_stage2/ds/G/default/mp_rank_00_model_states.pt"
TORCH_VERSION="2.1.1"          # fijo: resemble-enhance 0.0.1 lo requiere
TORCHAUDIO_VERSION="2.1.1"
TORCHVISION_VERSION="0.16.1"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
todo() { printf '  \033[33m•\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
PENDING=0
need() { # $1 = descripción; ejecuta el resto como comando salvo en --check
  local what="$1"; shift
  if [[ $CHECK -eq 1 ]]; then todo "falta: $what"; PENDING=$((PENDING + 1)); return 0; fi
  todo "$what…"; "$@"; ok "$what"
}

step "1. Requisitos del sistema"
MISSING=0
if command -v python3.10 >/dev/null; then ok "Python 3.10 ($(command -v python3.10))"; else err "Falta Python 3.10: sudo apt install python3.10 python3.10-venv"; MISSING=1; fi
if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"; else err "Falta ffmpeg: sudo apt install ffmpeg"; MISSING=1; fi
if command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then ok "Node $(node -v)"; else err "Falta Node.js >= 20 (recomendado con nvm)"; MISSING=1; fi
if command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then
  GPU="cu121"; ok "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
else
  GPU="cpu"; todo "Sin GPU NVIDIA: se instalará torch para CPU (mucho más lento)"
fi
if [[ $MISSING -eq 1 ]]; then err "Instala lo que falta y vuelve a ejecutar este script."; exit 1; fi

step "2. Entorno de Python (venv/)"
if [[ -x "$PY" ]]; then ok "venv existe ($($PY --version))"; else need "crear venv con Python 3.10" python3.10 -m venv "$VENV"; fi
if [[ -x "$PY" ]]; then
  CUR_TORCH="$("$PY" -c 'import torch; print(torch.__version__)' 2>/dev/null || true)"
  if [[ "$CUR_TORCH" == "$TORCH_VERSION"* ]]; then
    ok "torch $CUR_TORCH"
  else
    need "instalar torch $TORCH_VERSION ($GPU)" bash -c "
      '$PY' -m pip install --upgrade pip &&
      '$PY' -m pip install torch==$TORCH_VERSION torchaudio==$TORCHAUDIO_VERSION torchvision==$TORCHVISION_VERSION \
        --index-url https://download.pytorch.org/whl/$GPU"
  fi
  if "$PY" -c 'import resemble_enhance, huggingface_hub' 2>/dev/null; then
    ok "resemble-enhance y huggingface_hub"
  else
    need "instalar resemble-enhance (engine/requirements.txt)" "$PY" -m pip install -r engine/requirements.txt
  fi
  if [[ "$GPU" == "cu121" && $CHECK -eq 1 ]]; then
    "$PY" -c 'import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)' 2>/dev/null \
      && ok "torch ve la GPU (CUDA $("$PY" -c 'import torch;print(torch.version.cuda)' 2>/dev/null))" \
      || todo "torch no ve la GPU: revisa el driver NVIDIA"
  fi
else
  todo "(torch y resemble-enhance se instalarán al crear el venv)"; PENDING=$((PENDING + 1))
fi

step "3. Modelo de Resemble Enhance (modelos/, ~680 MB)"
if [[ -f "$MODEL_FILE" ]]; then
  ok "modelo presente ($(du -sh "$MODEL_DIR" | cut -f1))"
else
  # El CLI oficial usa git-lfs; aquí se descarga con huggingface_hub (sin git-lfs)
  need "descargar modelo desde Hugging Face" "$PY" -c "
from huggingface_hub import snapshot_download
snapshot_download('ResembleAI/resemble-enhance', local_dir='$MODEL_DIR', allow_patterns=['enhancer_stage2/*'])"
fi

step "4. Dependencias de Node"
if [[ -d node_modules/fastify && -d node_modules/better-sqlite3 ]]; then ok "servidor (node_modules/)"; else need "npm install (servidor)" npm install; fi
if [[ -d web/node_modules/vite ]]; then ok "frontend (web/node_modules/)"; else need "npm install (frontend)" npm --prefix web install; fi
if [[ $CHECK -eq 1 && -d node_modules/better-sqlite3 ]]; then
  node -e "new (require('better-sqlite3'))(':memory:')" 2>/dev/null && ok "better-sqlite3 compatible con $(node -v)" \
    || todo "better-sqlite3 no carga con esta versión de Node: ejecuta 'npm rebuild better-sqlite3'"
fi

step "5. Carpeta de datos"
if [[ -d data ]]; then ok "data/ existe"; else need "crear data/" mkdir -p data/jobs; fi

echo
if [[ $CHECK -eq 1 ]]; then
  [[ $PENDING -eq 0 ]] && ok "Todo instalado. Arranca con: npm start  (o npm run dev)" || todo "$PENDING paso(s) pendiente(s). Ejecuta: npm run setup"
else
  ok "Listo. Arranca con: npm start  → http://localhost:3000"
fi
