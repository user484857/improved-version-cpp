# CPPS Fischertechnik Dashboard — Agent Team Master Prompt

**Projekt:** TUM iwb Seminar "Cyber-Physical Production Systems in the Smart Factory" (CPPS), Day 6
**Ziel:** Mehrere Dashboards für eine Fischertechnik Lernfabrik bauen — jeder Agent baut ein eigenständiges Dashboard
**Datum:** 19. März 2026

---

## 1. PROJEKTSTRUKTUR & DATEIPFADE

```als
cpp/
├── tag 5/Day 5 Template-20260319/
│   ├── dashboard/                        ← BESTEHENDER Dashboard-Code (Referenz für Design)
│   │   ├── server.py                     ← Flask-Server (Port 8050), Demo + Live Mode
│   │   ├── demo_player.py               ← CSV-Replay-Engine (Thread-basiert)
│   │   ├── config.py                     ← OPC UA Variable Mapping
│   │   ├── opcua_client.py              ← Live OPC UA Verbindung
│   │   ├── simulate_factory.py          ← Fabrik-Simulator (generiert realistische CSVs)
│   │   ├── requirements.txt             ← flask
│   │   └── static/
│   │       ├── index.html               ← Glassmorphism UI
│   │       ├── app.js                   ← Polling, Chart.js, Station Cards
│   │       └── style.css                ← Dark/Light Theme, Glass Design System
│   └── FischertechnikAnlage/            ← TwinCAT PLC Projekt (Windows, nicht relevant)
│
├── tag 6/
│   ├── data/
│   │   ├── factory_run_20260319_173535.csv   ← GRÖSSTE echte Aufnahme (49K Events, ~7 Min)
│   │   │                                       ACHTUNG: Nur Idle-Polling! Keine Prozessaktivität!
│   │   ├── simulated_run_20260319_165255.csv ← SIMULIERTE Daten mit echten Prozesssequenzen
│   │   │                                       (5 Durchläufe, Motoren aktiv, Ofen brennt, Farben sortiert)
│   │   └── factory.db                        ← SQLite-DB (14MB, alle CSVs importiert)
│   ├── database.py                           ← SQLite FactoryDB Klasse
│   ├── opcua_subscription.py                 ← OPC UA Subscription-basierte Datenerfassung
│   └── simulate_factory.py                   ← Simulator (identisch mit tag5-Version)
```

---

## 2. FABRIKFLUSS (KRITISCH — aus simulate_factory.py verifiziert)

Ein Werkstück durchläuft die Fabrik in dieser Reihenfolge:

```
┌─────────┐    ┌─────────┐    ┌─────────────────────────┐    ┌─────────┐    ┌──────────────┐
│   HBW   │───→│  Crane  │───→│   Machining Station     │───→│   PM    │───→│ Sorting Line │
│Retrieve │    │Pick+Place│    │ Burning(Ofen) → Sawing  │    │Punching │    │Color Sorting │
└─────────┘    └─────────┘    └─────────────────────────┘    └─────────┘    └──────────────┘
     ↑                                                                             │
     └─────────────────────────────────────────────────────────────────────────────┘
                                    (Werkstück zurück ins HBW)
```

### Detaillierter Ablauf eines Durchlaufs (~60 Sekunden):

**Station 1: HBW (High Bay Warehouse) — Retrieve (~12s)**
1. StackerCrane fährt zum Rack (bMotor_HBW_StackerCrane_torack)
2. Absenken auf richtige Ebene (bMotor_HBW_StackerCrane_downward)
3. Cantilever ausfahren/einfahren (bMotor_HBW_Cantilever_forward/backward)
4. Zurück zum Förderband (bMotor_HBW_StackerCrane_toconveyorbelt)
5. Förderband zum Crane (bMotor_HBW_ConveyorBelt_forward)
6. Light Barriers tracken Position (bLightBarrier_HBW_inside → outside)

**Station 2: Crane — Pick & Place (~12s)**
1. Kompressor an (bCompressor_C)
2. Drehen zum HBW (bMotor_C_clockwise)
3. Ausfahren + Absenken (bMotor_C_forward, bMotor_C_downward)
4. Vakuum greifen (bValve_C = True)
5. Anheben + Einfahren (bMotor_C_upward, bMotor_C_backward)
6. Drehen zur MS (bMotor_C_counterclockwise)
7. Ausfahren + Absenken + Loslassen (bValve_C = False)
8. Zurückfahren + Home

**Station 3: MS (Machining Station) — Burning + Sawing (~18s)**
*Burning (~12s):*
1. Werkstück auf Förderband (bLightBarrier_MS_conveyorbelt)
2. Turntable dreht zur Transfer Unit (bMotor_MS_Turntable_clockwise → bReferenceSwitch_MS_Turntable_attransferunit)
3. Transfer Unit holt Werkstück (bCompressor_MS, bValve_MS_Vacuum, bValve_MS_TransferUnit)
4. Transfer Unit fährt zum Ofen (bMotor_MS_TransferUnit_tooven)
5. Ofentür auf (bValve_MS_OvenDoor)
6. Slider reinfahren (bMotor_MS_OvenSlider_movein → bReferenceSwitch_MS_OvenSlider_inside)
7. Tür zu, **BRENNEN** (bLamp_MS = True, ~3 Sekunden)
8. Tür auf, Slider rausfahren (bMotor_MS_OvenSlider_moveout)
9. Transfer Unit holt zurück (bMotor_MS_TransferUnit_toturntable)

*Sawing (~5s):*
10. Turntable zur Säge (bMotor_MS_Turntable_counterclockwise → bReferenceSwitch_MS_Turntable_atsaw)
11. **SÄGEN** (bMotor_MS_Saw = True, ~2.5 Sekunden)
12. Turntable zurück zum Förderband
13. Werkstück auswerfen (bValve_MS_Ejector)

**Station 4: PM (Punching Machine) — Stanzen (~5s)**
1. Werkstück kommt rein (bLightBarrier_PM_entry)
2. Förderband zur Werkzeugposition (bLightBarrier_PM_tool)
3. Werkzeug runter (bMotor_PM_Tool_downward → bReferenceSwitch_PM_bottom)
4. Werkzeug hoch (bMotor_PM_Tool_upward → bReferenceSwitch_PM_top)
5. Werkstück raus (bMotor_PM_ConveyorBelt_forward)

**Station 5: SL (Sorting Line) — Farbsortierung (~6s)**
1. Förderband an + Kompressor (bMotor_SL_ConveyorBelt, bCompressor_SL)
2. Werkstück passiert Farbsensor (bLightBarrier_SL_beforecolor)
3. **FARBE LESEN** (iColorSensor_SL: 40-60=Blau, 130-190=Rot, 250-300=Weiß)
4. Werkstück passiert Sensor (bLightBarrier_SL_aftercolor)
5. Zum richtigen Fach fahren + Ventil (bValve_SL_white/red/blue)
6. In Fach fallen (bLightBarrier_SL_white/red/blue)

---

## 3. DATENFORMAT & VARIABLEN

### CSV-Format
```csv
timestamp,gvl,variable,value,source
2026-03-19 16:52:55.888,gvl_HBW,bMotor_HBW_StackerCrane_torack,True,poll
2026-03-19 16:53:32.988,gvl_MS,bLamp_MS,True,poll
2026-03-19 16:53:53.088,gvl_SL,iColorSensor_SL,257,poll
```

### GVL (Global Variable List) → Station Mapping
```
gvl_HBW         → HBW (High Bay Warehouse)
gvl_C           → Crane
gvl_MS          → MS (Machining Station)
gvl_PM          → PM (Punching Machine)
gvl_SL          → SL (Sorting Line)
LocalVariables  → State (Prozess-Zustandsvariablen)
```

### Vollständige Variable-Liste (aus echten CSV-Daten)

**HBW (gvl_HBW):**
```
Sensoren:
  bReferenceSwitch_HBW_horizontal      — Stacker Crane Referenz horizontal
  bReferenceSwitch_HBW_vertical        — Stacker Crane Referenz vertikal
  bReferenceSwitch_HBW_Cantilever_front — Cantilever ausgefahren
  bReferenceSwitch_HBW_Cantilever_back  — Cantilever eingefahren
  bLightBarrier_HBW_inside             — Werkstück auf innerem Förderband
  bLightBarrier_HBW_outside            — Werkstück auf äußerem Förderband
  bTrailSensor_HBW_bottom              — Trail-Sensor unten
  bTrailSensor_HBW_top                 — Trail-Sensor oben
  bEncoderImpulse_HBW_horizontal1/2    — Encoder-Pulse horizontal
  bEncoderImpulse_HBW_vertical1/2      — Encoder-Pulse vertikal

Aktoren:
  bMotor_HBW_ConveyorBelt_forward      — Förderband vorwärts
  bMotor_HBW_ConveyorBelt_backward     — Förderband rückwärts
  bMotor_HBW_StackerCrane_torack       — Stacker Crane zum Regal
  bMotor_HBW_StackerCrane_toconveyorbelt — Stacker Crane zum Förderband
  bMotor_HBW_StackerCrane_downward     — Stacker Crane runter
  bMotor_HBW_StackerCrane_upward       — Stacker Crane hoch
  bMotor_HBW_Cantilever_forward        — Cantilever ausfahren
  bMotor_HBW_Cantilever_backward       — Cantilever einfahren
```

**Crane (gvl_C):**
```
Sensoren:
  bReferenceSwitch_C_vertical          — Referenz vertikal (oben)
  bReferenceSwitch_C_horizontal        — Referenz horizontal (eingefahren)
  bReferenceSwitch_C_rotate            — Referenz Drehung (Home-Position)
  bEncoderImpulse_C_vertical1/2        — Encoder vertikal
  bEncoderImpulse_C_horizontal1/2      — Encoder horizontal
  bEncoderImpulse_C_rotate1/2          — Encoder Drehung

Aktoren:
  bMotor_C_upward / bMotor_C_downward  — Hoch/Runter
  bMotor_C_forward / bMotor_C_backward — Ausfahren/Einfahren
  bMotor_C_clockwise / bMotor_C_counterclockwise — Drehen
  bCompressor_C                        — Kompressor für Vakuumgreifer
  bValve_C                             — Vakuum-Ventil (True=greifen)
```

**MS (gvl_MS) — Machining Station:**
```
Sensoren:
  bReferenceSwitch_MS_Turntable_attransferunit  — Drehtisch bei Transfer Unit
  bReferenceSwitch_MS_Turntable_atconveyorbelt  — Drehtisch bei Förderband
  bReferenceSwitch_MS_Turntable_atsaw           — Drehtisch bei Säge
  bReferenceSwitch_MS_TransferUnit_atturntable  — Transfer Unit bei Drehtisch
  bReferenceSwitch_MS_TransferUnit_atoven       — Transfer Unit beim Ofen
  bReferenceSwitch_MS_OvenSlider_inside         — Ofenschieber innen
  bReferenceSwitch_MS_OvenSlider_outside        — Ofenschieber außen
  bLightBarrier_MS_conveyorbelt                 — Werkstück auf Förderband
  bLightBarrier_MS_oven                         — Werkstück im Ofen-Bereich

Aktoren:
  bMotor_MS_Turntable_clockwise / counterclockwise — Drehtisch
  bMotor_MS_ConveyorBelt_forward                — Förderband
  bMotor_MS_OvenSlider_movein / moveout         — Ofenschieber rein/raus
  bMotor_MS_TransferUnit_tooven / toturntable   — Transfer Unit hin/her
  bMotor_MS_Saw                                 — Säge (True = sägt)
  bLamp_MS                                      — Ofenlampe (True = brennt/heizt)
  bCompressor_MS                                — Kompressor
  bValve_MS_Vacuum                              — Vakuum
  bValve_MS_TransferUnit                        — Transfer Unit Ventil
  bValve_MS_OvenDoor                            — Ofentür (True = offen)
  bValve_MS_Ejector                             — Auswerfer
```

**PM (gvl_PM) — Punching Machine:**
```
Sensoren:
  bLightBarrier_PM_entry                        — Werkstück am Eingang
  bLightBarrier_PM_tool                         — Werkstück unter Werkzeug
  bReferenceSwitch_PM_top                       — Werkzeug oben
  bReferenceSwitch_PM_bottom                    — Werkzeug unten

Aktoren:
  bMotor_PM_ConveyorBelt_forward / backward     — Förderband
  bMotor_PM_Tool_upward / downward              — Stanzwerkzeug hoch/runter
```

**SL (gvl_SL) — Sorting Line:**
```
Sensoren:
  bLightBarrier_SL_beforecolor                  — Werkstück vor Farbsensor
  bLightBarrier_SL_aftercolor                   — Werkstück nach Farbsensor
  bLightBarrier_SL_white                        — Werkstück im weißen Fach
  bLightBarrier_SL_red                          — Werkstück im roten Fach
  bLightBarrier_SL_blue                         — Werkstück im blauen Fach
  iColorSensor_SL                               — Farbsensor-Wert (int)
  bPulseCounter_SL                              — Pulse Counter

Aktoren:
  bMotor_SL_ConveyorBelt                        — Förderband
  bCompressor_SL                                — Kompressor
  bValve_SL_white / bValve_SL_red / bValve_SL_blue — Sortierventile
```

**State (LocalVariables):**
```
  iC_CoordH / iC_CoordV / iC_CoordR             — Crane-Koordinaten
  eC_PickingStation / eC_PlacingStation          — Crane Pick/Place Ziel
  iC_Coord_Picking / iC_Coord_Placing            — Koordinaten-Arrays (JSON-Strings)
```

### Farbsensor-Wertebereiche (aus simulate_factory.py)
```python
COLOR_SENSOR_VALUES = {
    "white": (250, 300),   # → Grade A (Premium/EV-tauglich)
    "red":   (130, 190),   # → Grade B (Standard/Stationärspeicher)
    "blue":  (40, 60),     # → Grade C (Budget/Consumer)
}
```

---

## 4. DATENLAGE — KRITISCHE INFO

### Echte CSV (factory_run_20260319_173535.csv):
- 49.051 Zeilen, Zeitraum 17:35:35 bis 17:42:39 (~7 Minuten)
- **NUR IDLE-POLLING**: Kein Motor wurde aktiviert, Ofen war nie an
- Alle ~87 Variablen werden alle ~0.7s gepollt, aber die Fabrik stand still
- Color Sensor zeigt nur 0, 1, 2 (Ambient-Noise, keine echten Farben)
- Nützlich für: Grundstruktur, Variable-Namen, Polling-Frequenz

### Simulierte CSV (simulated_run_20260319_165255.csv):
- 1.132 Zeilen, nur Events bei State-Changes (kompakt)
- **5 vollständige Durchläufe** mit echten Prozesssequenzen
- Motoren werden aktiviert (306 Motor-True-Events)
- Ofen brennt 5x (bLamp_MS = True)
- Farbsensor gibt echte Werte: 257 (weiß), 170 (rot), 49/45/54 (blau)
- **DAS IST DIE BESSERE DATENQUELLE FÜR DASHBOARDS**

### Empfehlung für Dashboards:
1. **Simulierte Daten als Basis verwenden** — die haben echte Prozessaktivität
2. **Mehr simulierte Daten generieren** mit `simulate_factory.py --runs 20` für statistische Tiefe
3. **Synthetische KPIs ableiten** (Cycle Time, Temperatur, OEE) aus den Event-Timestamps
4. Die echte CSV kann als "Idle-Monitoring" Fallback dienen

### Simulator nutzen (simulate_factory.py):
```bash
cd "tag 6/"
python simulate_factory.py --runs 20    # 20 Durchläufe generieren
# Erzeugt: data/simulated_run_YYYYMMDD_HHMMSS.csv
```
Oder direkt im Dashboard-Code den Simulator als Python-Modul importieren.

---

## 5. BESTEHENDES DESIGN-SYSTEM (Referenz)

Die neuen Dashboards sollen sich **visuell am bestehenden Glassmorphism-Design orientieren**, aber inhaltlich komplett neu sein. Kein Bool-Clutter, keine ON/OFF-Listen — stattdessen KPIs, Ampeln, Visualisierungen.

### CSS-Variablen (Dark Theme):
```css
--blue: #007AFF;    --green: #30D158;    --orange: #FF9F0A;
--red: #FF453A;     --purple: #AF52DE;   --cyan: #5AC8FA;

--bg: #101014;
--glass-bg: rgba(255, 255, 255, 0.06);
--glass-border: rgba(255, 255, 255, 0.10);
--glass-blur: 24px;
--glass-shadow: 0 2px 4px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06);

--text-primary: rgba(255, 255, 255, 0.88);
--text-secondary: rgba(255, 255, 255, 0.50);
--text-tertiary: rgba(255, 255, 255, 0.30);

--radius-sm: 10px;  --radius-md: 14px;  --radius-lg: 18px;
```

### CSS-Variablen (Light Theme):
```css
--bg: #f2f2f7;
--glass-bg: rgba(255, 255, 255, 0.65);
--glass-border: rgba(255, 255, 255, 0.50);
--text-primary: rgba(0, 0, 0, 0.85);
```

### Glass-Material CSS:
```css
.glass {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur)) saturate(150%);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(150%);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
```

### Font-Stack:
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
/* Mono: */ font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', monospace;
```

### Station Farben:
```
MS (Machining Station):   #007AFF (Blue)
SL (Sorting Line):        #FF9F0A (Orange)
Crane:                    #30D158 (Green)
HBW (High Bay Warehouse): #AF52DE (Purple)
PM (Punching Machine):    #FF453A (Red)
State:                    #5AC8FA (Cyan)
```

### Design-Prinzipien:
- Apple-Style iOS Glassmorphism
- Dark Theme als Default, Light Theme Support
- Muted backgrounds, Farbe nur für Status-Information (ISA-101)
- Inter Font für UI, Monospace für Daten
- Smooth Transitions (0.25-0.4s cubic-bezier)
- Keine Emojis
- Responsive (mobile-friendly)

---

## 6. BESTEHENDE ARCHITEKTUR

### Flask Server (server.py):
```python
# API Endpoints:
GET /                    → index.html
GET /api/data            → Aktueller State aller Variablen (Demo oder Live)
GET /api/config          → Variable-Konfiguration für Frontend
GET /api/status          → Server-Status + Modus
POST /api/switch-mode    → Zwischen Demo/Live wechseln
GET /api/history         → SQLite Query (station, variable, since, until, run_id, limit)
GET /api/runs            → Liste aller aufgezeichneten Runs
GET /api/db-stats        → Datenbank-Statistiken
```

### Demo Player (demo_player.py):
- Replays CSV in Echtzeit (oder beschleunigt mit `speed` Parameter)
- Maintaint aktuellen State aller Variablen in Dict
- Thread-basiert, polling-safe
- GVL → Station Mapping eingebaut
- Variable Classification: `sensors`, `actuators`, `state`

### SQLite Database (database.py):
```sql
-- Events Table
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    gvl TEXT NOT NULL,
    variable TEXT NOT NULL,
    value TEXT,
    source TEXT,
    station TEXT,
    run_id TEXT
);

-- Runs Table
CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT,
    ended_at TEXT,
    source_file TEXT,
    event_count INTEGER DEFAULT 0
);
```

---

## 7. DASHBOARD-AUFTRÄGE FÜR AGENTEN

Jeder Agent baut ein **eigenständiges Dashboard** als separate HTML-Seite mit eigenem JS und CSS (kann shared CSS importieren). Alle Dashboards teilen sich den Flask-Server und die Datenquellen.

### Architektur-Vorgaben für alle Agenten:
- **Flask + Vanilla JS** (kein React/Vue/Angular)
- **Chart.js** für Standard-Charts (bereits eingebunden)
- Weitere Libraries NUR wenn wirklich nötig (z.B. D3.js für Sankey) — Entscheidung beim Agent
- Jeder Agent erzeugt: `dashboards/<name>/index.html`, `dashboards/<name>/app.js`, `dashboards/<name>/style.css`
- Shared Design-System CSS kann importiert werden
- Dark/Light Theme Support obligatorisch
- Daten kommen via **Fetch API** vom Flask-Server (`/api/data`, `/api/history`, etc.)
- Neue API-Endpoints können zum Server hinzugefügt werden wenn nötig
- **Demo-Modus muss funktionieren** (CSV-Replay, kein PLC nötig)

---

### AGENT 1: Digital Twin — 2D Factory Floor Visualization

**Ziel:** Interaktive 2D-Draufsicht der Fabrik mit animierten Werkstücken und Station-Status-Ampeln.

**Was gebaut werden soll:**
1. **SVG Factory Layout** — Draufsicht mit allen 5 Stationen + Verbindungswegen
   - HBW (links): Regal (3×3 Grid) + Stacker Crane + Förderband
   - Crane (mitte): Drehkran mit Vakuumgreifer
   - MS (mitte-rechts): Förderband → Drehtisch → Ofen → Säge
   - PM (rechts-oben): Förderband + Stanzwerkzeug
   - SL (rechts-unten): Förderband → Farbsensor → 3 Sortierfächer (W/R/B)

2. **Station-Ampeln** (nicht Bool-Listen!) pro Station:
   - Grün: Station läuft normal (Aktoren aktiv, Cycle Time im Rahmen)
   - Gelb: Station langsamer als Median (z.B. >20% über historischer Cycle Time)
   - Rot: Fehler/Timeout (z.B. keine Aktivität obwohl erwartet)
   - Grau: Idle (keine Aktivität)

3. **Werkstück-Animation:**
   - Pulsierender Punkt der sich zwischen Stationen bewegt
   - Farbe des Punktes = Werkstückfarbe (nach Color Sensor Lesung)
   - Breadcrumb-Trail der besuchten Stationen
   - Position basiert auf aktuellen Sensor-Events (Light Barriers)

4. **Live-Prozess-Indikator pro Station:**
   - Welcher Sub-Schritt läuft gerade? (z.B. MS: "Burning..." mit Timer)
   - Mini-Fortschrittsbalken basierend auf erwartetem Timing

5. **Durchsatz-Counter:**
   - Werkstücke pro Stunde (abgeleitet)
   - Aktuelle Taktzeit
   - Letzte Farbe sortiert

**Datenquellen:** `/api/data` (polling alle 400ms im Demo-Modus), Events aus CSV

**Ampel-Logik ableiten:**
- Station "aktiv" = mindestens ein Motor/Aktor ist True
- Station "idle" = alle Aktoren False
- "Langsam" = aktuelle Cycle Time > Median der letzten 5 Durchläufe + 20%
- "Fehler" = Station aktiv seit > 2× erwarteter Cycle Time

**Cycle Time Berechnung:**
- HBW: Erste Motor-Aktivierung bis letztes ConveyorBelt_forward=False (~12s)
- Crane: Compressor_C=True bis Compressor_C=False (~12s)
- MS: LightBarrier_MS_conveyorbelt=True bis Valve_MS_Ejector=False (~18s)
- PM: LightBarrier_PM_entry=True bis letztes ConveyorBelt_forward=False (~5s)
- SL: Motor_SL_ConveyorBelt=True bis Motor_SL_ConveyorBelt=False (~6s)

---

### AGENT 2: Quality Binning Dashboard — Battery Grading Story

**Ziel:** Die Farbsortierung als industrielles Qualitäts-Grading visualisieren, inspiriert von Batterie-Zell-Grading (BMW, Tesla) und Intel Chip-Binning.

**Narrative:**
- Burning Station (Ofen) = **Klimakammer-Stresstest** (Thermal Cycling)
- Color Sorting = **Zell-Grading** nach Stresstest
- Weiß = **Grade A** (Premium, EV-tauglich, Farbsensor 250-300)
- Rot = **Grade B** (Standard, Stationärspeicher, Farbsensor 130-190)
- Blau = **Grade C** (Budget, Consumer-Anwendung, Farbsensor 40-60)

**Was gebaut werden soll:**

1. **Temperaturkurve aus Ofen-Verweilzeit:**
   - Ofen-Verweilzeit = Zeit zwischen bLamp_MS=True und bLamp_MS=False (~3s im Simulator)
   - Temperatur-Modell (vereinfacht, Newton'sches Abkühlungsgesetz invers):
     ```
     T(t) = T_ambient + (T_target - T_ambient) × (1 - e^(-t/τ))
     ```
     Mit: T_ambient = 25°C, T_target = 180°C, τ = 1.5s (Zeitkonstante)
   - Für jedes Werkstück eine individuelle Temperaturkurve plotten
   - Annahme: Werkstückmasse ~50g Aluminium, Wärmekapazität 0.9 J/(g·K)
   - NICHT overengineeren — einfache exponentielle Aufheizkurve reicht

2. **Sankey-Diagramm (Materialfluss):**
   ```
   Eingang (alle) ──→ Stresstest (Ofen) ──→ Grade A (Weiß) ──→ EV Battery Pack
                                          ──→ Grade B (Rot)  ──→ Stationary Storage
                                          ──→ Grade C (Blau) ──→ Consumer/Recycling
   ```
   - Breite der Flüsse proportional zur Werkstück-Anzahl
   - Farben: Gold für A, Orange für B, Grau für C

3. **Quality Yield Donut Chart:**
   - Prozentuale Verteilung Grade A / B / C
   - Großer Prozentwert in der Mitte (First Pass Yield = Grade A %)
   - Trend-Pfeil (steigend/fallend vs. letzte 10 Werkstücke)

4. **Grading Distribution Histogram:**
   - X-Achse: Farbsensor-Wert (0-300)
   - Y-Achse: Anzahl Werkstücke
   - Vertikale Linien bei Grade-Grenzen (100, 220)
   - Eingefärbte Bereiche: Blau | Rot | Weiß/Gold

5. **Korrelation: Burn Time ↔ Final Grade:**
   - Scatter Plot: X = Ofen-Verweilzeit, Y = Farbsensor-Wert
   - Punkte eingefärbt nach Grade
   - Zeigt: "Längerer Burn = gleichmäßigere Qualität" (Fake-Narrative für Demo)

6. **Traceability Table:**
   - Letzte 10-20 Werkstücke
   - Spalten: ID | Burn Time | Peak Temp | Color Value | Grade | Timestamp
   - Klickbar → expandiert zu Station-by-Station Journey

7. **Simulierte Cycle-Life-Prognose:**
   - Grade A: 2000+ Zyklen (EV-Level)
   - Grade B: 500-1000 Zyklen (Stationär)
   - Grade C: <100 Zyklen (Consumer)
   - Bar Chart mit confidence intervals

**Technische Hinweise:**
- Für Sankey: D3.js oder Apache ECharts (Plugin) — Entscheidung beim Agent
- Temperaturkurve kann mit Chart.js als Line Chart dargestellt werden
- Daten aus simulierter CSV ableiten oder live während Demo berechnen

---

### AGENT 3: KPI & Process Analytics Dashboard

**Ziel:** Industriestandard-KPIs (OEE, Cycle Time, Bottleneck-Analyse) mit professioneller Visualisierung.

**Was gebaut werden soll:**

1. **Cycle Time Bar Chart pro Station:**
   - Horizontale Balken: HBW | Crane | MS | PM | SL
   - Takt-Linie (theoretisches Maximum) als vertikale Referenz
   - Farbe: Grün wenn unter Takt, Rot wenn über Takt
   - Jeder Balken zeigt Median der letzten N Durchläufe

2. **Sub-Step-Aufschlüsselung (Stacked Bar / Yamazumi):**
   - Für MS (komplexeste Station): Conveyor | Turntable→Transfer | Oven Load | Burn | Oven Unload | Saw | Eject
   - Zeigt welcher Sub-Step der Bottleneck ist
   - Safety Gaps (Idle-Zeit zwischen Steps) sichtbar machen
   - Optimierungs-Potenzial visualisieren: "Was wäre wenn Burn 1s kürzer?"

3. **OEE Gauge (vereinfacht):**
   - Drei Teil-Gauges: Availability × Performance × Quality = OEE
   - Availability = (Laufzeit - Stillstand) / Gesamtzeit
   - Performance = (Theoretische Cycle Time × Stückzahl) / Laufzeit
   - Quality = Grade A / (Grade A + B + C)  [aus Quality Binning]
   - Farbzonen: Grün >85%, Gelb 65-85%, Rot <65%
   - Großer OEE-Wert in der Mitte

4. **Cycle Time Trend (Zeitreihe):**
   - X = Werkstück-Nummer oder Timestamp
   - Y = Cycle Time pro Station
   - Median-Linie + Bänder (±10% grün, ±20% gelb, >20% rot)
   - Zeigt Drift / Degradation über Zeit

5. **Bottleneck-Identifikation:**
   - Automatisch die Station mit der höchsten Cycle Time hervorheben
   - "Bottleneck: MS (Machining Station) — 18.2s avg, Takt: 15s"
   - Tipp: "Reduce burn time by 2s to match takt"

6. **Throughput & Productivity:**
   - Werkstücke/Stunde (aktuell vs. theoretisches Maximum)
   - Kumulative Produktion über Zeit (Step Chart)
   - Durchsatz-Rate Trend

7. **Downtime Pareto (wenn Daten vorhanden):**
   - Falls Stillstände erkannt werden (Gap > erwartete Cycle Time)
   - Pareto-Balken: Sortiert nach Dauer
   - Kumulative %-Linie

**Cycle Time Berechnung (Detail):**
```
Für jeden Durchlauf, pro Station:
  start = Timestamp des ersten Aktor-Events (Motor/Valve/Compressor = True)
  end   = Timestamp des letzten Aktor-Events bevor alles False wird
  cycle_time = end - start

Sub-Steps innerhalb MS:
  conveyor_time = Turntable_clockwise=True.ts - ConveyorBelt_forward=True.ts
  transfer_time = TransferUnit_atoven=True.ts - Turntable_attransferunit=True.ts
  burn_time     = Lamp_MS=False.ts - Lamp_MS=True.ts
  saw_time      = Saw=False.ts - Saw=True.ts
  etc.
```

---

### AGENT 4: Executive Cockpit & Alerts Dashboard

**Ziel:** High-Level "Leitstand" Übersicht für Management — auf einen Blick sehen ob alles läuft. Plus Error Detection.

**Was gebaut werden soll:**

1. **SQCDP KPI Tiles (4-6 große Kacheln):**
   - **S (Safety):** Emergency Status (bEmergencyShutdown) — Grün/Rot
   - **Q (Quality):** First Pass Yield (Grade A %) — mit Trend-Pfeil
   - **C (Cost):** OEE-Wert — Gauge mit Farbzone
   - **D (Delivery):** Throughput vs. Target (Werkstücke/Stunde)
   - **P (People/Process):** Uptime % — wie viel der Zeit war die Fabrik aktiv

2. **Station-Ampel-Übersicht:**
   - Alle 5 Stationen als große Kreise/Quadrate
   - Ampelfarbe (Grün/Gelb/Rot/Grau)
   - Darunter: Station-Name + aktuelle Cycle Time
   - Klick → expandiert zu Mini-Detail

3. **Alert Log / Error Detection:**
   - Echtzeit-Feed von Anomalien:
     - "Cycle Time Anomaly: MS took 24.3s (expected 18s)" → Gelb
     - "Station Timeout: PM idle for 120s" → Rot
     - "Color Sensor Drift: Reading 312 (expected 250-300)" → Gelb
     - "Emergency Shutdown Activated" → Rot/Blinkend
   - Alerts basierend auf:
     - Cycle Time > Median + 2σ
     - Station idle wenn Werkstück erwartet
     - Farbsensor außerhalb bekannter Bereiche
     - Unerwartete Aktor-Kombinationen

4. **Production Timeline (Gantt-artig):**
   - Zeitachse horizontal
   - Pro Station ein Balken: Grün=aktiv, Grau=idle, Rot=error
   - Zeigt wann welche Station gearbeitet hat
   - Overlaps = Parallelität sichtbar

5. **Shift Summary (wenn genug Daten):**
   - Total Werkstücke produziert
   - Grade A/B/C Verteilung
   - Durchschnittliche Cycle Time
   - Anomalien-Count
   - "Best Run" vs. "Worst Run" Vergleich

---

## 8. INTEGRATION & NAVIGATION

Nachdem alle Agenten ihre Dashboards gebaut haben, muss ein **Integrations-Schritt** stattfinden:

1. **Navigation** zwischen Dashboards (Tab-Leiste oder Sidebar)
2. **Shared Flask-Server** mit Routing zu allen Dashboard-Pages
3. **Shared CSS** (Design-System) als importierbare Datei
4. **Neue API-Endpoints** die von den Agenten definiert wurden müssen in server.py zusammengeführt werden

### Vorgeschlagene URL-Struktur:
```
/                     → Dashboard-Übersicht oder Default-Dashboard
/twin                 → Digital Twin (Agent 1)
/quality              → Quality Binning (Agent 2)
/kpi                  → KPI & Analytics (Agent 3)
/cockpit              → Executive Cockpit (Agent 4)
/api/...              → Shared API Endpoints
```

---

## 9. DATEN-PIPELINE FÜR DASHBOARDS

Da die echten CSV-Daten nur Idle-State enthalten, muss jeder Agent mit **simulierten Daten** arbeiten. Empfohlene Strategie:

### Option A: Mehr Daten simulieren
```bash
cd "tag 6/"
python simulate_factory.py --runs 20
```
Das erzeugt eine neue CSV mit 20 Durchläufen (~4.500 Events). Diese dann mit `database.py --import` in SQLite importieren.

### Option B: Daten on-the-fly im Backend berechnen
Ein neues Python-Modul `analytics.py` das:
- CSV/SQLite parsed
- Cycle Times pro Station pro Durchlauf berechnet
- OEE berechnet
- Qualitäts-Grade zuweist
- Temperaturkurven generiert
- Anomalien detektiert

Dieses Modul stellt dann API-Endpoints bereit:
```
GET /api/analytics/cycle-times      → [{run: 1, station: "MS", cycle_time: 18.2, sub_steps: {...}}, ...]
GET /api/analytics/oee              → {availability: 0.92, performance: 0.87, quality: 0.95, oee: 0.76}
GET /api/analytics/quality-grades   → [{run: 1, color_value: 257, grade: "A", burn_time: 3.0}, ...]
GET /api/analytics/temperature      → [{run: 1, t: [0,0.5,1,...], T: [25,45,82,...], peak: 165}, ...]
GET /api/analytics/alerts           → [{type: "cycle_time_anomaly", station: "MS", ...}, ...]
GET /api/analytics/throughput       → {per_hour: 42, theoretical_max: 60, utilization: 0.7}
```

### Option C (empfohlen): Kombination
- Simuliere 20+ Durchläufe in CSV
- `analytics.py` berechnet daraus alle KPIs
- Flask-Server exponiert die berechneten Daten als API
- Dashboards holen sich die fertigen KPIs via Fetch

---

## 10. ZUSAMMENFASSUNG DER ENTSCHEIDUNGEN

| Thema | Entscheidung |
|-------|-------------|
| Tech Stack | Flask + Vanilla JS + Chart.js, weitere Libs nur wenn nötig |
| Datenquelle | Simulierte CSV (nicht die Idle-Polling-CSV!) |
| Temperatur | Aus Ofen-Verweilzeit berechnen (Newton'sches Modell, simpel) |
| Cycle Time | Erste Aktor-Aktivierung → letzte Deaktivierung pro Station |
| Sub-Steps | Innerhalb MS aufschlüsseln (Conveyor, Transfer, Burn, Saw) |
| Design | Glassmorphism, Dark/Light, KEINE Bool-Listen, NUR Ampeln/KPIs |
| Navigation | Tabs oben (wie bestehendes Live/History Toggle) |
| Priorität | Digital Twin + Quality Binning sind Kern, KPI + Cockpit sind Bonus |
| Farb-Grading | Weiß=Grade A, Rot=Grade B, Blau=Grade C |
| OEE | Vereinfacht: Availability × Performance × Quality |

---

## 11. QUALITÄTSKRITERIEN

- Dashboard muss im **Demo-Modus funktionieren** (kein PLC, kein OPC UA nötig)
- Muss auf **localhost** laufen (Flask dev server)
- Dark + Light Theme müssen beide gut aussehen
- Keine leeren Charts — wenn keine Live-Daten, dann simulierte Daten zeigen
- Responsive Layout (funktioniert auf 1440px+ Screens, skaliert runter auf 768px)
- Kein npm/webpack/build-step — pure HTML/JS/CSS die direkt vom Flask-Server serviert werden
- Performance: Polling alle 400ms darf UI nicht laggen
