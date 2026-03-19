# Dashboard Feedback — Round 1 (19.03.2026, ~23:00)

## Korrekte Prozessreihenfolge (WICHTIG)
1. **HBW** (Hochregallager) — Werkstück wird aus Regal geholt
2. **Crane** — Transportiert zum Ofen
3. **MS/Oven** — Brennvorgang (Ofen an/aus sichtbar)
4. **MS/Out** — Aus Ofen raus
5. **SL/Color** — Farbmessung (NICHT vom Hauptkran, direkt übernommen). Hier bekommt Werkstück seine Farbe!
6. **SL/Sort** — Sortierung via Förderband in richtige Kategorie
7. **Crane** — NACH dem Sortieren: Crane holt es zurück ins Regal (letzter Schritt!)

**Wichtig:** Farbe ist UNBEKANNT bis zur Farbmessung. Vorher grau/neutral.

---

## Twin Feedback

### Gefallen (aus allen Versionen):
- Werkstück-Punkt bewegt sich durch die Factory (V1)
- Ofen-Animation (an/aus visuell sichtbar) (V1)
- Farbe erscheint erst bei Farbmessung (V1)
- Sortier-Visualisierung (welcher Bin) (V1)
- Klare Station aktiv/inaktiv Signalisierung (V1, V2)
- Menschenlesbare Aktionen "Turntable → CW" (V2)
- Zykluszeit-Anzeige: letzter Zyklus + Durchschnitt (V3)
- Ampel-Konzept für Zykluszeiten (V3 Idee)

### Nicht gefallen:
- ALLE zu detailliert, nicht auf Wesentliches heruntergebrochen
- Zu viel angenommen vs. tatsächlich vorhanden
- V3 optisch nicht ansprechend

### Gewünschte Features:
- Ampel pro Station (grün/gelb/rot basierend auf Zykluszeit vs. Erwartung)
- Pulsende Animation bei aktivem Schritt (satisfying zum Zuschauen)
- Ofen: Rand wird rot während Brennvorgang

---

## Quality Feedback

### Gefallen:
- Run Details mit Rückverfolgbarkeit (V2)
- Toggle/Collapsible Sections (V2)
- Klassifizierung nach Grade macht Sinn (V2)
- Quartile statt Min/Max (V3 Idee)

### Nicht gefallen:
- **Donut/Pie-Chart ist sinnlos** — immer ~33% pro Farbe, nicht aussagekräftig → ENTFERNEN
- **Gelbes Farbschema** gefällt gar nicht
- Burn Time ist immer gleich lang → kein sinnvolles Diagramm
- Quality Yield prozentuale Anteile sagen nichts aus

### Gewünschte Features:
- **Farbwert als Hauptmetrik** — Y-Achse = Color Sensor Value, über Bauteile/Zeit
- Grade mit tatsächlicher Farbe visuell verknüpfen
- Drift-Erkennung über zeitlichen Verlauf der Farbwerte
- Filteroptionen (Zeitraum, Grade, etc.)
- Zwei Dateien grafisch vergleichen können
- Quartile zeigen statt Min/Max

---

## KPI Feedback

### Gefallen:
- "Production Efficiency Gap: X%" — SEHR STARKE Message (V3)
- Station-Timing mit theoretisch vs. tatsächlich (V1)
- Cycle Time Balken mit gestrichelter Target-Linie (V2)
- Wasserfall-Diagramm theoretisch geeignet (V3, Umsetzung noch nicht perfekt)

### Nicht gefallen:
- **Availability, Performance, Quality** — nichtssagend, unklar was das sein soll
- Runde Diagramme (Gauge) nicht passend
- OEE-Berechnung unklar/nicht überzeugend
- Quality immer ~33% (vorbestimmt durch 3 Farben)
- Darstellung teils "billig" (V2 Balken mit Hintergrund)

### Gewünschte Features:
- **Stacked Chart** — alle Prozesse in einem, theoretisch vs. tatsächlich
- **Interaktiver Slider** für Goal-Time: verschieben und sehen wie sich Gesamtdurchlaufzeit ändert
- **What-If Visualisierung**: "Wenn wir Station X auf Target bringen, sparen wir Y Sekunden"
- Safety-Buffer Visualisierung pro Station
- Cleaner Balken-Design (ohne Hintergrund, mit Gradient)
- Empfehlungen/Motivation: "So könnten Sie X% verbessern"

---

## Cockpit Feedback

### KLARER FAVORIT: Cockpit V1 (Andon Board / Traffic Light Wall)
- **"Mit Abstand die allergeilste Darstellung"**
- Runde Station-Darstellung ist optimal
- Noch nicht 100% professionell, muss poliert werden

### Gewünschte Features für Cockpit:
- **Farbneutrale Kreise** bis Farbmessung, dann Farbe anzeigen
- **Ofen: Rand rot** während Brennvorgang
- **Pulsende Animation** bei aktivem Kreis (heller/dunkler pochen)
- **Ampel-System**: Gelb wenn Prozess zu lang, Rot wenn viel zu lang
- **HBW: 9 Punkte** in der Ecke des Kastens (= 9 Regalfächer), zeigen Belegung
- **Sorting Bins: 9 Plätze** die sich mit farbigen Punkten füllen nach Sortierung
- **Crane-Schritt** nach Sortierung zeigen (zurück ins Regal)
- **Produktionsziel**: Wie viele Teile heute produziert vs. Soll
- Alerts-Toggle beibehalten (aufklappbar)
- "Demo Mode OEE" entfernen — nichtssagend
- Throughput/Quality Labels durch bedeutungsvolle Inhalte ersetzen

### Cockpit V2: Nichts Brauchbares
### Cockpit V3:
- Throughput/hr gut für operative Ebene
- Active Station Display cool
- Nicht so überzeugend wie V1

---

## Generelle Erkenntnisse

### Design-Prinzipien:
1. **Nur zeigen was wir wissen** — keine Fake-Daten
2. **Weniger ist mehr** — alle Versionen waren zu detailliert
3. **Bedeutung vor Daten** — Was sagt die Zahl dem Nutzer?
4. **Interaktivität** — Slider, Toggles, What-If Szenarien
5. **Gelb als Farbe vermeiden** — User mag es nicht
6. **Runde Diagramme (Gauges/Donuts) vermeiden** — nicht aussagekräftig genug
7. **Professionelles Finish** nötig — aktuell noch "billig"

### Nächste Schritte:
- 2 neue Versionen pro Dashboard-Kategorie mit eingearbeitetem Feedback
- Alte Versionen als "v1-archive" markieren
- Fokus auf Cockpit V1 als Basis weiterentwickeln
- Stacked Charts für KPI
- Farbwert-basierte Quality-Analyse
- Interaktive Slider für Goal-Times
