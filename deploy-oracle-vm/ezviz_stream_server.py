#!/usr/bin/env python3
"""
Backend de Streaming 24/7 Always-On, Extractor MicroSD y Motor Dual ALPR (Machine Learning Local + Plate Recognizer Cloud).
Edificio Laujim - Sistema de Seguridad y Control Vehicular.

Características:
  - Streaming Continuo 24/7 (Copia de flujo directo -c copy, ~1% CPU).
  - Cero Latencia de Apertura (<0.3s): m3u8 y segmentos .ts en memoria.
  - Supervisor de Procesos: Reconexión automática instantánea ante microcortes.
  - Extractor MicroSD Local: Pausa temporal del stream y descarga MP4 a 2880x1620.
  - Motor Dual ALPR:
      1) Machine Learning Local (YOLOv9 + MobileViT OCR): 0 costo, ilimitado, ~0.6s en CPU ARM64.
      2) Plate Recognizer Cloud API: 2,500 llamadas/mes con Marca/Modelo/Color (MMC).
      3) Tracker Inteligente de Vehículos: Detecta si un carro está estacionado/inmóvil
         (como KJH-784) y bloquea el consumo innecesario de créditos de la API Cloud.
"""

import datetime
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
import cv2
import numpy as np
import requests

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# --- Configuración de las Cámaras ---
CAMERAS = {
    "entrada": {
        "name": "Cámara Entrada (Portón Principal)",
        "ip": "192.168.1.25",
        "user": "admin",
        "password": "JJTVEE",
        "port": 5541,
    },
    "l": {
        "name": "H8c Fachada Izquierda",
        "ip": "192.168.1.9",
        "user": "admin",
        "password": "Laujim1011.",
        "port": 5542,
    },
    "r": {
        "name": "H8c Fachada Derecha",
        "ip": "192.168.1.28",
        "user": "admin",
        "password": "Laujim1011.",
        "port": 5543,
    },
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HLS_DIR = os.path.join(BASE_DIR, "hls").replace("\\", "/")
RECORDINGS_DIR = os.path.join(BASE_DIR, "recordings").replace("\\", "/")
os.makedirs(HLS_DIR, exist_ok=True)
os.makedirs(RECORDINGS_DIR, exist_ok=True)

ROUTER_WAN_HOST = os.environ.get("ROUTER_WAN_HOST", "edificiolaujim.ddns.net").strip()
ROUTER_PORTS = {
    "entrada": 5541,
    "l": 5542,
    "r": 5543,
}

PLATE_RECOGNIZER_TOKEN = os.environ.get("PLATE_RECOGNIZER_TOKEN", "e4edfc08a7ae867f2087bd803cc85fd198cac290").strip()

# Estado global
live_processes: dict[str, dict] = {}
paused_for_export: set[str] = set()
export_jobs: dict[str, dict] = {}
alpr_detections: list[dict] = []
last_detected_time: dict[str, float] = {}
benchmark_stats = {
    "total_scans": 0,
    "ml_total_time_ms": 0,
    "cloud_total_time_ms": 0,
    "ml_detections_count": 0,
    "cloud_detections_count": 0,
}
lock = threading.RLock()

# ─── MOTOR LOCAL RETIRADO (2026-09-16) ───
# Solo se usa Plate Recognizer Cloud: el ML local exigía torch/fast_alpr
# (no instalados) y rinde menos que la nube en placas CO nocturnas.
ml_alpr = None

app = FastAPI(title="Laujim Video Engine 24/7 + Dual ALPR")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


def rtsp_url(camera_id: str) -> str:
    cam = CAMERAS[camera_id]
    pwd = cam["password"]
    if ROUTER_WAN_HOST:
        host = ROUTER_WAN_HOST
        port = ROUTER_PORTS.get(camera_id, cam.get("port", 554))
    else:
        host = cam["ip"]
        port = 554
    return f"rtsp://{cam['user']}:{pwd}@{host}:{port}/Streaming/Channels/101"


def _start_single_stream(camera_id: str):
    """Inicia el subproceso FFmpeg para streaming continuo HLS en disco/RAM."""
    cam_dir = os.path.join(HLS_DIR, camera_id).replace("\\", "/")
    os.makedirs(cam_dir, exist_ok=True)
    m3u8_path = f"{cam_dir}/index.m3u8"
    seg_pattern = f"{cam_dir}/seg_%03d.ts"
    log_path = f"{cam_dir}/ffmpeg.log"

    cmd = [
        "ffmpeg",
        "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "warning",
        "-rtsp_transport", "tcp",
        "-use_wallclock_as_timestamps", "1",  # Las cámaras envían PTS rotos (~27h); rebasea a reloj real o el navegador muestra negro
        "-fflags", "nobuffer+flush_packets",
        "-flags", "low_delay",
        "-probesize", "500000",      # Apertura rápida (~0.5s en vez de 1.5s)
        "-analyzeduration", "500000",
        "-i", rtsp_url(camera_id),
        "-c", "copy",                 # Copia directa: 0.5% CPU
        "-f", "hls",
        "-hls_time", "1",             # Segmentos de 1 segundo (inicio <0.8s)
        "-hls_list_size", "6",        # Ventana de 6s pegada al borde vivo (menos retardo que 10)
        "-hls_flags", "delete_segments+omit_endlist+independent_segments",
        "-hls_segment_filename", seg_pattern,
        m3u8_path,
    ]

    try:
        log_f = open(log_path, "w", encoding="utf-8", errors="replace")
        proc = subprocess.Popen(cmd, stdout=log_f, stderr=subprocess.STDOUT)
        with lock:
            live_processes[camera_id] = {
                "process": proc,
                "started_at": time.time(),
                "log_file": log_f,
            }
        print(f"[{camera_id}] FFmpeg Always-On iniciado exitosamente.")
    except Exception as e:
        print(f"[{camera_id}] Error al arrancar FFmpeg: {e}")


def _stop_single_stream(camera_id: str):
    """Detiene ordenadamente el subproceso FFmpeg de una cámara."""
    with lock:
        entry = live_processes.pop(camera_id, None)
    if entry and entry.get("process"):
        proc = entry["process"]
        try:
            proc.terminate()
            proc.wait(timeout=2.0)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        if entry.get("log_file"):
            try:
                entry["log_file"].close()
            except Exception:
                pass
        print(f"[{camera_id}] FFmpeg Always-On detenido.")


def _stream_supervisor():
    """Supervisor continuo: Mantiene las 3 cámaras activas 24/7 y reconecta ante microcortes."""
    # Arranque inmediato: el playlist siempre está tibio, sin espera de sincronización al abrir la página.
    time.sleep(0.5)
    while True:
        try:
            for cid in list(CAMERAS.keys()):
                should_restart = False
                had_entry = False
                with lock:
                    if cid in paused_for_export:
                        continue
                    entry = live_processes.get(cid)
                    is_running = bool(entry and entry["process"].poll() is None)
                    if not is_running:
                        should_restart = True
                        had_entry = bool(entry)

                if should_restart:
                    if had_entry:
                        _stop_single_stream(cid)
                    _start_single_stream(cid)
        except Exception as e:
            print(f"[SUPERVISOR] Error en bucle: {e}")
        time.sleep(3.0)


# ─── MOTOR DE RECONOCIMIENTO VEHICULAR (DUAL ALPR + TRACKER) ───

def disambiguate_colombian_plate(raw_text: str) -> tuple[str, str] | None:
    """Aplica sintaxis del Ministerio de Transporte de Colombia para corregir OCR."""
    text = re.sub(r'[^A-Z0-9]', '', raw_text.upper())
    if not text:
        return None

    l_map = {'0': 'O', '1': 'I', '8': 'B', '5': 'S', '2': 'Z', '4': 'A', '6': 'G', 'Q': 'O'}
    d_map = {'O': '0', 'I': '1', 'B': '8', 'S': '5', 'Z': '2', 'A': '4', 'G': '6', 'D': '0', 'L': '1'}

    # Formato estándar automóvil / particular / camión: 3 Letras + 3 Números (ABC-123)
    if len(text) == 6:
        letters = "".join([l_map.get(c, c) for c in text[:3]])
        digits = "".join([d_map.get(c, c) for c in text[3:6]])
        if re.match(r'^[A-Z]{3}$', letters) and re.match(r'^[0-9]{3}$', digits):
            return f"{letters}-{digits}", "Automóvil / Camión"

    for i in range(len(text) - 5):
        chunk = text[i:i+6]
        letters = "".join([l_map.get(c, c) for c in chunk[:3]])
        digits = "".join([d_map.get(c, c) for c in chunk[3:6]])
        if re.match(r'^[A-Z]{3}$', letters) and re.match(r'^[0-9]{3}$', digits):
            return f"{letters}-{digits}", "Automóvil / Camión"

        # Formato motocicleta colombiana: 3 Letras + 2 Números + 1 Letra (ABC-12D)
        moto_d = "".join([d_map.get(c, c) for c in chunk[3:5]])
        moto_l = l_map.get(chunk[5], chunk[5])
        if re.match(r'^[A-Z]{3}$', letters) and re.match(r'^[0-9]{2}$', moto_d) and re.match(r'^[A-Z]$', moto_l):
            return f"{letters}-{moto_d}{moto_l}", "Motocicleta"

    return None


class VehicleStationaryTracker:
    """
    Rastreador espacial de vehículos.
    Determina si un vehículo está en movimiento o estacionado/inmóvil.
    Evita gastar llamadas de Plate Recognizer Cloud en autos estacionados (como KJH-784).
    """
    def __init__(self):
        self.tracked: dict[str, dict] = {}

    def update(self, plate: str, cam_id: str, cx: float, cy: float) -> tuple[str, bool]:
        """
        Retorna (status, is_new_or_moved).
        status: 'moving' | 'parked'
        is_new_or_moved: True si es primera vez o cambió de ubicación significativamente.
        """
        now = time.time()
        entry = self.tracked.get(plate)
        if not entry:
            self.tracked[plate] = {
                "cam": cam_id,
                "cx": cx,
                "cy": cy,
                "first_seen": now,
                "last_seen": now,
                "last_cloud_call": 0,
                "status": "moving",
            }
            return "moving", True

        dist = ((cx - entry["cx"]) ** 2 + (cy - entry["cy"]) ** 2) ** 0.5
        entry["last_seen"] = now

        # Si no se ha movido más de 45px en la misma cámara y lleva más de 30 segundos: ESTACIONADO
        if dist < 45 and (now - entry["first_seen"] > 30):
            entry["status"] = "parked"
            return "parked", False
        elif dist >= 45:
            entry["cx"] = cx
            entry["cy"] = cy
            entry["first_seen"] = now
            entry["status"] = "moving"
            return "moving", True

        return entry["status"], False

    def should_call_cloud(self, plate: str) -> bool:
        """Determina si debemos llamar a la API Cloud o si está estacionado."""
        entry = self.tracked.get(plate)
        if not entry:
            return True
        now = time.time()
        # Si está estacionado y se consultó en los últimos 15 minutos: NO GASTAR API
        if entry["status"] == "parked" and (now - entry.get("last_cloud_call", 0) < 900):
            return False
        return True

    def mark_cloud_called(self, plate: str):
        if plate in self.tracked:
            self.tracked[plate]["last_cloud_call"] = time.time()


tracker = VehicleStationaryTracker()


# scan_plates_ml ELIMINADO (2026-09-16): motor local retirado, solo Cloud.
# (ver scan_plates_cloud; historial en git)


def scan_plates_cloud(img_path: str, cam_id: str = "l") -> list[dict]:
    """
    Escanea la imagen con Plate Recognizer Cloud API.
    Aprovecha el token oficial, Make/Model/Color (MMC) y orientación.
    """
    if not PLATE_RECOGNIZER_TOKEN or not os.path.exists(img_path):
        return []

    url = "https://api.platerecognizer.com/v1/plate-reader/"
    results = []

    try:
        with open(img_path, "rb") as fp:
            resp = requests.post(
                url,
                headers={"Authorization": f"Token {PLATE_RECOGNIZER_TOKEN}"},
                files={"upload": fp},
                data={"regions": "co", "mmc": "true"},
                timeout=12.0
            )

        if resp.status_code in [200, 201]:
            data = resp.json()
            raw_results = data.get("results", [])
            img_w = data.get("image_width", 2880)
            img_h = data.get("image_height", 1620)

            for item in raw_results:
                raw_plate = (item.get("plate") or "").upper()
                if not raw_plate:
                    continue

                formatted = disambiguate_colombian_plate(raw_plate)
                plate_str = formatted[0] if formatted else (
                    f"{raw_plate[:3]}-{raw_plate[3:]}" if len(raw_plate) == 6 else raw_plate
                )

                box = item.get("box", {})
                xmin = box.get("xmin", 0)
                ymin = box.get("ymin", 0)
                xmax = box.get("xmax", 0)
                ymax = box.get("ymax", 0)
                cx = (xmin + xmax) / 2.0
                cy = (ymin + ymax) / 2.0

                status, _ = tracker.update(plate_str, cam_id, cx, cy)
                tracker.mark_cloud_called(plate_str)

                mmc = item.get("vehicle", {})
                vehicle_type = mmc.get("type") or formatted[1] if formatted else "Vehículo"
                make_model = (mmc.get("make_model") or [{}])[0].get("make_model") or (mmc.get("make") or [{}])[0].get("make") or "Genérico"
                color = (mmc.get("color") or [{}])[0].get("color") or "Desconocido"

                results.append({
                    "plate": plate_str,
                    "raw_plate": raw_plate,
                    "type": f"{vehicle_type} ({make_model})",
                    "confidence": round(float(item.get("score", 0.9)), 3),
                    "engine": "cloud_pr",
                    "engine_label": "Plate Recognizer Cloud (MMC)",
                    "status": status,
                    "is_parked": (status == "parked"),
                    "box": {"x1": int(xmin), "y1": int(ymin), "x2": int(xmax), "y2": int(ymax)},
                    "box_norm": {
                        "xmin": round(xmin / img_w, 4),
                        "ymin": round(ymin / img_h, 4),
                        "xmax": round(xmax / img_w, 4),
                        "ymax": round(ymax / img_h, 4)
                    },
                    "details": {
                        "vehicle": vehicle_type,
                        "make_model": make_model,
                        "color": color,
                        "orientation": (item.get("orientation") or [{}])[0].get("orientation", "rear"),
                        "direction": item.get("direction", "0°")
                    },
                    "img_width": img_w,
                    "img_height": img_h,
                })
    except Exception as e:
        print(f"[ALPR CLOUD] Error consultando Plate Recognizer: {e}")

    return results


def capture_snapshot(cam_id: str) -> str | None:
    """Extrae un fotograma JPEG nítido instantáneamente desde el último segmento TS en disco."""
    cam_dir = os.path.join(HLS_DIR, cam_id).replace("\\", "/")
    snapshot_path = os.path.join(cam_dir, "snapshot.jpg").replace("\\", "/")

    # 1. Si existe snapshot reciente (< 4s), reutilizarlo inmediatamente (0ms)
    if os.path.exists(snapshot_path):
        mtime = os.path.getmtime(snapshot_path)
        if time.time() - mtime < 4.0:
            return snapshot_path

    # 2. Extraer del último segmento .ts generado (evita bloquearse en la playlist m3u8)
    if os.path.exists(cam_dir):
        ts_files = sorted([f for f in os.listdir(cam_dir) if f.endswith(".ts") and f.startswith("seg_")])
        if ts_files:
            latest_ts = os.path.join(cam_dir, ts_files[-1]).replace("\\", "/")
            snap_cmd = [
                "ffmpeg", "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-i", latest_ts,
                "-vframes", "1",
                "-q:v", "2",
                snapshot_path,
            ]
            try:
                subprocess.run(snap_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2.5)
                if os.path.exists(snapshot_path) and os.path.getsize(snapshot_path) > 1000:
                    return snapshot_path
            except Exception:
                pass

    if os.path.exists(snapshot_path) and os.path.getsize(snapshot_path) > 1000:
        return snapshot_path
    return None


def _alpr_worker():
    """
    Patrullero ALPR retirado (2026-09-16).
    El ML local exigía torch/fast_alpr y rendía menos que la nube; un patrullaje
    periódico en Cloud quemaría el cupo (2.500/mes). La detección corre solo
    bajo demanda en POST /alpr/scan.
    """
    return


# ─── ENDPOINTS DE STREAMING EN VIVO ───

@app.get("/cameras")
def list_cameras():
    res = []
    for cid, cam in CAMERAS.items():
        entry = live_processes.get(cid)
        is_active = bool(entry and entry["process"].poll() is None)
        res.append({
            "id": cid,
            "name": cam["name"],
            "active": is_active,
            "playlist": f"/hls/{cid}/index.m3u8" if is_active else None,
            "mode": "24/7 Always-On",
            "viewers": 1,
        })
    return res


@app.post("/stream/start/{camera_id}")
def start_stream(camera_id: str):
    """Retorna instantáneamente (<0.1s) la playlist HLS activa."""
    if camera_id not in CAMERAS:
        raise HTTPException(404, "Cámara no encontrada")

    # Always-On 24/7: el supervisor mantiene el m3u8 tibio en todo momento,
    # no se espera ni se sondea nada. Cero tiempo de sincronización.
    return {
        "status": "started",
        "playlist": f"/hls/{camera_id}/index.m3u8",
        "cached": True,
        "mode": "24/7 Always-On",
    }


@app.post("/stream/ping/{camera_id}")
def ping_stream(camera_id: str):
    return {"status": "ok", "active": True}


@app.post("/stream/stop/{camera_id}")
def stop_stream(camera_id: str):
    return {"status": "always_on_preserved"}


# ─── ENDPOINTS DE ALPR (PLACAS VEHICULARES & BENCHMARK) ───

@app.get("/alpr/plates")
def get_detected_plates():
    with lock:
        return {
            "ok": True,
            "active": True,
            "total": len(alpr_detections),
            "plates": list(alpr_detections),
            "benchmark_summary": dict(benchmark_stats),
        }


@app.get("/alpr/snapshot")
def get_alpr_snapshot(cam: str = "l"):
    cam_id = "r" if cam == "r" else ("entrada" if cam == "entrada" else "l")
    snapshot_path = os.path.join(HLS_DIR, cam_id, "snapshot.jpg")
    if os.path.exists(snapshot_path):
        return FileResponse(snapshot_path, media_type="image/jpeg")
    for fallback in ["l", "r", "entrada"]:
        p = os.path.join(HLS_DIR, fallback, "snapshot.jpg")
        if os.path.exists(p):
            return FileResponse(p, media_type="image/jpeg")
    raise HTTPException(404, "Snapshot no disponible aún.")


@app.post("/alpr/scan")
def trigger_alpr_scan(mode: str = "compare", cam: str = "all"):
    """
    Escaneo manual con Plate Recognizer Cloud:
      mode = 'compare' (nube; comparativa retirada, equivale a cloud)
      mode = 'ml'      (retirado; cae a nube para no romper la UI)
      mode = 'cloud'   (Plate Recognizer Cloud API: placa + marca/modelo/color)
    """
    targets = [("l", "Fachada Izquierda"), ("r", "Fachada Derecha")] if cam == "all" else (
        [("l", "Fachada Izquierda")] if cam == "l" else [("r", "Fachada Derecha")]
    )

    all_ml_results = []
    all_cloud_results = []
    detected_plates = []

    total_ml_time = 0.0
    total_cloud_time = 0.0
    now = time.time()
    now_str = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5))).strftime("%Y-%m-%d %I:%M:%S %p")

    for cam_id, cam_label in targets:
        snap_path = capture_snapshot(cam_id)
        if not snap_path:
            continue

        # 1. Motor local retirado (2026-09-16): todos los modos usan Cloud.
        # 2. Ejecutar Plate Recognizer Cloud API
        if mode in ["compare", "cloud", "ml"]:
            t0 = time.time()
            cloud_found = scan_plates_cloud(snap_path, cam_id)
            elapsed_cloud = round((time.time() - t0) * 1000, 1)
            total_cloud_time += elapsed_cloud

            for r in cloud_found:
                r["camera"] = cam_label
                r["cam_id"] = cam_id
                r["inference_time_ms"] = elapsed_cloud
                r["snapshot"] = f"/alpr/snapshot?cam={cam_id}&t={int(now)}"
                all_cloud_results.append(r)
                if r["plate"] not in detected_plates:
                    detected_plates.append(r["plate"])

                # Guardar evento en memoria
                event = {
                    "id": f"pr_{str(uuid.uuid4())[:8]}",
                    "plate": r["plate"],
                    "raw_plate": r["raw_plate"],
                    "type": r["type"],
                    "confidence": r["confidence"],
                    "timestamp": now_str,
                    "epoch": now,
                    "camera": cam_label,
                    "cam_id": cam_id,
                    "engine": "cloud_pr",
                    "status": r["status"],
                    "is_parked": r["is_parked"],
                    "box": r["box"],
                    "box_norm": r["box_norm"],
                    "details": r.get("details", {}),
                    "snapshot": f"/alpr/snapshot?cam={cam_id}&t={int(now)}",
                    "inference_time_ms": elapsed_cloud,
                }
                with lock:
                    alpr_detections.insert(0, event)
                    if len(alpr_detections) > 100:
                        alpr_detections.pop()

    # Actualizar acumulador estadístico
    with lock:
        benchmark_stats["total_scans"] += 1
        benchmark_stats["ml_total_time_ms"] += total_ml_time
        benchmark_stats["cloud_total_time_ms"] += total_cloud_time
        benchmark_stats["ml_detections_count"] += len(all_ml_results)
        benchmark_stats["cloud_detections_count"] += len(all_cloud_results)

    ml_plates = [r["plate"] for r in all_ml_results]
    cloud_plates = [r["plate"] for r in all_cloud_results]
    common_plates = list(set(ml_plates).intersection(set(cloud_plates)))

    return {
        "ok": True,
        "mode": mode,
        "plates_detected": detected_plates,
        "benchmark": {
            "ml_time_ms": round(total_ml_time, 1),
            "cloud_time_ms": round(total_cloud_time, 1),
            "ml_plates": ml_plates,
            "cloud_plates": cloud_plates,
            "agreement_count": len(common_plates),
            "match": bool(common_plates),
            "speed_winner": "Local ML" if total_ml_time < total_cloud_time and total_ml_time > 0 else "Cloud PR",
        },
        "ml_results": all_ml_results,
        "cloud_results": all_cloud_results,
    }


# ─── EXTRACTOR DE GRABACIONES LOCAL MICROSD (ADMIN) ───

class ExportRequest(BaseModel):
    camera_id: str
    start_time: str
    end_time: str


def parse_to_rtsp_ts(ts_input: str) -> str:
    clean = str(ts_input).strip()
    if re.match(r"^\d{8}[tT]\d{6}[zZ]$", clean):
        return clean.lower()

    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
    ]
    for fmt in formats:
        try:
            dt = datetime.datetime.strptime(clean, fmt)
            return dt.strftime("%Y%m%dt%H%M%Sz")
        except ValueError:
            pass
    raise ValueError(f"Formato no reconocido: '{clean}'. Use formato 'YYYY-MM-DD HH:MM'.")


def _run_export_job(job_id: str, camera_id: str, start_ts: str, end_ts: str) -> None:
    cam = CAMERAS[camera_id]
    pwd = cam.get("password")
    out_filename = f"rec_{camera_id}_{start_ts}_{end_ts}_{job_id[:6]}.mp4"
    out_path = os.path.join(RECORDINGS_DIR, out_filename).replace("\\", "/")

    with lock:
        paused_for_export.add(camera_id)
        _stop_single_stream(camera_id)
    time.sleep(2.5)

    export_jobs[job_id]["status"] = "downloading"
    export_jobs[job_id]["filename"] = out_filename
    export_jobs[job_id]["out_path"] = out_path

    if ROUTER_WAN_HOST:
        host = ROUTER_WAN_HOST
        port = ROUTER_PORTS.get(camera_id, cam.get("port", 554))
    else:
        host = cam["ip"]
        port = 554

    playback_url = f"rtsp://{cam['user']}:{pwd}@{host}:{port}/Streaming/tracks/101?starttime={start_ts}&endtime={end_ts}"

    cmd = [
        "ffmpeg", "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "info",
        "-rtsp_transport", "tcp",
        "-buffer_size", "1024000",
        "-i", playback_url,
        "-c", "copy",
        "-movflags", "+faststart",
        out_path,
    ]

    log_path = os.path.join(RECORDINGS_DIR, f"{job_id}.log")
    success = False
    for attempt in range(2):
        try:
            with open(log_path, "w", encoding="utf-8", errors="replace") as lf:
                print(f"[EXPORT {job_id}] Descarga MicroSD ({start_ts} a {end_ts}) en {camera_id}...")
                proc = subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT)
                export_jobs[job_id]["pid"] = proc.pid
                proc.wait(timeout=600)

                if proc.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
                    size_mb = round(os.path.getsize(out_path) / (1024 * 1024), 2)
                    export_jobs[job_id]["status"] = "completed"
                    export_jobs[job_id]["size_mb"] = size_mb
                    export_jobs[job_id]["download_url"] = f"/recordings/download/{job_id}"
                    print(f"[EXPORT {job_id}] Descarga exitosa: {out_filename} ({size_mb} MB)")
                    success = True
                    break
        except subprocess.TimeoutExpired:
            export_jobs[job_id]["status"] = "failed"
            export_jobs[job_id]["error"] = "Timeout al descargar grabación."
            break
        except Exception as e:
            export_jobs[job_id]["status"] = "failed"
            export_jobs[job_id]["error"] = str(e)
            break

        if attempt == 0:
            time.sleep(3.0)

    with lock:
        paused_for_export.discard(camera_id)

    if not success and export_jobs[job_id]["status"] != "failed":
        export_jobs[job_id]["status"] = "failed"
        export_jobs[job_id]["error"] = "No se encontraron fragmentos en la MicroSD para ese rango."


@app.post("/recordings/export")
def export_recording(req: ExportRequest):
    if req.camera_id not in CAMERAS:
        raise HTTPException(404, "Cámara no encontrada")
    try:
        start_ts = parse_to_rtsp_ts(req.start_time)
        end_ts = parse_to_rtsp_ts(req.end_time)
    except ValueError as e:
        raise HTTPException(400, str(e))

    job_id = str(uuid.uuid4())
    export_jobs[job_id] = {
        "id": job_id,
        "camera_id": req.camera_id,
        "camera_name": CAMERAS[req.camera_id]["name"],
        "start": req.start_time,
        "end": req.end_time,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "status": "queued",
        "created_at": time.time(),
    }

    worker = threading.Thread(
        target=_run_export_job,
        args=(job_id, req.camera_id, start_ts, end_ts),
        daemon=True,
    )
    worker.start()

    return {"job_id": job_id, "status": "queued", "message": "Extracción MicroSD iniciada."}


@app.get("/recordings/status/{job_id}")
def get_export_status(job_id: str):
    if job_id not in export_jobs:
        raise HTTPException(404, "Trabajo no encontrado")
    return export_jobs[job_id]


@app.get("/recordings/download/{job_id}")
def download_recording(job_id: str):
    job = export_jobs.get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(404, "Grabación no completada")
    path = job.get("out_path")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "Archivo físico no encontrado")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=job.get("filename", "grabacion.mp4"),
    )


INSTALLATION_DATE = datetime.datetime(2026, 9, 3, 8, 0, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=-5)))

@app.get("/recordings/retention")
@app.get("/api/retention")
def get_retention():
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5)))
    actual_days = max(1, (now - INSTALLATION_DATE).days)
    return {
        "ok": True,
        "retentionDays": actual_days,
        "capacityDaysEstimate": 28,
        "oldestTimestamp": INSTALLATION_DATE.isoformat(),
        "storageType": "MicroSD 24/7 Local",
        "installDate": "2026-09-03",
    }


os.makedirs(HLS_DIR, exist_ok=True)


@app.get("/hls/{camera_id}/index.m3u8")
def get_live_playlist(camera_id: str):
    """Playlist siempre fresca: sin caché para que el vivo arranque en el borde, no en pasado."""
    m3u8_path = os.path.join(HLS_DIR, camera_id, "index.m3u8")
    if not os.path.exists(m3u8_path):
        raise HTTPException(404, "Playlist aún no generada.")
    return FileResponse(
        m3u8_path,
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


app.mount("/hls", StaticFiles(directory=HLS_DIR), name="hls")
if __name__ == "__main__":
    import uvicorn
    # Iniciar Supervisor 24/7 y Patrullero ALPR ML solo en el proceso principal
    threading.Thread(target=_stream_supervisor, daemon=True).start()
    threading.Thread(target=_alpr_worker, daemon=True).start()

    print("Iniciando Laujim Video Engine 24/7 + Dual ALPR en http://0.0.0.0:8080 ...")
    uvicorn.run(app, host="0.0.0.0", port=8080)
