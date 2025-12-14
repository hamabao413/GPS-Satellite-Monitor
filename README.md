
# GPS Satellite Monitor（Ultra）APP 介紹

## 產品概述

**GPS Satellite Monitor（Ultra）**是一套以 **ESP32 + GPS 模組**為資料來源，結合 **Flask 伺服器**與 **Web 儀表板**的即時 GNSS 監測系統。系統可解析 NMEA 訊息，即時呈現定位狀態、衛星訊號品質、天空分布、方位/速度儀表、衛星子星點（Sub-satellite point）示意，以及近期原始 NMEA 內容，適合用於戶外測試、天線調校、GNSS 模組評估與長時間觀測。

## 核心特色

* **即時定位狀態與品質監測**：Fix 類型、Sats in use、HDOP/VDOP/PDOP、EPE 等指標
* **位置與運動資訊**：緯度/經度/高度、速度、航向
* **時間資訊整合**：GPS UTC 日期/時間，並依座標計算**日出/日落**，以**台灣本地時間（UTC+8）**顯示
* **可視化儀表與天空分布**：速度/方位儀表、Sky Plot（天空圖）、Sky Globe（天空球視覺化）
* **衛星列表（多系統彙總）**：PRN、仰角、方位角、SNR、是否用於解算、最後接收時間等資訊
* **地圖示意與子星點**：世界底圖顯示使用者位置與選取衛星的子星點（示意）
* **近期 NMEA 訊息檢視**：保留最新 NMEA 行，便於除錯與比對

## 系統架構（資料流）

1. ESP32 讀取 GPS 模組輸出的 NMEA
2. ESP32 透過 HTTP POST 將資料送至伺服器 `/api/ingest`
3. Flask 解析 NMEA 並整理成統一狀態
4. 前端輪詢 `/api/status`，即時更新儀表板各面板

## 適用情境

* GNSS 模組/天線定位品質測試（室內、戶外、遮蔽環境）
* 固定觀測站：長期觀測衛星數與 DOP/EPE 變化
* 開發除錯：快速檢視 NMEA 與解析結果對應
* 教學展示：以可視化方式理解衛星分布與定位品質

## 重要限制與注意事項

* **子星點屬示意推算**：以接收機位置與仰角/方位角作幾何推估，主要用於視覺理解，非測繪級精準軌道解算。
* 日出/日落為演算法估算，會受日期來源與定位誤差影響；特殊緯度/季節可能出現例外情況。
* 伺服器位址與 Wi-Fi 設定請依實際部署環境調整並妥善保護。

---

# GPS Satellite Monitor (Ultra) – App Overview

## Summary

**GPS Satellite Monitor (Ultra)** is a real-time GNSS monitoring system built with **ESP32 + a GPS module** as the data source, combined with a **Flask backend** and a **web dashboard**. It parses NMEA sentences and visualizes positioning status, signal quality, satellite distribution, heading/speed gauges, sub-satellite point (ground track) indicators, and recent raw NMEA lines. It is designed for field testing, antenna tuning, GNSS module evaluation, and long-term observation.

## Key Features

* **Real-time fix & quality metrics**: fix type, satellites in use, HDOP/VDOP/PDOP, EPE, and more
* **Position & motion data**: latitude/longitude/altitude, speed, course/heading
* **Time utilities**: GPS UTC date/time plus computed **sunrise/sunset** based on location, shown in **Taiwan local time (UTC+8)**
* **Visual dashboard**: heading/speed gauges, Sky Plot, Sky Globe visualization
* **Multi-GNSS satellite list**: PRN, elevation, azimuth, SNR, used-in-fix flag, last-seen time
* **Map view & sub-satellite point**: world map overlay showing user position and satellite ground projection (illustrative)
* **Recent NMEA viewer**: keeps the latest NMEA lines for debugging and verification

## Architecture (Data Flow)

1. ESP32 reads NMEA output from the GPS module
2. ESP32 sends NMEA via HTTP POST to `/api/ingest`
3. Flask parses and aggregates NMEA into a unified status model
4. The web UI polls `/api/status` and updates all dashboard panels in real time

## Use Cases

* Evaluating GNSS modules/antennas in open sky vs. obstructed environments
* Long-term monitoring stations (satellite counts, DOP/EPE trends)
* Development & debugging (raw NMEA vs. parsed outputs)
* Educational demos to understand satellite geometry and fix quality

## Notes & Limitations

* **Sub-satellite point is illustrative**: it’s a geometric approximation based on receiver position and elevation/azimuth, intended for visualization—not survey-grade orbit determination.
* Sunrise/sunset times are algorithmic estimates and may vary with position/time accuracy; edge cases can occur in special latitudes/seasons.
* Update Wi-Fi/server settings according to your deployment and secure network configuration appropriately.
