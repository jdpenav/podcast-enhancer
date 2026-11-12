"""Mejora audios largos (~1 h o más) con Resemble Enhance.

- Procesa en trozos pequeños (por defecto 6 s) para que el modelo quepa en la VRAM.
  En una GPU de 4 GB, trozos >= 8 s desbordan la memoria y es ~4x más lento.
- Guarda el avance en grupos: si se interrumpe (Ctrl+C, apagado), al volver a correr
  el mismo comando retoma donde quedó.
- Une los trozos con la función original de la librería (alineación + crossfade).
- Nunca modifica el archivo original: trabaja sobre una copia decodificada.

Uso (con el venv activado):
  python engine/enhance_long.py "ENTRADA.mp3" "SALIDA.mp3" [--mode denoise|enhance] [--nfe 64]
  python engine/enhance_long.py ENTRADA SALIDA.wav --also-mp3 SALIDA.mp3   # ambos en una corrida

Salida .mp3 (192 kbps) o .wav según la extensión. Los archivos finales se escriben de forma
atómica (temporal + renombrar): si existen, están completos.

Para la app (fase 3), imprime líneas "@@{json}" legibles por máquina:
  start    {durationSec, total, done}         al conocer el número de grupos
  stage    {stage: decoding|processing|merging}
  progress {done, total, percent, elapsed, eta}
  error    {code: GPU_OOM|FFMPEG_MISSING|INVALID_FILE|ENGINE_FAILED, message}
  done     {outputs: [...], seconds}
Con --parent-pid, si ese proceso muere el motor se pausa solo (guarda avance y sale con 130).
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent  # raíz del repo (funciona en cualquier carpeta)
DEFAULT_RUN_DIR = BASE / "modelos/resemble-enhance/enhancer_stage2"
DEFAULT_WORK = BASE / "trabajos"
SR = 44100


class EngineError(Exception):
    """Error con código para la app y mensaje en español para el usuario."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def fmt(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m{s:02d}s" if h else f"{m}m{s:02d}s"


def emit(event, **data):
    """Línea de progreso legible por máquina (para la app de la fase 3)."""
    print("@@" + json.dumps({"event": event, **data}, ensure_ascii=False), flush=True)


def run(cmd, code="ENGINE_FAILED", message="Falló un comando externo."):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"Error ejecutando {' '.join(map(str, cmd[:3]))}...:\n{r.stderr[-2000:]}", file=sys.stderr, flush=True)
        raise EngineError(code, message)


def job_id(src: Path, args):
    st = src.stat()
    key = json.dumps(
        [str(src.resolve()), st.st_size, int(st.st_mtime), args.mode, args.nfe, args.solver,
         args.tau, args.lambd, args.chunk_seconds, args.overlap_seconds],
    )
    return f"{src.stem[:40]}_{args.mode}_{hashlib.sha1(key.encode()).hexdigest()[:8]}"


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def detach_stdout():
    """El lector de stdout (el servidor) ya no existe: escribir ahí daría BrokenPipeError."""
    try:
        sys.stdout = open(os.devnull, "w")
        sys.stderr = open(os.devnull, "w")
    except OSError:
        pass


def watch_parent(ppid):
    """Si el proceso padre (el servidor) muere, interrumpe el hilo principal → pausa ordenada."""
    import _thread

    def loop():
        while True:
            time.sleep(2)
            if os.getppid() != ppid or not pid_alive(ppid):
                # Primero soltar stdout (el pipe está roto) y luego pausar
                detach_stdout()
                _thread.interrupt_main()
                return

    threading.Thread(target=loop, daemon=True, name="watch-parent").start()


def export(src_wav: Path, dst: Path):
    """Escribe dst de forma atómica (temporal + renombrar)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f"{dst.stem}.tmp{dst.suffix}")
    if dst.suffix.lower() == ".mp3":
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src_wav), "-codec:a", "libmp3lame", "-b:a", "192k", str(tmp)],
            message="No se pudo codificar el MP3 final.")
    else:
        shutil.copyfile(src_wav, tmp)
    tmp.replace(dst)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--also-mp3", type=Path, help="Además de OUTPUT (.wav), escribe este .mp3 en la misma corrida.")
    p.add_argument("--mode", choices=["denoise", "enhance"], default="denoise")
    p.add_argument("--nfe", type=int, default=64, help="Calidad de la mejora (16/32/64). Solo enhance.")
    p.add_argument("--solver", choices=["midpoint", "rk4", "euler"], default="midpoint")
    p.add_argument("--tau", type=float, default=0.5, help="Temperatura (0-1). Solo enhance.")
    p.add_argument("--lambd", type=float, default=1.0, help="Fuerza del denoise dentro de enhance (0-1).")
    p.add_argument("--chunk-seconds", type=float, default=6.0, help="Trozo interno. >=8 desborda 4 GB de VRAM.")
    p.add_argument("--overlap-seconds", type=float, default=1.0)
    p.add_argument("--group-size", type=int, default=25, help="Trozos por archivo de avance guardado.")
    p.add_argument("--cooldown", type=float, default=0.0, help="Pausa (s) entre grupos para bajar la temperatura de la GPU.")
    p.add_argument("--parent-pid", type=int, help="Si este proceso muere, pausar y salir (lo usa el servidor).")
    p.add_argument("--device", default=None, help="cuda o cpu (por defecto: cuda si está disponible).")
    p.add_argument("--run-dir", type=Path, default=DEFAULT_RUN_DIR)
    p.add_argument("--work-dir", type=Path, default=DEFAULT_WORK)
    p.add_argument("--keep", action="store_true", help="No borrar los temporales al terminar.")
    args = p.parse_args()

    if args.parent_pid:
        watch_parent(args.parent_pid)

    emit("stage", stage="decoding")

    if not args.input.exists():
        raise EngineError("INVALID_FILE", "No se encontró el archivo de audio a procesar.")
    if shutil.which("ffmpeg") is None:
        raise EngineError("FFMPEG_MISSING", "Falta ffmpeg en el sistema. Instálalo con: sudo apt install ffmpeg")
    if args.output.suffix.lower() not in (".mp3", ".wav"):
        raise EngineError("ENGINE_FAILED", "La salida debe terminar en .mp3 o .wav")
    if args.also_mp3 and args.also_mp3.suffix.lower() != ".mp3":
        raise EngineError("ENGINE_FAILED", "--also-mp3 debe terminar en .mp3")

    # Importar torch tarda unos segundos: después de las validaciones rápidas
    import torch
    import torchaudio
    from resemble_enhance.enhancer.inference import load_enhancer
    from resemble_enhance.inference import inference_chunk, merge_chunks, remove_weight_norm_recursively

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    work = args.work_dir / job_id(args.input, args)
    parts = work / "partes"
    parts.mkdir(parents=True, exist_ok=True)
    t_start = time.perf_counter()

    # 1. Decodificar una copia a WAV mono 44.1 kHz (el original no se toca)
    decoded = work / "entrada.wav"
    if not decoded.exists():
        print("Decodificando audio con ffmpeg...", flush=True)
        tmp = work / "entrada.tmp.wav"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(args.input), "-ac", "1", "-ar", str(SR), str(tmp)],
            code="INVALID_FILE", message="No se pudo leer el audio: el archivo está dañado o no es un formato válido.")
        tmp.rename(decoded)
    dwav, sr = torchaudio.load(str(decoded))
    dwav = dwav[0]
    assert sr == SR
    duration = dwav.shape[-1] / SR

    chunk_len = int(SR * args.chunk_seconds)
    hop_len = chunk_len - int(SR * args.overlap_seconds)
    # Un último trozo que cae dentro del solapamiento ya está cubierto por el anterior (que llega hasta
    # s + overlap >= final). Si se procesara, podría medir unas pocas muestras y torch.stft fallaría
    # ("Padding size should be less than the corresponding input dimension") según la duración del audio.
    n = dwav.shape[-1]
    starts = [s for s in range(0, n, hop_len) if s == 0 or n - s > chunk_len - hop_len]
    groups = [starts[i : i + args.group_size] for i in range(0, len(starts), args.group_size)]
    done_before = sum((parts / f"g{gi:04d}.pt").exists() for gi in range(len(groups)))
    print(
        f"Audio: {fmt(duration)} | modo: {args.mode}"
        + (f" (nfe={args.nfe}, {args.solver})" if args.mode == "enhance" else "")
        + f" | {len(starts)} trozos en {len(groups)} grupos | dispositivo: {device}",
        flush=True,
    )
    print(f"Carpeta de trabajo: {work}", flush=True)
    emit("start", durationSec=round(duration, 2), total=len(groups), done=done_before)

    # 2. Cargar modelo
    enhancer = load_enhancer(args.run_dir, device)
    if args.mode == "enhance":
        enhancer.configurate_(nfe=args.nfe, solver=args.solver, lambd=args.lambd, tau=args.tau)
        model = enhancer
    else:
        model = enhancer.denoiser
    remove_weight_norm_recursively(model)

    # 3. Procesar grupos (retomando los ya hechos)
    emit("stage", stage="processing")
    if done_before:
        print(f"Retomando: {done_before}/{len(groups)} grupos ya estaban listos.", flush=True)
    t_proc = time.perf_counter()
    processed_now = 0
    for gi, group in enumerate(groups):
        gpath = parts / f"g{gi:04d}.pt"
        if gpath.exists():
            continue
        out = [inference_chunk(model, dwav[s : s + chunk_len], SR, device) for s in group]
        torch.save(out, parts / f"g{gi:04d}.tmp")
        (parts / f"g{gi:04d}.tmp").rename(gpath)
        processed_now += 1

        done = done_before + processed_now
        elapsed = time.perf_counter() - t_proc
        eta = elapsed / processed_now * (len(groups) - done)
        pct = done / len(groups) * 100
        print(f"  [{done}/{len(groups)}] {pct:5.1f}% | transcurrido {fmt(elapsed)} | restante ~{fmt(eta)}", flush=True)
        emit("progress", done=done, total=len(groups), percent=round(pct, 1),
             elapsed=round(elapsed, 1), eta=round(eta, 1))
        if args.cooldown > 0 and done < len(groups):
            time.sleep(args.cooldown)

    # 4. Unir
    emit("stage", stage="merging")
    print("Uniendo trozos...", flush=True)
    chunks = []
    for gi in range(len(groups)):
        chunks.extend(torch.load(parts / f"g{gi:04d}.pt"))
    hwav = merge_chunks(chunks, chunk_len, hop_len, sr=SR, length=dwav.shape[-1])
    peak = hwav.abs().max().item()
    if peak > 0.999:  # evitar clipping
        hwav = hwav / peak * 0.999

    # 5. Exportar (atómico: cada archivo final aparece completo o no aparece)
    out_wav = work / "salida.wav"
    torchaudio.save(str(out_wav), hwav[None], SR, encoding="PCM_S", bits_per_sample=16)
    outputs = [args.output] + ([args.also_mp3] if args.also_mp3 else [])
    for dst in outputs:
        export(out_wav, dst)

    total = time.perf_counter() - t_start
    print(f"Listo: {', '.join(map(str, outputs))} | tiempo total {fmt(total)} ({total / duration:.2f}x la duración del audio)", flush=True)
    emit("done", output=str(args.output), outputs=[str(o) for o in outputs], seconds=round(total, 1))

    if not args.keep:
        shutil.rmtree(work, ignore_errors=True)


def is_oom(e):
    return type(e).__name__ == "OutOfMemoryError" or "out of memory" in str(e).lower()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        try:
            print("\nInterrumpido. Vuelve a correr el mismo comando para retomar.", flush=True)
        except OSError:
            pass
        sys.exit(130)
    except BrokenPipeError:
        # El servidor murió antes de que el vigilante lo notara: misma salida que una pausa.
        # Los grupos se guardan de forma atómica, así que el avance está a salvo.
        detach_stdout()
        sys.exit(130)
    except EngineError as e:
        emit("error", code=e.code, message=e.message)
        sys.exit(e.message)
    except Exception as e:  # noqa: BLE001
        if is_oom(e):
            msg = ("La GPU se quedó sin memoria. Cierra otros programas que usen la GPU y pulsa Reintentar: "
                   "seguirá donde quedó.")
            emit("error", code="GPU_OOM", message=msg)
            sys.exit(msg)
        emit("error", code="ENGINE_FAILED", message="El motor falló inesperadamente. Pulsa Reintentar para seguir donde quedó.")
        raise
