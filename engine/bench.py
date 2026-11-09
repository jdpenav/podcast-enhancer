"""Benchmark de configuraciones de resemble-enhance sobre un clip corto.

Uso (con el venv activado):
  python engine/bench.py ENTRADA.wav SALIDA_DIR "cs=10,nfe=16,solver=midpoint" ["cs=15,..."]

Claves: cs (segundos por trozo interno), nfe, solver, tau, lambd, mode (enhance|denoise)
"""
import os
import sys
import time
from pathlib import Path

import torch
import torchaudio

from resemble_enhance.enhancer.inference import load_enhancer
from resemble_enhance.inference import inference

RUN_DIR = Path(
    os.environ.get(
        "RE_RUN_DIR",
        Path(__file__).resolve().parent.parent / "modelos/resemble-enhance/enhancer_stage2",
    )
)


def parse(cfg):
    d = dict(kv.split("=") for kv in cfg.split(","))
    return {
        "cs": float(d.get("cs", 30)),
        "nfe": int(d.get("nfe", 64)),
        "solver": d.get("solver", "midpoint"),
        "tau": float(d.get("tau", 0.5)),
        "lambd": float(d.get("lambd", 1.0)),
        "mode": d.get("mode", "enhance"),
    }


def main():
    src, out_dir, *cfgs = sys.argv[1:]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    dwav, sr = torchaudio.load(src)
    dwav = dwav.mean(dim=0)
    dur = dwav.shape[-1] / sr

    t0 = time.perf_counter()
    enhancer = load_enhancer(RUN_DIR, "cuda")
    print(f"Modelo cargado en {time.perf_counter() - t0:.1f}s | audio: {dur:.1f}s", flush=True)

    for cfg in cfgs:
        c = parse(cfg)
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        t = time.perf_counter()
        if c["mode"] == "denoise":
            model = enhancer.denoiser
        else:
            enhancer.configurate_(nfe=c["nfe"], solver=c["solver"], lambd=c["lambd"], tau=c["tau"])
            model = enhancer
        hwav, osr = inference(model, dwav, sr, "cuda", chunk_seconds=c["cs"], overlap_seconds=1.0)
        torch.cuda.synchronize()
        el = time.perf_counter() - t
        peak = torch.cuda.max_memory_allocated() / 2**30
        name = cfg.replace(",", "_").replace("=", "")
        torchaudio.save(str(out_dir / f"{name}.wav"), hwav[None], osr)
        print(
            f"RESULT {cfg:45s} tiempo={el:7.1f}s  x_tiempo_real={el / dur:5.2f}  "
            f"est_56min={el / dur * 56:6.1f}min  vram_pico={peak:.2f}GB",
            flush=True,
        )


if __name__ == "__main__":
    main()
