
let latestStatusData = null;
let skyGlobeSatPoints = [];
let selectedOrbitPrn = null;
let orbitSelectorInitialized = false;
const skyGlobeState = { yaw: 0, pitch: 0, isDragging: false, lastX: 0, lastY: 0 };
let orbitMapImage = null;
let orbitMapImageLoaded = false;
let orbitSatIcon = null;
let orbitUserIcon = null;

function initOrbitMapImage() {
  if (!orbitMapImage) {
    orbitMapImage = new Image();
    orbitMapImage.onload = () => {
      orbitMapImageLoaded = true;
      if (latestStatusData) {
        updateOrbitPanel(latestStatusData);
      }
    };
    orbitMapImage.src = "/static/world_map.png";
  }

  if (!orbitSatIcon) {
    orbitSatIcon = new Image();
    orbitSatIcon.src = "/static/subsat_icon.png";
  }

  if (!orbitUserIcon) {
    orbitUserIcon = new Image();
    orbitUserIcon.src = "/static/user_marker.png";
  }
}


async function fetchStatus() {
  try {
    const resp = await fetch("/api/status");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    latestStatusData = data;
    updateInfo(data);
    updateGnssCards(data);
    updateSatTable(data);
    drawSkyplot(data);
    drawSkyGlobe(data);
    drawCompass(data);
    updateOrbitPanel(data);
    updateRawNmea(data);
  } catch (err) {
    console.error("fetchStatus error:", err);
  }
}

function safeToFixed(val, digits) {
  if (val === null || val === undefined) return "--";
  if (typeof val !== "number" || isNaN(val)) return "--";
  return val.toFixed(digits);
}

function pad2(n) {
  const v = Math.trunc(Number(n));
  if (!isFinite(v)) return "00";
  return String(v).padStart(2, "0");
}

function parseYMD(ymd) {
  if (!ymd) return null;
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function dayOfYear(y, mo, d) {
  // mo: 1..12
  const dt = Date.UTC(y, mo - 1, d);
  const jan1 = Date.UTC(y, 0, 1);
  return Math.floor((dt - jan1) / 86400000) + 1;
}

function normalizeDeg(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

function rad2deg(rad) {
  return (rad * 180) / Math.PI;
}

// 以經度粗略估算時區（小時）
function estimateTzOffsetHours(lonDeg) {
  if (typeof lonDeg !== "number" || isNaN(lonDeg)) return 0;
  return Math.round(lonDeg / 15);
}

// 台灣本地時區（固定 UTC+8）
const TW_TZ_OFFSET_HOURS = 8;


// NOAA 簡化日出/日落計算（回傳 UTC 小時數 0..24；極區無日出/日落時回傳 null）
function calcSunTimeUTC(isSunrise, y, mo, d, latDeg, lonDeg) {
  const N = dayOfYear(y, mo, d);
  const lngHour = lonDeg / 15;
  const t = N + ((isSunrise ? 6 : 18) - lngHour) / 24;

  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(deg2rad(M)) + 0.020 * Math.sin(deg2rad(2 * M)) + 282.634;
  L = normalizeDeg(L);

  let RA = rad2deg(Math.atan(0.91764 * Math.tan(deg2rad(L))));
  RA = normalizeDeg(RA);

  // 將 RA 調整到與 L 同象限
  const Lquadrant = Math.floor(L / 90) * 90;
  const RAquadrant = Math.floor(RA / 90) * 90;
  RA = RA + (Lquadrant - RAquadrant);
  RA = RA / 15; // 轉為小時

  const sinDec = 0.39782 * Math.sin(deg2rad(L));
  const cosDec = Math.cos(Math.asin(sinDec));

  const zenith = 90.833; // 官方日出日落（含大氣折射）
  const cosH =
    (Math.cos(deg2rad(zenith)) - sinDec * Math.sin(deg2rad(latDeg))) /
    (cosDec * Math.cos(deg2rad(latDeg)));

  if (cosH > 1) return null;   // 太陽整天在地平線下（無日出）
  if (cosH < -1) return null;  // 太陽整天在地平線上（無日落）

  let H = isSunrise ? 360 - rad2deg(Math.acos(cosH)) : rad2deg(Math.acos(cosH));
  H = H / 15;

  const T = H + RA - 0.06571 * t - 6.622;
  let UT = T - lngHour;
  UT = ((UT % 24) + 24) % 24;
  return UT;
}

function formatUTCHours(utcHours) {
  if (utcHours === null || utcHours === undefined || !isFinite(utcHours)) return "--";
  const h = Math.floor(utcHours);
  const mFloat = (utcHours - h) * 60;
  const m = Math.floor(mFloat);
  const s = Math.floor((mFloat - m) * 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function computeSunriseSunsetTaiwan(dateUtcStr, lat, lon) {
  const ymd = parseYMD(dateUtcStr);
  if (!ymd) return { sunrise: "--", sunset: "--" };
  if (typeof lat !== "number" || typeof lon !== "number" || isNaN(lat) || isNaN(lon)) {
    return { sunrise: "--", sunset: "--" };
  }

  // 先用 NOAA 算出「UTC 小時」
  const riseUTC = calcSunTimeUTC(true, ymd.y, ymd.mo, ymd.d, lat, lon);
  const setUTC = calcSunTimeUTC(false, ymd.y, ymd.mo, ymd.d, lat, lon);

  // 再轉成台灣本地時間（UTC+8）
  const wrap24 = (h) => ((h % 24) + 24) % 24;
  const riseLocal = riseUTC == null ? null : wrap24(riseUTC + TW_TZ_OFFSET_HOURS);
  const setLocal = setUTC == null ? null : wrap24(setUTC + TW_TZ_OFFSET_HOURS);

  const sunriseStr = formatUTCHours(riseLocal);
  const sunsetStr = formatUTCHours(setLocal);

  return { sunrise: sunriseStr, sunset: sunsetStr };
}


// 將 ISO/字串時間縮短為單行易讀格式（避免微秒/時區造成欄位過長）
// 例：2025-12-14T06:30:14.426137+00:00 -> 12-14 06:30:14
function formatLastSeen(ts) {
  if (!ts) return "--";
  const s = String(ts);

  // 優先擷取 YYYY-MM-DDTHH:MM:SS 或 YYYY-MM-DD HH:MM:SS
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) {
    const mm = m[2];
    const dd = m[3];
    const hhmmss = m[4];
    return `${mm}-${dd} ${hhmmss}`;
  }

  // 次佳：嘗試直接取前 19 字元並移除 T
  if (s.length >= 19) {
    return s.slice(0, 19).replace("T", " ");
  }

  return s.replace("T", " ");
}

function courseToText(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) return "--";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  let d = deg % 360;
  if (d < 0) d += 360;
  const idx = Math.round(d / 45) % 8;
  return `${deg.toFixed(1)}° (${dirs[idx]})`;
}

function magVarToText(deg, dir) {
  if (deg === null || deg === undefined || isNaN(deg)) return "--";
  if (!dir) return `${deg.toFixed(1)}°`;
  return `${deg.toFixed(1)}° ${dir}`;
}

function updateFixBadge(fix, gnssSummary) {
  const badge = document.getElementById("fix_status_badge");
  if (!badge) return;

  let cls = "fix-badge fix-badge-unknown";
  let text = "狀態未知";

  const valid = !!fix.valid;
  const fixType = fix.fix_type;
  const quality = fix.quality;
  const qualityStr = fix.quality_str || "";

  if (!valid || !fixType || fixType === 1) {
    cls = "fix-badge fix-badge-nofix";
    text = "無定位 (No Fix)";
  } else if (quality === 2 || /DGPS|SBAS/i.test(qualityStr)) {
    cls = "fix-badge fix-badge-dgps";
    text = "DGPS / SBAS Fix";
  } else if (fixType === 3) {
    cls = "fix-badge fix-badge-3d";
    text = "3D Fix";
  } else if (fixType === 2) {
    cls = "fix-badge fix-badge-2d";
    text = "2D Fix";
  }

  const satsUsed = gnssSummary?.used_total ?? fix.sats_in_use ?? "--";
  const satsTotal = gnssSummary?.total ?? "--";

  badge.className = cls;
  badge.textContent = `${text}｜Used: ${satsUsed}/${satsTotal}`;
}

function updateInfo(data) {
  const fix = data.fix || {};
  const gnss = data.gnss_summary || {};

  document.getElementById("last_update").textContent = data.last_update || "--";
  document.getElementById("date_utc").textContent = fix.date_utc || "--";
  document.getElementById("time_utc").textContent = fix.time_utc || "--";

  // 日出/日落（以 GPS UTC 日期 + 目前定位的緯經度計算，顯示為台灣本地時間 UTC+8）
  const sunriseEl = document.getElementById("sunrise_utc");
  const sunsetEl = document.getElementById("sunset_utc");
  if (sunriseEl || sunsetEl) {
    const sun = computeSunriseSunsetTaiwan(fix.date_utc, fix.lat, fix.lng);
    if (sunriseEl) sunriseEl.textContent = sun.sunrise;
    if (sunsetEl) sunsetEl.textContent = sun.sunset;
  }

  const valid = fix.valid ? "有效" : "無效 / 無 Fix";
  let fixTypeStr = "--";
  if (fix.fix_type === 2) fixTypeStr = "2D Fix";
  else if (fix.fix_type === 3) fixTypeStr = "3D Fix";
  else if (fix.fix_type === 1) fixTypeStr = "無 Fix";

  document.getElementById("fix_type").textContent = `${valid}（${fixTypeStr}）`;

  const qStr = fix.quality_str || (fix.quality != null ? String(fix.quality) : "--");
  document.getElementById("fix_quality").textContent = qStr;

  document.getElementById("lat").textContent =
    fix.lat != null ? fix.lat.toFixed(6) : "--";
  document.getElementById("lng").textContent =
    fix.lng != null ? fix.lng.toFixed(6) : "--";
  document.getElementById("alt").textContent =
    fix.alt != null ? fix.alt.toFixed(1) + " m" : "--";

  document.getElementById("pdop").textContent = safeToFixed(fix.pdop, 2);
  document.getElementById("hdop").textContent = safeToFixed(fix.hdop, 2);
  document.getElementById("vdop").textContent = safeToFixed(fix.vdop, 2);

  document.getElementById("sats_in_use").textContent =
    fix.sats_in_use != null ? fix.sats_in_use : "--";

  const sats = data.satellites || {};
  document.getElementById("sats_total").textContent = Object.keys(sats).length;

  if (fix.speed_kmh != null && !isNaN(fix.speed_kmh)) {
    const ms = fix.speed_ms != null ? fix.speed_ms.toFixed(2) : "--";
    document.getElementById("speed").textContent =
      `${fix.speed_kmh.toFixed(2)} km/h (${ms} m/s)`;
  } else {
    document.getElementById("speed").textContent = "--";
  }

  document.getElementById("course").textContent =
    fix.course_deg != null ? courseToText(fix.course_deg) : "--";

  document.getElementById("magvar").textContent =
    magVarToText(fix.mag_var_deg, fix.mag_var_dir);

  const epe = fix.epe_m;
  if (epe != null && !isNaN(epe)) {
    document.getElementById("epe").textContent = `${epe.toFixed(1)} m`;
    const cep50 = 0.5 * epe;
    const cep95 = 1.73 * epe;
    document.getElementById("cep50").textContent = `${cep50.toFixed(1)} m`;
    document.getElementById("cep95").textContent = `${cep95.toFixed(1)} m`;
  } else {
    document.getElementById("epe").textContent = "--";
    document.getElementById("cep50").textContent = "--";
    document.getElementById("cep95").textContent = "--";
  }

  updateFixBadge(fix, gnss);
}

function updateGnssCards(data) {
  const container = document.getElementById("gnss_cards");
  if (!container) return;
  container.innerHTML = "";

  const sats = data.satellites || {};
  const systems = {};
  for (const [prn, sat] of Object.entries(sats)) {
    const sys = sat.system || "GNSS";
    if (!systems[sys]) {
      systems[sys] = { visible: 0, used: 0, maxSnr: null };
    }
    systems[sys].visible += 1;
    if (sat.used) systems[sys].used += 1;
    if (typeof sat.snr === "number" && !isNaN(sat.snr)) {
      if (systems[sys].maxSnr === null || sat.snr > systems[sys].maxSnr) {
        systems[sys].maxSnr = sat.snr;
      }
    }
  }

  const sysOrder = ["GPS", "GLONASS", "Galileo", "BeiDou", "QZSS", "SBAS", "GNSS"];
  const sysList = Object.keys(systems).sort((a, b) => {
    const ia = sysOrder.indexOf(a);
    const ib = sysOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  if (!sysList.length) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "gnss-card";
    emptyDiv.textContent = "尚未收到衛星資訊";
    container.appendChild(emptyDiv);
    return;
  }

  for (const sys of sysList) {
    const info = systems[sys];
    const card = document.createElement("div");
    card.className = "gnss-card";

    const header = document.createElement("div");
    header.className = "gnss-card-header";

    const title = document.createElement("div");
    title.className = "gnss-card-title";
    title.textContent = sys;
    header.appendChild(title);

    const tag = document.createElement("div");
    tag.className = "gnss-card-tag";
    tag.textContent = `${info.used}/${info.visible}`;
    header.appendChild(tag);

    card.appendChild(header);

    const line1 = document.createElement("div");
    line1.className = "gnss-card-line";
    line1.innerHTML = `<span class="label">使用中：</span><span class="value">${info.used}</span>`;
    card.appendChild(line1);

    const line2 = document.createElement("div");
    line2.className = "gnss-card-line";
    line2.innerHTML = `<span class="label">可見：</span><span class="value">${info.visible}</span>`;
    card.appendChild(line2);

    const line3 = document.createElement("div");
    line3.className = "gnss-card-line";
    const maxSnrText = info.maxSnr != null ? info.maxSnr.toFixed(0) + " dB" : "--";
    line3.innerHTML = `<span class="label">最強 SNR：</span><span class="value">${maxSnrText}</span>`;
    card.appendChild(line3);

    container.appendChild(card);
  }
}

function updateSatTable(data) {
  const tbody = document.querySelector("#sat_table tbody");
  tbody.innerHTML = "";
  const sats = data.satellites || {};

  const entries = Object.entries(sats).sort((a, b) => {
    const pa = parseInt(a[0], 10);
    const pb = parseInt(b[0], 10);
    if (isNaN(pa) || isNaN(pb)) return a[0].localeCompare(b[0]);
    return pa - pb;
  });

  for (const [prn, sat] of entries) {
    const tr = document.createElement("tr");

    const tdPrn = document.createElement("td");
    tdPrn.textContent = prn;
    tr.appendChild(tdPrn);

    const tdSys = document.createElement("td");
    tdSys.textContent = sat.system || "";
    tr.appendChild(tdSys);

    const tdElev = document.createElement("td");
    tdElev.textContent = sat.elev != null ? sat.elev : "--";
    tr.appendChild(tdElev);

    const tdAz = document.createElement("td");
    tdAz.textContent = sat.az != null ? sat.az : "--";
    tr.appendChild(tdAz);

    const tdSnr = document.createElement("td");
    const snrVal = sat.snr;
    const snrText = document.createElement("span");
    snrText.textContent = snrVal != null ? snrVal : "--";
    tdSnr.appendChild(snrText);

    const snrBar = document.createElement("span");
    snrBar.classList.add("snr-bar");

    let blocks = 0;
    if (typeof snrVal === "number" && !isNaN(snrVal)) {
      blocks = Math.max(1, Math.min(5, Math.round(snrVal / 10)));
    }
    for (let i = 0; i < 5; i++) {
      const block = document.createElement("span");
      block.classList.add("snr-block");
      if (i < blocks && typeof snrVal === "number" && !isNaN(snrVal)) {
        block.style.backgroundColor = snrToColor(snrVal);
      }
      snrBar.appendChild(block);
    }
    tdSnr.appendChild(snrBar);
    tr.appendChild(tdSnr);

    const tdUsed = document.createElement("td");
    const span = document.createElement("span");
    span.classList.add("badge");
    if (sat.used) {
      span.classList.add("badge-used");
      span.textContent = "使用中";
    } else {
      span.classList.add("badge-unused");
      span.textContent = "未使用";
    }
    tdUsed.appendChild(span);
    tr.appendChild(tdUsed);

    const tdLast = document.createElement("td");
    tdLast.textContent = formatLastSeen(sat.last_seen);
    // 滑鼠懸停可看完整原始字串（含微秒/時區）
    tdLast.title = sat.last_seen || "";
    tr.appendChild(tdLast);

    tbody.appendChild(tr);
  }
}

function snrToColor(snr) {
  if (snr === null || snr === undefined || isNaN(snr)) {
    return "#6b7280";
  }
  const maxSnr = 45;
  let t = snr / maxSnr;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const r1 = 239, g1 = 68, b1 = 68;
  const r2 = 34,  g2 = 197, b2 = 94;

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `rgb(${r},${g},${b})`;
}

function drawSkyplot(data) {
  const canvas = document.getElementById("skyplot");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 12;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#020617";
  ctx.fill();
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.stroke();

  [30, 60].forEach((el) => {
    const r = radius * (1 - el / 90);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 0.7;
    ctx.stroke();
  });

  const dirs = [
    { label: "N", angle: 0 },
    { label: "E", angle: 90 },
    { label: "S", angle: 180 },
    { label: "W", angle: 270 },
  ];
  ctx.fillStyle = "#9ca3af";
  ctx.font = "12px system-ui";
  dirs.forEach((d) => {
    const rad = (d.angle * Math.PI) / 180;
    const tx = Math.sin(rad) * (radius + 14);
    const ty = -Math.cos(rad) * (radius + 14);
    ctx.fillText(d.label, tx - 4, ty + 4);
  });

  const sats = data.satellites || {};
  for (const [prn, sat] of Object.entries(sats)) {
    if (sat.elev == null || sat.az == null) continue;

    const el = sat.elev;
    const az = sat.az;

    const r = radius * (1 - el / 90);
    const rad = (az * Math.PI) / 180;

    const x = Math.sin(rad) * r;
    const y = -Math.cos(rad) * r;

    let dotColor = "#3b82f6";
    if (sat.used) {
      dotColor = "#22c55e";
    }
    if (sat.snr != null && sat.snr < 20) {
      dotColor = "#f97316";
    }

    const pointRadius = sat.snr != null && sat.snr > 35 ? 6 : 4;

    ctx.beginPath();
    ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "10px system-ui";
    ctx.fillText(prn, x + 6, y - 2);
  }

  ctx.restore();
}

function drawCompass(data) {
  const canvas = document.getElementById("compass_canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 10;

  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#020617";
  ctx.fill();
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const inner = radius - 6;
    const outer = radius;
    const x1 = Math.sin(rad) * inner;
    const y1 = -Math.cos(rad) * inner;
    const x2 = Math.sin(rad) * outer;
    const y2 = -Math.cos(rad) * outer;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = deg % 30 === 0 ? "#4b5563" : "#111827";
    ctx.lineWidth = deg % 30 === 0 ? 1.2 : 0.6;
    ctx.stroke();
  }

  const dirs = [
    { label: "N", angle: 0 },
    { label: "E", angle: 90 },
    { label: "S", angle: 180 },
    { label: "W", angle: 270 },
  ];
  ctx.font = "12px system-ui";
  dirs.forEach((d) => {
    const rad = (d.angle * Math.PI) / 180;
    const rText = radius - 18;
    const tx = Math.sin(rad) * rText;
    const ty = -Math.cos(rad) * rText;
    ctx.fillStyle = d.label === "N" ? "#f97316" : "#9ca3af";
    ctx.fillText(d.label, tx - 4, ty + 4);
  });

  const fix = data.fix || {};
  const courseDeg = fix.course_deg;
  const speedKmh = fix.speed_kmh;

  if (courseDeg != null && !isNaN(courseDeg)) {
    const rad = (courseDeg * Math.PI) / 180;

    const arrowLen = radius - 30;
    const x = Math.sin(rad) * arrowLen;
    const y = -Math.cos(rad) * arrowLen;

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    ctx.stroke();

    const headLen = 10;
    const leftRad = rad + Math.PI * 0.75;
    const rightRad = rad - Math.PI * 0.75;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(leftRad) * headLen, y - Math.cos(leftRad) * headLen);
    ctx.lineTo(x + Math.sin(rightRad) * headLen, y - Math.cos(rightRad) * headLen);
    ctx.closePath();
    ctx.fillStyle = "#22c55e";
    ctx.fill();
  }

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "14px system-ui";
  let speedText = "-- km/h";
  if (speedKmh != null && !isNaN(speedKmh)) {
    speedText = speedKmh.toFixed(2) + " km/h";
  }
  ctx.fillText(speedText, -ctx.measureText(speedText).width / 2, 8);

  ctx.restore();
}


function rotateAndProjectOnSphere(x, y, z, radius) {
  const yaw = skyGlobeState.yaw;
  const pitch = skyGlobeState.pitch;

  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  let x1 = x * cosYaw - z * sinYaw;
  let z1 = x * sinYaw + z * cosYaw;

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  let y1 = y * cosPitch - z1 * sinPitch;
  let z2 = y * sinPitch + z1 * cosPitch;

  return {
    x: x1 * radius,
    y: -y1 * radius,
    z: z2,
  };
}



function deg2rad(d) {
  return (d * Math.PI) / 180;
}

function rad2deg(r) {
  return (r * 180) / Math.PI;
}

// 根據接收機位置 (lat/lon) 與選取衛星的 Elevation / Azimuth
// 粗略估算該衛星子星點位置與軌道高度、速度。
// 這裡假設 GPS 類中軌道高度約 20,200 km，作為示意用途。
function computeSubSatellitePoint(latDeg, lonDeg, elevDeg, azDeg) {
  if (
    latDeg == null ||
    lonDeg == null ||
    elevDeg == null ||
    azDeg == null
  ) {
    return null;
  }

  const Re = 6378137.0; // 地球半徑 (m)
  const h = 20200000.0; // 假設 GPS 衛星高度 (m)
  const Rs = Re + h;

  const phi = deg2rad(latDeg);
  const lam = deg2rad(lonDeg);
  const el = deg2rad(elevDeg);
  const az = deg2rad(azDeg);

  const cosphi = Math.cos(phi);
  const sinphi = Math.sin(phi);
  const coslam = Math.cos(lam);
  const sinlam = Math.sin(lam);

  const rg = {
    x: Re * cosphi * coslam,
    y: Re * cosphi * sinlam,
    z: Re * sinphi,
  };

  const e = { x: -sinlam, y: coslam, z: 0 };
  const n = { x: -sinphi * coslam, y: -sinphi * sinlam, z: cosphi };
  const u = { x: cosphi * coslam, y: cosphi * sinlam, z: sinphi };

  const cosEl = Math.cos(el);
  const sinEl = Math.sin(el);

  const d_enu = {
    e: cosEl * Math.sin(az),
    n: cosEl * Math.cos(az),
    u: sinEl,
  };

  const d = {
    x: e.x * d_enu.e + n.x * d_enu.n + u.x * d_enu.u,
    y: e.y * d_enu.e + n.y * d_enu.n + u.y * d_enu.u,
    z: e.z * d_enu.e + n.z * d_enu.n + u.z * d_enu.u,
  };

  const dd = d.x * d.x + d.y * d.y + d.z * d.z;
  const rd = rg.x * d.x + rg.y * d.y + rg.z * d.z;
  const rr = rg.x * rg.x + rg.y * rg.y + rg.z * rg.z;

  const A = dd;
  const B = 2 * rd;
  const C = rr - Rs * Rs;
  const disc = B * B - 4 * A * C;
  if (!(disc > 0)) {
    return null;
  }
  const t = (-B + Math.sqrt(disc)) / (2 * A);
  const rs = {
    x: rg.x + t * d.x,
    y: rg.y + t * d.y,
    z: rg.z + t * d.z,
  };

  const rsNorm = Math.sqrt(rs.x * rs.x + rs.y * rs.y + rs.z * rs.z);
  const scale = Re / rsNorm;
  const rgeo = {
    x: rs.x * scale,
    y: rs.y * scale,
    z: rs.z * scale,
  };

  const lonSat = Math.atan2(rgeo.y, rgeo.x);
  const latSat = Math.atan2(
    rgeo.z,
    Math.sqrt(rgeo.x * rgeo.x + rgeo.y * rgeo.y)
  );

  const mu = 3.986004418e14;
  const v_ms = Math.sqrt(mu / Rs);
  const v_kmh = v_ms * 3.6;

  return {
    lat: rad2deg(latSat),
    lon: rad2deg(lonSat),
    alt_km: h / 1000.0,
    vel_kmh: v_kmh,
  };
}




function drawOrbitMap(canvas, user, satSub) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.save();

  // Simple world map 校正參數（本底圖不含南極洲，因此緯度下緣設為 -60°）
// 說明：此底圖（Simple world map）屬於簡化/風格化地圖，並非嚴格測繪級地理底圖。
//       為了讓「緯度→畫面 Y」更貼近視覺位置，預設將可視緯度範圍設為 90°N ~ 60°S。
//       若你日後更換成真正的 equirectangular（含南極洲）底圖，可把 MAP_LAT_MIN 改回 -90。
const MAP_LON_MIN = -180;
const MAP_LON_MAX = 180;
const MAP_LAT_MAX = 90;
const MAP_LAT_MIN = -60;

// 預設校正（針對 Simple_world_map.svg 轉出的底圖）：
// 你的座標（台北北投 25.129084, 121.502197）在此底圖上通常會略偏「左下」，
// 因此這裡預設給一點「向東 + 向北」的微調。
//
// 若你之後仍想再微調（不用改任何其他邏輯）：
//   - 點太靠左  → MAP_LON_OFFSET 加大（正值向東 / 右移）
//   - 點太靠右  → MAP_LON_OFFSET 減小
//   - 點太靠下  → MAP_LAT_OFFSET 加大（正值向北 / 上移）
//   - 點太靠上  → MAP_LAT_OFFSET 減小
const MAP_LON_OFFSET = 1.8;   // 經度微調偏移（度，正值向東）
const MAP_LAT_OFFSET = 1.2;   // 緯度微調偏移（度，正值向北）

  // 等距矩形投影（Plate Carrée），自動依底圖比例等比縮放並置中
  function getMapRect() {
    // 以世界地圖影像的實際寬高為基準，維持比例等比縮放到整個 canvas
    const canvasAspect = w / h;
    let imgW = orbitMapImage && orbitMapImageLoaded ? orbitMapImage.width : w;
    let imgH = orbitMapImage && orbitMapImageLoaded ? orbitMapImage.height : h;
    const imgAspect = imgW / imgH;

    let mapWidth, mapHeight, mapLeft, mapTop;
    if (canvasAspect > imgAspect) {
      // 畫布比較寬，以高度貼齊，左右加黑邊
      mapHeight = h;
      mapWidth = h * imgAspect;
      mapLeft = (w - mapWidth) / 2;
      mapTop = 0;
    } else {
      // 畫布比較高，以寬度貼齊，上下加黑邊
      mapWidth = w;
      mapHeight = w / imgAspect;
      mapLeft = 0;
      mapTop = (h - mapHeight) / 2;
    }
    return { mapLeft, mapTop, mapWidth, mapHeight };
  }

  function lonToX(lonDeg) {
    const { mapLeft, mapWidth } = getMapRect();
    const adjLon = lonDeg + MAP_LON_OFFSET;
    return mapLeft + ((adjLon - MAP_LON_MIN) / (MAP_LON_MAX - MAP_LON_MIN)) * mapWidth;
  }
  function latToY(latDeg) {
    const { mapTop, mapHeight } = getMapRect();
    const adjLat = latDeg + MAP_LAT_OFFSET;
    return mapTop + ((MAP_LAT_MAX - adjLat) / (MAP_LAT_MAX - MAP_LAT_MIN)) * mapHeight;
  }

  // 畫世界地圖底圖（位圖，維持原始比例置中顯示）
  if (orbitMapImage && orbitMapImageLoaded) {
    const { mapLeft, mapTop, mapWidth, mapHeight } = getMapRect();
    ctx.drawImage(orbitMapImage, mapLeft, mapTop, mapWidth, mapHeight);
  } else {
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, w, h);
  }

  // 疊加經緯度網格，方便對位
  ctx.save();
  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = latToY(lat);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = lonToX(lon);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  ctx.restore();

  // 繪製衛星軌跡（地球投影路徑，假設 GPS 近圓軌道與 55° 軌道傾角）
  if (satSub) {
    const incDeg = 55; // 假設 GPS 衛星軌道傾角
    const incRad = incDeg * Math.PI / 180;
    const lat0 = satSub.lat * Math.PI / 180;
    const lon0 = satSub.lon * Math.PI / 180;
    const s = Math.sin(lat0) / Math.sin(incRad);

    if (Math.abs(s) <= 1) {
      const phi0 = Math.asin(s) - lon0;

      ctx.beginPath();
      ctx.strokeStyle = "rgba(252,211,77,0.95)"; // 黃色軌跡線（較亮較粗）
      ctx.lineWidth = 2;

      for (let lonDeg = -180; lonDeg <= 180; lonDeg += 2) {
        const lon = lonDeg * Math.PI / 180;
        const lat = Math.asin(Math.sin(incRad) * Math.sin(lon + phi0));
        const x = lonToX(lonDeg);
        const y = latToY(lat * 180 / Math.PI);
        if (lonDeg === -180) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

  }

  // 衛星服務範圍（地面覆蓋圈，近似值）
  if (satSub && satSub.alt_km != null) {
    const earthRadiusKm = 6371;
    const altKm = satSub.alt_km;
    // 中心角（地心到覆蓋邊界的角度），以可見地平線近似，再稍微縮小避免整張地圖被蓋滿
    let psi = Math.acos(earthRadiusKm / (earthRadiusKm + altKm)); // radians
    psi *= 0.7; // 略縮小覆蓋範圍，僅作視覺表示

    const lat0 = satSub.lat * Math.PI / 180;
    const lon0 = satSub.lon * Math.PI / 180;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const sinPsi = Math.sin(psi);
    const cosPsi = Math.cos(psi);

    ctx.beginPath();
    for (let deg = 0; deg <= 360; deg += 3) {
      const bearing = deg * Math.PI / 180;
      const lat = Math.asin(
        sinLat0 * cosPsi + cosLat0 * sinPsi * Math.cos(bearing)
      );
      const lon = lon0 + Math.atan2(
        Math.sin(bearing) * sinPsi * cosLat0,
        cosPsi - sinLat0 * Math.sin(lat)
      );

      let latDeg = lat * 180 / Math.PI;
      let lonDeg = lon * 180 / Math.PI;
      if (lonDeg > 180) lonDeg -= 360;
      if (lonDeg < -180) lonDeg += 360;

      const x = lonToX(lonDeg);
      const y = latToY(latDeg);
      if (deg === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(56,189,248,0.06)";   // 更淡的填滿，不擋住地圖
    ctx.strokeStyle = "#38bdf8"; // 邊界線：亮青藍色
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 使用者位置（定位圖示）
  if (user && user.lat != null && user.lon != null) {
    const ux = lonToX(user.lon);
    const uy = latToY(user.lat);

    if (orbitUserIcon && orbitUserIcon.complete && orbitUserIcon.naturalWidth > 0) {
      const iw = 30;
      const ih = 40;
      ctx.drawImage(orbitUserIcon, ux - iw / 2, uy - ih + 4, iw, ih);
    } else {
      ctx.beginPath();
      ctx.arc(ux, uy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#38bdf8";
      ctx.fill();
    }
  }

  // 衛星子星點（衛星圖示）
  if (satSub) {
    let lon = satSub.lon;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;

    const sx = lonToX(lon);
    const sy = latToY(satSub.lat);

    if (orbitSatIcon && orbitSatIcon.complete && orbitSatIcon.naturalWidth > 0) {
      const iw = 34;
      const ih = 34;
      ctx.drawImage(orbitSatIcon, sx - iw / 2, sy - ih / 2, iw, ih);
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.fill();
    }

    if (user && user.lat != null && user.lon != null) {
      const ux = lonToX(user.lon);
      const uy = latToY(user.lat);
      ctx.beginPath();
      ctx.moveTo(ux, uy);
      ctx.lineTo(sx, sy);
      ctx.strokeStyle = "rgba(56,189,248,0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  ctx.restore();
}
function updateOrbitPanel(data) {
  const mapCanvas = document.getElementById("orbit_map");
  const satLabelEl = document.getElementById("orbit_sat_label");
  const latEl = document.getElementById("orbit_lat");
  const lonEl = document.getElementById("orbit_lon");
  const altEl = document.getElementById("orbit_alt");
  const velEl = document.getElementById("orbit_vel");
  const selectorEl = document.getElementById("orbit_sat_selector");
  if (!mapCanvas || !satLabelEl) return;

  const sats = (data && data.satellites) || {};
  const satEntries = Object.entries(sats);

  if (selectorEl) {
    const prevValue = selectorEl.value;
    selectorEl.innerHTML = "";
    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.textContent = "自動";
    selectorEl.appendChild(autoOpt);

    for (const [prn] of satEntries) {
      const opt = document.createElement("option");
      opt.value = prn;
      opt.textContent = prn;
      selectorEl.appendChild(opt);
    }

    if (selectedOrbitPrn && sats[selectedOrbitPrn]) {
      selectorEl.value = selectedOrbitPrn;
    } else if (prevValue && sats[prevValue]) {
      selectorEl.value = prevValue;
      selectedOrbitPrn = prevValue;
    } else {
      selectorEl.value = "";
    }

    if (!orbitSelectorInitialized) {
      selectorEl.addEventListener("change", (ev) => {
        const v = ev.target.value;
        selectedOrbitPrn = v || null;
        if (latestStatusData) {
          updateOrbitPanel(latestStatusData);
        }
      });
      orbitSelectorInitialized = true;
    }
  }

  if (!satEntries.length) {
    satLabelEl.textContent = "--";
    latEl.textContent = "--";
    lonEl.textContent = "--";
    altEl.textContent = "--";
    velEl.textContent = "--";
    const ctx = mapCanvas.getContext("2d");
    ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    return;
  }

  let sat = null;
  if (selectedOrbitPrn && sats[selectedOrbitPrn]) {
    sat = sats[selectedOrbitPrn];
  } else {
    for (const [prn, s] of satEntries) {
      if (s.used) {
        selectedOrbitPrn = prn;
        sat = s;
        break;
      }
    }
    if (!sat) {
      const [prn, s] = satEntries[0];
      selectedOrbitPrn = prn;
      sat = s;
    }
  }

  satLabelEl.textContent = selectedOrbitPrn || "--";

  const fix = (data && data.fix) || {};
  const userLat = fix.lat;
  const userLon = fix.lng;

  const satSub = computeSubSatellitePoint(
    userLat,
    userLon,
    sat.elev,
    sat.az
  );

  if (!satSub) {
    latEl.textContent = "--";
    lonEl.textContent = "--";
    altEl.textContent = "--";
    velEl.textContent = "--";
    drawOrbitMap(mapCanvas, { lat: userLat, lon: userLon }, null);
    return;
  }

  latEl.textContent = satSub.lat.toFixed(4) + "°";
  lonEl.textContent = satSub.lon.toFixed(4) + "°";
  altEl.textContent = satSub.alt_km.toFixed(0) + " km";
  velEl.textContent = satSub.vel_kmh.toFixed(0) + " km/h";

  drawOrbitMap(mapCanvas, { lat: userLat, lon: userLon }, satSub);
}
function drawSkyGlobe(data) {
  const canvas = document.getElementById("sky_globe");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 16;

  // 整個背景填滿深色，配合卡片底色
  ctx.save();
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(cx, cy);

  // 外框圓（球輪廓）
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(148,163,184,0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // 經緯線線框
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(148,163,184,0.45)";
  const steps = 64;

  function drawLat(latDeg) {
    const latRad = (latDeg * Math.PI) / 180;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= steps; i++) {
      const lonRad = (i / steps) * Math.PI * 2;
      const cosLat = Math.cos(latRad);
      const x = cosLat * Math.sin(lonRad);
      const y = Math.sin(latRad);
      const z = cosLat * Math.cos(lonRad);
      const p = rotateAndProjectOnSphere(x, y, z, radius);
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    if (started) ctx.stroke();
  }

  function drawLon(lonDeg) {
    const lonRad = (lonDeg * Math.PI) / 180;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI - Math.PI / 2;
      const cosLat = Math.cos(t);
      const x = cosLat * Math.sin(lonRad);
      const y = Math.sin(t);
      const z = cosLat * Math.cos(lonRad);
      const p = rotateAndProjectOnSphere(x, y, z, radius);
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    if (started) ctx.stroke();
  }

  [-60, -30, 0, 30, 60].forEach(drawLat);
  [0, 45, 90, 135, 180, 225, 270, 315].forEach(drawLon);

  // 衛星點
  const sats = (data && data.satellites) || {};
  const satPoints = [];
  skyGlobeSatPoints = satPoints;

  for (const [prn, sat] of Object.entries(sats)) {
    if (sat.elev == null || sat.az == null) continue;
    const elRad = (sat.elev * Math.PI) / 180;
    const azRad = (sat.az * Math.PI) / 180;

    const cosEl = Math.cos(elRad);
    const x = cosEl * Math.sin(azRad);
    const y = Math.sin(elRad);
    const z = cosEl * Math.cos(azRad);

    const p = rotateAndProjectOnSphere(x, y, z, radius);
    let color = "#3b82f6"; // 藍色：可見未使用
    if (sat.used) {
      color = "#22c55e"; // 綠色：使用中
    }
    if (sat.snr != null && sat.snr < 20) {
      color = "#ef4444"; // 紅色：SNR 太低
    }
    const pointRadius = sat.snr != null && sat.snr > 35 ? 5 : 4;
    satPoints.push({ prn, x: p.x, y: p.y, z: p.z, color, r: pointRadius });
  }

  // 先畫背面，再畫前面
  ctx.font = "10px system-ui";

  satPoints
    .filter((p) => p.z < 0)
    .forEach((p) => {
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });

  satPoints
    .filter((p) => p.z >= 0)
    .forEach((p) => {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.fillStyle = "#e5e7eb";
      ctx.fillText(p.prn, p.x + 6, p.y - 2);
    });

  ctx.globalAlpha = 1;
  ctx.restore();
}
function initSkyGlobeInteraction() {
  const canvas = document.getElementById("sky_globe");
  if (!canvas) return;

  const getPos = (ev) => {
    if (ev.touches && ev.touches.length) {
      return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    }
    return { x: ev.clientX, y: ev.clientY };
  };

  const onDown = (ev) => {
    const pos = getPos(ev);
    skyGlobeState.isDragging = true;
    skyGlobeState.lastX = pos.x;
    skyGlobeState.lastY = pos.y;
    ev.preventDefault();
  };

  const onMove = (ev) => {
    if (!skyGlobeState.isDragging) return;
    const pos = getPos(ev);
    const dx = pos.x - skyGlobeState.lastX;
    const dy = pos.y - skyGlobeState.lastY;
    skyGlobeState.lastX = pos.x;
    skyGlobeState.lastY = pos.y;

    skyGlobeState.yaw -= dx * 0.01;
    skyGlobeState.pitch += dy * 0.01;
    const limit = Math.PI / 2 - 0.1;
    if (skyGlobeState.pitch > limit) skyGlobeState.pitch = limit;
    if (skyGlobeState.pitch < -limit) skyGlobeState.pitch = -limit;

    if (latestStatusData) {
      drawSkyGlobe(latestStatusData);
    }
    ev.preventDefault();
  };

  const onUp = () => {
    skyGlobeState.isDragging = false;
  };

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  
  const onClick = (ev) => {
    if (!skyGlobeSatPoints || !skyGlobeSatPoints.length) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (ev.clientX - rect.left) * scaleX;
    const y = (ev.clientY - rect.top) * scaleY;

    let best = null;
    let bestDist2 = 64; // 8px 半徑內
    for (const p of skyGlobeSatPoints) {
      if (p.z < 0) continue; // 只選前半球
      const dx = x - p.x;
      const dy = y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        best = p;
      }
    }
    if (best && latestStatusData) {
      selectedOrbitPrn = best.prn;
      updateOrbitPanel(latestStatusData);
    }
  };
canvas.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend", onUp);
}
function updateRawNmea(data) {
  const box = document.getElementById("raw_nmea");
  const lines = data.raw_last_lines || [];
  if (!lines.length) {
    box.textContent = "--";
  } else {
    box.textContent = lines.join("\n");
  }
}


// === World vector map (plate carrée 等距矩形投影簡化版) ===
function drawWorldVectorMap(ctx, w, h) {
  // 這裡獨立定義 lon/lat 映射，確保與軌跡與子星點一致
  const lonToX = (lonDeg) => ((lonDeg + 180) / 360) * w;
  const latToY = (latDeg) => ((90 - latDeg) / 180) * h;

  // 深色背景
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, w, h);

  ctx.save();

  // 經緯度網格
  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = latToY(lat);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = lonToX(lon);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();

  // 超簡化大陸輪廓（僅供視覺參考，非精確海岸線）
  const outlines = [];

  // 北美洲
  outlines.push([
    { lat: 72, lon: -170 },
    { lat: 80, lon: -140 },
    { lat: 82, lon: -60 },
    { lat: 72, lon: -40 },
    { lat: 60, lon: -60 },
    { lat: 52, lon: -75 },
    { lat: 45, lon: -80 },
    { lat: 30, lon: -90 },
    { lat: 20, lon: -100 },
    { lat: 15, lon: -110 },
    { lat: 25, lon: -120 },
    { lat: 40, lon: -135 },
    { lat: 55, lon: -145 },
    { lat: 65, lon: -155 },
    { lat: 72, lon: -170 }
  ]);

  // 南美洲
  outlines.push([
    { lat: 12, lon: -78 },
    { lat: 10, lon: -60 },
    { lat: -5, lon: -50 },
    { lat: -15, lon: -45 },
    { lat: -25, lon: -50 },
    { lat: -35, lon: -60 },
    { lat: -55, lon: -70 },
    { lat: -55, lon: -75 },
    { lat: -20, lon: -80 },
    { lat: -5, lon: -78 },
    { lat: 12, lon: -78 }
  ]);

  // 非洲
  outlines.push([
    { lat: 37, lon: -10 },
    { lat: 35, lon: 5 },
    { lat: 25, lon: 15 },
    { lat: 10, lon: 10 },
    { lat: 5, lon: 0 },
    { lat: -5, lon: -10 },
    { lat: -15, lon: -5 },
    { lat: -25, lon: 15 },
    { lat: -35, lon: 20 },
    { lat: -35, lon: 32 },
    { lat: -20, lon: 40 },
    { lat: -10, lon: 45 },
    { lat: 0, lon: 40 },
    { lat: 10, lon: 50 },
    { lat: 20, lon: 45 },
    { lat: 30, lon: 35 },
    { lat: 32, lon: 25 },
    { lat: 37, lon: -10 }
  ]);

  // 歐亞大陸（極度簡化）
  outlines.push([
    { lat: 70, lon: -10 },
    { lat: 72, lon: 10 },
    { lat: 70, lon: 30 },
    { lat: 65, lon: 40 },
    { lat: 60, lon: 60 },
    { lat: 60, lon: 90 },
    { lat: 65, lon: 120 },
    { lat: 70, lon: 150 },
    { lat: 60, lon: 170 },
    { lat: 50, lon: 180 },
    { lat: 45, lon: 150 },
    { lat: 40, lon: 135 },
    { lat: 35, lon: 125 },
    { lat: 25, lon: 120 },
    { lat: 20, lon: 110 },
    { lat: 15, lon: 100 },
    { lat: 10, lon: 90 },
    { lat: 5, lon: 80 },
    { lat: 10, lon: 70 },
    { lat: 20, lon: 65 },
    { lat: 30, lon: 60 },
    { lat: 40, lon: 55 },
    { lat: 45, lon: 50 },
    { lat: 40, lon: 40 },
    { lat: 35, lon: 30 },
    { lat: 40, lon: 20 },
    { lat: 45, lon: 10 },
    { lat: 50, lon: 0 },
    { lat: 55, lon: -10 },
    { lat: 60, lon: -15 },
    { lat: 65, lon: -20 },
    { lat: 70, lon: -10 }
  ]);

  // 澳洲
  outlines.push([
    { lat: -10, lon: 113 },
    { lat: -15, lon: 130 },
    { lat: -25, lon: 140 },
    { lat: -35, lon: 150 },
    { lat: -40, lon: 147 },
    { lat: -43, lon: 135 },
    { lat: -35, lon: 120 },
    { lat: -20, lon: 115 },
    { lat: -10, lon: 113 }
  ]);

  // 南極洲（只畫個大環）
  outlines.push([
    { lat: -60, lon: -180 },
    { lat: -60, lon: -120 },
    { lat: -60, lon: -60 },
    { lat: -60, lon: 0 },
    { lat: -60, lon: 60 },
    { lat: -60, lon: 120 },
    { lat: -60, lon: 180 }
  ]);

  ctx.strokeStyle = "rgba(148,163,184,0.9)";
  ctx.fillStyle = "rgba(30,64,175,0.35)";
  ctx.lineWidth = 1.2;

  for (const poly of outlines) {
    if (!poly.length) continue;
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const x = lonToX(p.lon);
      const y = latToY(p.lat);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    // 除了南極環，其他輪廓閉合
    if (poly !== outlines[outlines.length - 1]) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  }

  ctx.restore();
}

setInterval(fetchStatus, 2000);
window.addEventListener("load", () => {
  initSkyGlobeInteraction();
  initOrbitMapImage();
  fetchStatus();
});
