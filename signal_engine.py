"""
SETI@home-inspired signal analysis engine.

Simulates radio telescope data analysis: noise floors, narrowband carriers,
chirped signals, and occasional high-score "candidate" events — the kinds of
features classic SETI pipelines look for (without claiming real detections).
"""

from __future__ import annotations

import math
import random
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any


# Famous sky regions / target stars used for flavor
SKY_TARGETS = [
    {"name": "Kepler-452b region", "ra": "19h44m", "dec": "+44°16'", "dist_ly": 1400},
    {"name": "Proxima Centauri", "ra": "14h29m", "dec": "-62°40'", "dist_ly": 4.24},
    {"name": "TRAPPIST-1 system", "ra": "23h06m", "dec": "-05°02'", "dist_ly": 40.7},
    {"name": "Tau Ceti", "ra": "01h44m", "dec": "-15°56'", "dist_ly": 11.9},
    {"name": "Gliese 581", "ra": "15h19m", "dec": "-07°43'", "dist_ly": 20.5},
    {"name": "Wow! Signal region (Sagittarius)", "ra": "19h25m", "dec": "-26°57'", "dist_ly": None},
    {"name": "Ross 128", "ra": "11h47m", "dec": "+00°48'", "dist_ly": 11.0},
    {"name": "Luyten's Star", "ra": "07h27m", "dec": "+05°13'", "dist_ly": 12.2},
    {"name": "Wolf 1061", "ra": "16h30m", "dec": "-12°39'", "dist_ly": 14.0},
    {"name": "HD 40307", "ra": "05h54m", "dec": "-60°01'", "dist_ly": 42.0},
    {"name": "Barnard's Star", "ra": "17h57m", "dec": "+04°41'", "dist_ly": 5.96},
    {"name": "Kapteyn's Star", "ra": "05h11m", "dec": "-45°01'", "dist_ly": 12.8},
]

SIGNAL_TYPES = [
    "narrowband_carrier",
    "chirp",
    "pulse_train",
    "noise_spike",
    "rfi_artifact",
    "wow_like",
]

CLASSIFICATIONS = {
    "narrowband_carrier": {
        "label": "Portadora de banda estrecha",
        "desc": "Señal de frecuencia casi monócroma — patrón clásico de búsqueda SETI.",
        "interest": 0.85,
    },
    "chirp": {
        "label": "Chirp / barrido en frecuencia",
        "desc": "Frecuencia que deriva con el tiempo; compatible con corrección Doppler.",
        "interest": 0.9,
    },
    "pulse_train": {
        "label": "Tren de pulsos",
        "desc": "Impulsos periódicos. Puede ser natural (púlsares) o artificial.",
        "interest": 0.7,
    },
    "noise_spike": {
        "label": "Pico de ruido",
        "desc": "Fluctuación térmica del receptor. Baja prioridad.",
        "interest": 0.15,
    },
    "rfi_artifact": {
        "label": "RFI (interferencia terrestre)",
        "desc": "Probable origen humano: satélites, radar, wifi, etc.",
        "interest": 0.05,
    },
    "wow_like": {
        "label": "Candidato Wow!-like",
        "desc": "Perfil intenso y de corta duración, similar al histórico Wow! de 1977.",
        "interest": 0.98,
    },
}


@dataclass
class Candidate:
    id: str
    work_unit_id: str
    target: dict[str, Any]
    signal_type: str
    frequency_mhz: float
    snr_db: float
    score: float
    bandwidth_hz: float
    duration_s: float
    drift_hz_s: float
    timestamp: float
    classification: dict[str, str]
    spectrum_peak_bin: int
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


@dataclass
class WorkUnit:
    id: str
    target: dict[str, Any]
    telescope: str
    band: str
    center_freq_mhz: float
    bandwidth_mhz: float
    samples: int
    created_at: float
    status: str = "pending"  # pending | processing | done
    progress: float = 0.0
    candidates: list[str] = field(default_factory=list)
    cpu_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SignalEngine:
    """In-memory SETI analysis simulator."""

    TELESCOPES = [
        "Arecibo Archive (historical)",
        "Green Bank Telescope (sim)",
        "Allen Telescope Array (sim)",
        "Parkes Murriyang (sim)",
        "FAST (sim)",
        "MeerKAT (sim)",
    ]

    BANDS = [
        ("L-band", 1420.4, 2.5),   # hydrogen line neighborhood
        ("S-band", 2300.0, 5.0),
        ("C-band", 5000.0, 10.0),
        ("X-band", 8400.0, 8.0),
    ]

    def __init__(self, n_fft: int = 256) -> None:
        self.n_fft = n_fft
        self.work_units: dict[str, WorkUnit] = {}
        self.candidates: dict[str, Candidate] = {}
        self.stats = {
            "work_units_completed": 0,
            "candidates_found": 0,
            "high_interest": 0,
            "total_cpu_seconds": 0.0,
            "bytes_analyzed": 0,
            "scans_run": 0,
            "started_at": time.time(),
        }
        self._waterfall: list[list[float]] = []
        self._current_spectrum: list[float] = [0.0] * n_fft
        self._scanning = False
        self._scan_target: dict[str, Any] | None = None
        self._seed_demo()

    def _seed_demo(self) -> None:
        """Create a couple of historical-flavor candidates so the UI isn't empty."""
        wu = self.create_work_unit(auto=True)
        wu.status = "done"
        wu.progress = 1.0
        c = self._make_candidate(
            wu,
            signal_type="wow_like",
            force_score=92.5,
            freq=1420.4556,
            snr=30.0,
            notes="Réplica educativa del perfil Wow! (Ohio State, 1977). No es una detección real.",
        )
        self.candidates[c.id] = c
        wu.candidates.append(c.id)
        self.stats["work_units_completed"] = 1
        self.stats["candidates_found"] = 1
        self.stats["high_interest"] = 1

    # ── Work units ──────────────────────────────────────────────

    def create_work_unit(self, auto: bool = True, target_index: int | None = None) -> WorkUnit:
        if target_index is not None and 0 <= target_index < len(SKY_TARGETS):
            target = SKY_TARGETS[target_index]
        else:
            target = random.choice(SKY_TARGETS)
        band_name, center, bw = random.choice(self.BANDS)
        # Bias L-band / hydrogen line often (classic SETI)
        if random.random() < 0.45:
            band_name, center, bw = self.BANDS[0]
        wu = WorkUnit(
            id=f"WU-{uuid.uuid4().hex[:10].upper()}",
            target=target,
            telescope=random.choice(self.TELESCOPES),
            band=band_name,
            center_freq_mhz=round(center + random.uniform(-bw / 4, bw / 4), 4),
            bandwidth_mhz=bw,
            samples=random.choice([2**18, 2**19, 2**20]),
            created_at=time.time(),
        )
        self.work_units[wu.id] = wu
        return wu

    def list_work_units(self, limit: int = 20) -> list[dict[str, Any]]:
        items = sorted(self.work_units.values(), key=lambda w: w.created_at, reverse=True)
        return [w.to_dict() for w in items[:limit]]

    # ── Scanning / spectrum ─────────────────────────────────────

    def start_scan(self, target_index: int | None = None) -> dict[str, Any]:
        if target_index is not None and 0 <= target_index < len(SKY_TARGETS):
            self._scan_target = SKY_TARGETS[target_index]
        else:
            self._scan_target = random.choice(SKY_TARGETS)
        self._scanning = True
        self.stats["scans_run"] += 1
        return {
            "scanning": True,
            "target": self._scan_target,
            "message": f"Antena apuntando a {self._scan_target['name']}",
        }

    def stop_scan(self) -> dict[str, Any]:
        self._scanning = False
        return {"scanning": False, "message": "Escaneo detenido"}

    def tick(self) -> dict[str, Any]:
        """Advance simulation one frame: noise + optional injected signals."""
        spectrum = self._generate_spectrum()
        self._current_spectrum = spectrum
        self._waterfall.append(spectrum)
        if len(self._waterfall) > 80:
            self._waterfall = self._waterfall[-80:]

        event = None
        # Occasional candidate while scanning
        if self._scanning and random.random() < 0.04:
            event = self._process_random_detection()

        return {
            "scanning": self._scanning,
            "target": self._scan_target,
            "spectrum": spectrum,
            "waterfall": self._waterfall[-40:],
            "event": event,
            "timestamp": time.time(),
        }

    def _generate_spectrum(self) -> list[float]:
        n = self.n_fft
        # Pink-ish noise floor
        base = [max(0.0, random.gauss(0.18, 0.05)) for _ in range(n)]
        # Hydrogen line hump near center bins if L-band vibe
        for i in range(n):
            x = (i - n / 2) / (n / 8)
            base[i] += 0.06 * math.exp(-0.5 * x * x)

        # Random narrow spikes
        if random.random() < 0.35:
            bin_i = random.randint(8, n - 9)
            amp = random.uniform(0.4, 1.6)
            width = random.randint(1, 3)
            for k in range(-width, width + 1):
                j = bin_i + k
                if 0 <= j < n:
                    base[j] += amp * math.exp(-0.5 * (k / max(width, 1)) ** 2)

        # Strong wow-like rare spike
        if self._scanning and random.random() < 0.015:
            bin_i = random.randint(20, n - 21)
            for k in range(-2, 3):
                j = bin_i + k
                base[j] += 2.2 * math.exp(-0.5 * (k / 1.2) ** 2)

        # Clamp / normalize for display 0..1-ish
        mx = max(base) or 1.0
        scale = max(mx, 1.0)
        return [round(min(v / scale, 1.0), 4) for v in base]

    # ── Process work unit ───────────────────────────────────────

    def process_work_unit(self, work_unit_id: str | None = None) -> dict[str, Any]:
        if work_unit_id and work_unit_id in self.work_units:
            wu = self.work_units[work_unit_id]
        else:
            wu = self.create_work_unit()

        wu.status = "processing"
        wu.progress = 0.0

        # Simulate multi-step analysis
        steps = 8
        found: list[Candidate] = []
        for step in range(steps):
            wu.progress = round((step + 1) / steps, 3)
            # Chance of finding something each step
            if random.random() < 0.22:
                st = self._pick_signal_type()
                c = self._make_candidate(wu, signal_type=st)
                found.append(c)
                self.candidates[c.id] = c
                wu.candidates.append(c.id)

        wu.status = "done"
        wu.progress = 1.0
        wu.cpu_seconds = round(random.uniform(2.5, 18.0), 2)
        self.stats["work_units_completed"] += 1
        self.stats["candidates_found"] += len(found)
        self.stats["total_cpu_seconds"] += wu.cpu_seconds
        self.stats["bytes_analyzed"] += wu.samples * 4  # float32-ish
        self.stats["high_interest"] += sum(1 for c in found if c.score >= 70)

        return {
            "work_unit": wu.to_dict(),
            "candidates": [c.to_dict() for c in found],
            "summary": {
                "candidates": len(found),
                "best_score": max((c.score for c in found), default=0),
                "cpu_seconds": wu.cpu_seconds,
            },
        }

    def _process_random_detection(self) -> dict[str, Any]:
        wu = self.create_work_unit()
        wu.status = "done"
        wu.progress = 1.0
        st = self._pick_signal_type(prefer_interesting=True)
        c = self._make_candidate(wu, signal_type=st)
        self.candidates[c.id] = c
        wu.candidates.append(c.id)
        self.stats["candidates_found"] += 1
        if c.score >= 70:
            self.stats["high_interest"] += 1
        self.stats["work_units_completed"] += 1
        return c.to_dict()

    def _pick_signal_type(self, prefer_interesting: bool = False) -> str:
        if prefer_interesting:
            weights = {
                "narrowband_carrier": 25,
                "chirp": 20,
                "pulse_train": 15,
                "noise_spike": 15,
                "rfi_artifact": 15,
                "wow_like": 10,
            }
        else:
            weights = {
                "narrowband_carrier": 18,
                "chirp": 12,
                "pulse_train": 12,
                "noise_spike": 30,
                "rfi_artifact": 25,
                "wow_like": 3,
            }
        types = list(weights.keys())
        w = [weights[t] for t in types]
        return random.choices(types, weights=w, k=1)[0]

    def _make_candidate(
        self,
        wu: WorkUnit,
        signal_type: str,
        force_score: float | None = None,
        freq: float | None = None,
        snr: float | None = None,
        notes: str = "",
    ) -> Candidate:
        meta = CLASSIFICATIONS[signal_type]
        base_interest = meta["interest"]
        snr_val = snr if snr is not None else random.uniform(5, 35) * (0.5 + base_interest)
        snr_val = round(min(snr_val, 45.0), 2)
        if force_score is not None:
            score = force_score
        else:
            score = round(
                min(
                    99.5,
                    base_interest * 70
                    + (snr_val / 45) * 25
                    + random.uniform(-5, 8),
                ),
                1,
            )
            if signal_type in ("noise_spike", "rfi_artifact"):
                score = min(score, 45.0)

        freq_val = (
            freq
            if freq is not None
            else round(wu.center_freq_mhz + random.uniform(-wu.bandwidth_mhz / 2, wu.bandwidth_mhz / 2), 6)
        )

        return Candidate(
            id=f"CAND-{uuid.uuid4().hex[:8].upper()}",
            work_unit_id=wu.id,
            target=wu.target,
            signal_type=signal_type,
            frequency_mhz=freq_val,
            snr_db=snr_val,
            score=score,
            bandwidth_hz=round(random.uniform(0.5, 50.0 if signal_type != "narrowband_carrier" else 2.0), 2),
            duration_s=round(random.uniform(0.8, 72.0), 2),
            drift_hz_s=round(random.uniform(-2.5, 2.5), 3),
            timestamp=time.time(),
            classification={
                "label": meta["label"],
                "desc": meta["desc"],
            },
            spectrum_peak_bin=random.randint(0, self.n_fft - 1),
            notes=notes
            or (
                "Señal simulada con fines educativos. No representa una detección real de inteligencia extraterrestre."
            ),
        )

    # ── Queries ─────────────────────────────────────────────────

    def list_candidates(self, limit: int = 50, min_score: float = 0) -> list[dict[str, Any]]:
        items = [
            c
            for c in self.candidates.values()
            if c.score >= min_score
        ]
        items.sort(key=lambda c: (c.score, c.timestamp), reverse=True)
        return [c.to_dict() for c in items[:limit]]

    def get_candidate(self, cand_id: str) -> dict[str, Any] | None:
        c = self.candidates.get(cand_id)
        return c.to_dict() if c else None

    def get_stats(self) -> dict[str, Any]:
        uptime = time.time() - self.stats["started_at"]
        return {
            **self.stats,
            "uptime_seconds": round(uptime, 1),
            "active_work_units": sum(1 for w in self.work_units.values() if w.status != "done"),
            "total_candidates": len(self.candidates),
            "scanning": self._scanning,
            "current_target": self._scan_target,
            "targets_available": len(SKY_TARGETS),
        }

    def get_targets(self) -> list[dict[str, Any]]:
        return list(SKY_TARGETS)

    def analyze_custom(self, samples: list[float] | None = None) -> dict[str, Any]:
        """Run a lightweight 'analysis' on client-supplied or generated samples."""
        n = self.n_fft
        if not samples or len(samples) < 16:
            samples = [random.gauss(0, 1) for _ in range(n * 2)]
        # Pseudo power spectrum via binning abs values
        chunk = samples[: n * 2]
        spectrum = []
        step = max(1, len(chunk) // n)
        for i in range(n):
            window = chunk[i * step : (i + 1) * step] or [0.0]
            power = sum(abs(x) for x in window) / len(window)
            spectrum.append(power)

        mx = max(spectrum) or 1.0
        norm = [round(v / mx, 4) for v in spectrum]
        peak_bin = max(range(n), key=lambda i: norm[i])
        peak = norm[peak_bin]
        mean = sum(norm) / n
        snr_est = (peak - mean) / (mean + 1e-9)

        interesting = snr_est > 2.5 and peak > 0.7
        result: dict[str, Any] = {
            "spectrum": norm,
            "peak_bin": peak_bin,
            "peak_power": peak,
            "snr_estimate": round(float(snr_est), 3),
            "interesting": interesting,
        }
        if interesting:
            wu = self.create_work_unit()
            wu.status = "done"
            wu.progress = 1.0
            c = self._make_candidate(
                wu,
                signal_type="narrowband_carrier" if snr_est < 4 else "chirp",
                snr=min(40.0, snr_est * 8),
            )
            self.candidates[c.id] = c
            wu.candidates.append(c.id)
            self.stats["candidates_found"] += 1
            if c.score >= 70:
                self.stats["high_interest"] += 1
            result["candidate"] = c.to_dict()
        return result
