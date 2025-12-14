
/*
 * ESP32_GPS_Satellite_Monitor.ino
 * v0.3.0 Ultra
 */

#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID     = "OHYUP";
const char* WIFI_PASSWORD = "noonoodog718";

const char* SERVER_HOST = "192.168.1.119";
const uint16_t SERVER_PORT = 5001;
const char* SERVER_PATH = "/api/ingest";

#define GPS_RX_PIN 16
#define GPS_TX_PIN 17

HardwareSerial GPS(1);

String currentLine;
String nmeaBuffer;
unsigned long lastSendMillis = 0;
const unsigned long SEND_INTERVAL_MS = 1000;

void connectWifi() {
  Serial.print("連線至 WiFi：");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retry = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    retry++;
    if (retry > 60) {
      Serial.println("\nWiFi 連線逾時，重新啟動...");
      ESP.restart();
    }
  }

  Serial.println("\nWiFi 已連線。");
  Serial.print("IP 位址：");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("=== ESP32 GPS 專業監測：NMEA 上傳器 v0.3.0 Ultra 啟動 ===");

  connectWifi();

  GPS.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("GPS UART 已啟動 (Serial2, 9600bps)");
}

void loop() {
  while (GPS.available() > 0) {
    char c = GPS.read();
    if (c == '\r') {
      continue;
    } else if (c == '\n') {
      if (currentLine.length() > 0) {
        if (currentLine.charAt(0) == '$') {
          nmeaBuffer += currentLine;
          nmeaBuffer += "\n";
        }
        currentLine = "";
      }
    } else {
      currentLine += c;
    }
  }

  unsigned long now = millis();
  if (now - lastSendMillis >= SEND_INTERVAL_MS) {
    lastSendMillis = now;

    if (nmeaBuffer.length() > 0) {
      if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        String url = String("http://") + SERVER_HOST + ":" + String(SERVER_PORT) + SERVER_PATH;
        http.begin(url);
        http.addHeader("Content-Type", "application/x-www-form-urlencoded");

        String postData = "nmea=";
        String payloadNmea = nmeaBuffer;
        payloadNmea.replace("&", "%26");
        payloadNmea.replace("+", "%2B");
        postData += payloadNmea;

        Serial.println("上傳 NMEA 至伺服器...");
        int httpCode = http.POST(postData);
        if (httpCode > 0) {
          String resp = http.getString();
          Serial.print("伺服器回應代碼：");
          Serial.println(httpCode);
          Serial.print("回應內容：");
          Serial.println(resp);
        } else {
          Serial.print("HTTP 上傳失敗，錯誤：");
          Serial.println(http.errorToString(httpCode));
        }
        http.end();
      } else {
        Serial.println("WiFi 尚未連線，略過上傳。");
      }

      nmeaBuffer = "";
    }
  }
}
