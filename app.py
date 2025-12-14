
from flask import Flask, request, jsonify, render_template
from datetime import datetime, timezone
import threading

app = Flask(__name__)

lock = threading.Lock()

state = {
    "last_update": None,
    "fix": {
        "valid": False,
        "fix_type": None,
        "quality": None,
        "quality_str": None,
        "time_utc": None,
        "date_utc": None,
        "datetime_utc": None,
        "lat": None,
        "lng": None,
        "alt": None,
        "hdop": None,
        "vdop": None,
        "pdop": None,
        "epe_m": None,
        "sats_in_use": 0,
        "speed_knots": None,
        "speed_kmh": None,
        "speed_ms": None,
        "course_deg": None,
        "mag_var_deg": None,
        "mag_var_dir": None,
    },
    "satellites": {},
    "raw_last_lines": [],
}


def _parse_latlng_dm(value, direction):
    """Convert ddmm.mmmm / dddmm.mmmm and N/S/E/W to decimal degrees."""
    if not value or not direction:
        return None
    try:
        raw = float(value)
    except ValueError:
        return None

    deg = int(raw // 100)
    minutes = raw - deg * 100
    coord = deg + minutes / 60.0

    if direction in ("S", "W"):
        coord = -coord
    return coord


def _talker_to_system(talker):
    if not talker or len(talker) < 3:
        return "GNSS"
    t = talker[1:3]
    if t == "GP":
        return "GPS"
    if t == "GL":
        return "GLONASS"
    if t == "GA":
        return "Galileo"
    if t in ("GB", "BD"):
        return "BeiDou"
    if t == "GQ":
        return "QZSS"
    if t == "GE":
        return "SBAS"
    if t == "GN":
        return "GNSS"
    return "GNSS"


def _ensure_sat(prn, system_name):
    sat = state["satellites"].get(prn)
    if sat is None:
        sat = {
            "system": system_name,
            "elev": None,
            "az": None,
            "snr": None,
            "last_seen": None,
            "used": False,
        }
        state["satellites"][prn] = sat
    else:
        if sat.get("system") is None:
            sat["system"] = system_name
    return sat


def _update_quality_from_gga(quality):
    mapping = {
        0: "無定位 (Invalid)",
        1: "GPS Fix",
        2: "DGPS / SBAS Fix",
        4: "RTK Fixed",
        5: "RTK Float",
        6: "估計 (Estimated)",
    }
    return mapping.get(quality, None)


def _update_epe():
    fix = state["fix"]
    hdop = fix.get("hdop")
    if hdop is None:
        fix["epe_m"] = None
        return
    base_sigma = 5.0
    fix["epe_m"] = hdop * base_sigma


def _update_from_gga(tokens):
    if len(tokens) < 10:
        return

    time_str = tokens[1]
    lat_raw, lat_dir = tokens[2], tokens[3]
    lon_raw, lon_dir = tokens[4], tokens[5]
    quality_str = tokens[6]
    num_sats = tokens[7]
    hdop = tokens[8]
    alt = tokens[9]

    lat = _parse_latlng_dm(lat_raw, lat_dir)
    lng = _parse_latlng_dm(lon_raw, lon_dir)

    try:
        q_val = int(quality_str) if quality_str else None
    except ValueError:
        q_val = None

    try:
        hdop_val = float(hdop) if hdop else None
    except ValueError:
        hdop_val = None

    try:
        alt_val = float(alt) if alt else None
    except ValueError:
        alt_val = None

    try:
        sats_in_use = int(num_sats) if num_sats else 0
    except ValueError:
        sats_in_use = 0

    now_utc = datetime.now(timezone.utc)

    if time_str and len(time_str) >= 6:
        try:
            hour = int(time_str[0:2])
            minute = int(time_str[2:4])
            second = int(time_str[4:6])
            t = now_utc.replace(hour=hour, minute=minute, second=second, microsecond=0)
        except Exception:
            t = now_utc
    else:
        t = now_utc

    with lock:
        state["last_update"] = now_utc.isoformat()
        fix = state["fix"]
        fix["lat"] = lat
        fix["lng"] = lng
        fix["alt"] = alt_val
        fix["hdop"] = hdop_val
        fix["sats_in_use"] = sats_in_use
        fix["time_utc"] = t.isoformat()

        if q_val is not None:
            fix["quality"] = q_val
            fix["quality_str"] = _update_quality_from_gga(q_val)
            fix["valid"] = (q_val != 0)

        _update_epe()


def _update_from_gsa(tokens, talker):
    if len(tokens) < 17:
        return

    mode2 = tokens[2]
    try:
        fix_type = int(mode2)
    except ValueError:
        fix_type = None

    used_sats = [s.strip() for s in tokens[3:15] if s.strip()]

    pdop = tokens[15] if len(tokens) > 15 else ""
    hdop = tokens[16] if len(tokens) > 16 else ""
    vdop = tokens[17] if len(tokens) > 17 else ""

    if vdop and "*" in vdop:
        vdop = vdop.split("*", 1)[0]

    try:
        pdop_val = float(pdop) if pdop else None
    except ValueError:
        pdop_val = None

    try:
        hdop_val = float(hdop) if hdop else None
    except ValueError:
        hdop_val = None

    try:
        vdop_val = float(vdop) if vdop else None
    except ValueError:
        vdop_val = None

    now_utc = datetime.now(timezone.utc)
    system_name = _talker_to_system(tokens[0])

    with lock:
        fix = state["fix"]
        fix["fix_type"] = fix_type

        if pdop_val is not None:
            fix["pdop"] = pdop_val
        if hdop_val is not None:
            fix["hdop"] = hdop_val
        if vdop_val is not None:
            fix["vdop"] = vdop_val

        _update_epe()

        for sat in state["satellites"].values():
            sat["used"] = False

        for prn in used_sats:
            sat = _ensure_sat(prn, system_name)
            sat["used"] = True
            if sat["last_seen"] is None:
                sat["last_seen"] = now_utc.isoformat()


def _update_from_gsv(tokens, talker):
    if len(tokens) < 4:
        return

    now_utc = datetime.now(timezone.utc)
    system_name = _talker_to_system(tokens[0])

    i = 4
    while i + 3 < len(tokens):
        prn = tokens[i].strip()
        elev = tokens[i+1].strip()
        az = tokens[i+2].strip()
        snr = tokens[i+3].strip()

        if not prn:
            i += 4
            continue

        if "*" in snr:
            snr = snr.split("*", 1)[0]

        try:
            elev_val = int(elev) if elev else None
        except ValueError:
            elev_val = None

        try:
            az_val = int(az) if az else None
        except ValueError:
            az_val = None

        try:
            snr_val = int(snr) if snr else None
        except ValueError:
            snr_val = None

        with lock:
            sat = _ensure_sat(prn, system_name)
            sat["elev"] = elev_val
            sat["az"] = az_val
            sat["snr"] = snr_val
            sat["last_seen"] = now_utc.isoformat()

        i += 4


def _update_from_rmc(tokens, talker):
    if len(tokens) < 10:
        return

    time_str = tokens[1]
    status = tokens[2]
    lat_raw, lat_dir = tokens[3], tokens[4]
    lon_raw, lon_dir = tokens[5], tokens[6]
    speed_knots = tokens[7]
    course = tokens[8]
    date_str = tokens[9]
    magvar = tokens[10] if len(tokens) > 10 else ""
    magvar_dir = tokens[11].split("*", 1)[0] if len(tokens) > 11 else ""

    lat = _parse_latlng_dm(lat_raw, lat_dir)
    lng = _parse_latlng_dm(lon_raw, lon_dir)

    try:
        spd_knots_val = float(speed_knots) if speed_knots else None
    except ValueError:
        spd_knots_val = None

    if spd_knots_val is not None:
        spd_kmh_val = spd_knots_val * 1.852
        spd_ms_val = spd_kmh_val / 3.6
    else:
        spd_kmh_val = None
        spd_ms_val = None

    try:
        course_val = float(course) if course else None
    except ValueError:
        course_val = None

    dt_utc = None
    date_utc = None
    time_utc = None
    now_utc = datetime.now(timezone.utc)

    if date_str and len(date_str) == 6 and time_str and len(time_str) >= 6:
        try:
            day = int(date_str[0:2])
            month = int(date_str[2:4])
            year = int(date_str[4:6])
            year += 2000 if year < 80 else 1900

            hour = int(time_str[0:2])
            minute = int(time_str[2:4])
            second = int(time_str[4:6])

            dt_utc = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
            date_utc = dt_utc.date().isoformat()
            time_utc = dt_utc.time().isoformat()
        except Exception:
            dt_utc = None

    try:
        magvar_val = float(magvar) if magvar else None
    except ValueError:
        magvar_val = None

    with lock:
        state["last_update"] = (dt_utc or now_utc).isoformat()
        fix = state["fix"]
        if lat is not None:
            fix["lat"] = lat
        if lng is not None:
            fix["lng"] = lng

        fix["speed_knots"] = spd_knots_val
        fix["speed_kmh"] = spd_kmh_val
        fix["speed_ms"] = spd_ms_val
        fix["course_deg"] = course_val

        if dt_utc is not None:
            fix["datetime_utc"] = dt_utc.isoformat()
            fix["date_utc"] = date_utc
            fix["time_utc"] = dt_utc.isoformat()

        fix["mag_var_deg"] = magvar_val
        fix["mag_var_dir"] = magvar_dir if magvar_dir else None

        if status == "A":
            fix["valid"] = True


def parse_nmea_sentence(line):
    line = line.strip()
    if not line or not line.startswith("$"):
        return

    tokens = line.split(",")
    talker = tokens[0] if tokens else ""

    if talker.endswith("GGA"):
        _update_from_gga(tokens)
    elif talker.endswith("GSA"):
        _update_from_gsa(tokens, talker)
    elif talker.endswith("GSV"):
        _update_from_gsv(tokens, talker)
    elif talker.endswith("RMC"):
        _update_from_rmc(tokens, talker)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/ingest", methods=["POST"])
def ingest():
    nmea_text = request.form.get("nmea")
    if not nmea_text:
        try:
            nmea_text = request.data.decode("utf-8", errors="ignore")
        except Exception:
            nmea_text = ""

    if not nmea_text:
        return jsonify({"status": "error", "reason": "no nmea data"}), 400

    lines = [ln for ln in nmea_text.replace("\r", "\n").split("\n") if ln.strip()]

    with lock:
        state["raw_last_lines"].extend(lines)
        state["raw_last_lines"] = state["raw_last_lines"][-40:]

    for line in lines:
        parse_nmea_sentence(line)

    with lock:
        last_update = state["last_update"]
        sats_count = len(state["satellites"])

    return jsonify({
        "status": "ok",
        "lines": len(lines),
        "satellites_tracked": sats_count,
        "last_update": last_update,
    })


@app.route("/api/status")
def status():
    with lock:
        sats = state["satellites"]
        systems = {}
        systems_used = {}
        used_total = 0
        for prn, sat in sats.items():
            sys_name = sat.get("system") or "GNSS"
            systems[sys_name] = systems.get(sys_name, 0) + 1
            if sat.get("used"):
                used_total += 1
                systems_used[sys_name] = systems_used.get(sys_name, 0) + 1

        gnss_summary = {
            "total": len(sats),
            "used_total": used_total,
            "systems": systems,
            "systems_used": systems_used,
        }

        data = {
            "last_update": state["last_update"],
            "fix": state["fix"],
            "satellites": state["satellites"],
            "raw_last_lines": state["raw_last_lines"],
            "gnss_summary": gnss_summary,
        }
    return jsonify(data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
