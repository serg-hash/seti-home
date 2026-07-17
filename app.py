"""
SETI@Home Relay — educational web app for Railway.

A playful, science-inspired simulation of distributed radio-signal analysis.
Not affiliated with UC Berkeley SETI@home / BOINC.
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, render_template, request

from signal_engine import SignalEngine

app = Flask(__name__)
engine = SignalEngine(n_fft=256)


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "seti-home-relay"})


@app.get("/api/stats")
def stats():
    return jsonify(engine.get_stats())


@app.get("/api/targets")
def targets():
    return jsonify(engine.get_targets())


@app.get("/api/work-units")
def work_units():
    limit = request.args.get("limit", 20, type=int)
    return jsonify(engine.list_work_units(limit=limit))


@app.post("/api/work-units")
def create_and_process_wu():
    body = request.get_json(silent=True) or {}
    target_index = body.get("target_index")
    if target_index is not None:
        wu = engine.create_work_unit(target_index=int(target_index))
        result = engine.process_work_unit(wu.id)
    else:
        result = engine.process_work_unit()
    return jsonify(result)


@app.post("/api/work-units/<wu_id>/process")
def process_wu(wu_id: str):
    if wu_id not in engine.work_units:
        return jsonify({"error": "Work unit not found"}), 404
    return jsonify(engine.process_work_unit(wu_id))


@app.get("/api/candidates")
def candidates():
    limit = request.args.get("limit", 50, type=int)
    min_score = request.args.get("min_score", 0, type=float)
    return jsonify(engine.list_candidates(limit=limit, min_score=min_score))


@app.get("/api/candidates/<cand_id>")
def candidate_detail(cand_id: str):
    c = engine.get_candidate(cand_id)
    if not c:
        return jsonify({"error": "Candidate not found"}), 404
    return jsonify(c)


@app.post("/api/scan/start")
def scan_start():
    body = request.get_json(silent=True) or {}
    target_index = body.get("target_index")
    if target_index is not None:
        target_index = int(target_index)
    return jsonify(engine.start_scan(target_index=target_index))


@app.post("/api/scan/stop")
def scan_stop():
    return jsonify(engine.stop_scan())


@app.get("/api/scan/tick")
def scan_tick():
    return jsonify(engine.tick())


@app.post("/api/analyze")
def analyze():
    body = request.get_json(silent=True) or {}
    samples = body.get("samples")
    return jsonify(engine.analyze_custom(samples=samples))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
