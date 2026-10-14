# PrusaLink

Verfolge deine Prusa-3D-Drucker in Gladys über **PrusaLink**, die lokale
Weboberfläche, die in die Firmware der aktuellen Prusa-Drucker eingebaut ist
(beim MK3S+ auf einem Raspberry Pi installiert). Alles bleibt in deinem
lokalen Netzwerk: Gladys spricht direkt mit dem Drucker, ein Prusa-Connect-Konto ist nicht nötig.

**Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Die Integration
wurde anhand der Beschreibung der PrusaLink-API, der Home-Assistant-Integration und ihrer aufgezeichneten Antworten gebaut und gegen einen
Simulator getestet, der sich wie die Drucker-Firmware anmeldet. An einem echten Drucker wurde sie noch nicht ausprobiert: Erzähl uns im Gladys-Forum,
wie sie mit deinem läuft.

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer.
- Ein Prusa-Drucker mit PrusaLink: MK4, MK4S, MK3.9, MK3.5, Core One, XL oder
  MINI+ mit Firmware 5.0 oder neuer (6.x empfohlen), per WLAN oder Ethernet
  mit deinem Netzwerk verbunden; oder ein MK3S+ mit PrusaLink auf einem
  Raspberry Pi.
- PrusaLink am Drucker aktiviert: **Einstellungen → Netzwerk → PrusaLink**.
  Derselbe Bildschirm zeigt das Passwort (Benutzer `maker`).
- Der Drucker ist vom Gladys-Rechner aus erreichbar (gleiches Netzwerk oder
  geroutet).

## Konfiguration

1. Öffne am Drucker **Einstellungen → Netzwerk**: Notiere seine IP-Adresse,
   aktiviere **PrusaLink** und notiere das Passwort. Eine feste IP-Adresse
   (eine DHCP-Reservierung im Router) verhindert, dass der Drucker später
   verloren geht.
2. Öffne in Gladys den Reiter **Konfiguration** der Integration.
3. Gib unter **Druckeradresse** die IP-Adresse ein, zum Beispiel
   `192.168.1.60` (ein Port ist möglich: `192.168.1.60:8080`). Nimm lieber
   eine IP-Adresse: Namen wie `prusa-mk4.local` werden im Container der
   Integration nicht aufgelöst.
4. Lass **Benutzer** leer (der Benutzer der Drucker ist immer `maker`). Nur
   PrusaLink auf einem Raspberry Pi lässt dich im Einrichtungsassistenten einen
   anderen wählen.
5. Füge unter **PrusaLink-Passwort** das Passwort ein, das der Drucker
   anzeigt. Sehr alte Firmware nutzt stattdessen einen API-Schlüssel: Füge ihn
   in dasselbe Feld ein, die Integration probiert beides.
6. Speichere. Der Status des Konfigurationsbildschirms wechselt nach der
   ersten Antwort des Druckers auf verbunden.
7. Ein zweiter oder dritter Drucker: Fülle **Drucker 2** und **Drucker 3**
   genauso aus.
8. **Sprache** legt die Sprache der Funktionsnamen und Texte fest, die die
   Integration erzeugt (standardmäßig Französisch). Funktionsnamen werden beim
   Hinzufügen des Geräts zu Gladys festgelegt.

Füge den Drucker danach im Reiter **Entdecken** hinzu.

## Das Druckergerät

Ein Gerät pro Drucker, benannt nach dem Druckernamen in PrusaLink oder nach
seinem Hostnamen. Die Integration liest den Drucker während eines Drucks alle
10 Sekunden und sonst alle 30 Sekunden (Home Assistant liest ihn alle
30 Sekunden): Der Drucker ist ein kleiner Webserver, er wird nicht öfter
abgefragt.

| Funktion              | Was sie zeigt                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                | Inaktiv, Bereit, Beschäftigt, Druckt, Pausiert, Eingriff nötig, Fertig, Abgebrochen, Fehler, Drucker nicht erreichbar, Passwort fehlt oder abgelehnt                           |
| Datei                 | Die gedruckte Datei (vollständiger Name, `benchy.bgcode`) oder „Keine Datei“                                                                                                   |
| Fortschritt           | Prozent des Drucks (0 ohne Auftrag)                                                                                                                                            |
| Verstrichene Zeit     | In Minuten                                                                                                                                                                     |
| Restzeit              | Vom Drucker geschätzt, in Minuten (0, wenn nichts gedruckt wird)                                                                                                               |
| Düse, Druckbett       | Temperaturen in ganzen Grad                                                                                                                                                    |
| … (Soll)              | Solltemperaturen, nur lesbar                                                                                                                                                   |
| Druckgeschwindigkeit  | Der am Drucker eingestellte Geschwindigkeitsfaktor in Prozent (100 % = normal)                                                                                                 |
| Filament              | Die geladene Filamentart (PLA, PETG…), wenn der Drucker sie meldet                                                                                                             |
| Pausieren, Fortsetzen | Drucktasten                                                                                                                                                                    |
| Kamera                | Das Kamerabild, nur bei PrusaLink auf einem Raspberry Pi mit Kamera (die Kameras von Core One und MK4 schicken ihre Bilder nur an Prusa Connect, PrusaLink hat keinen Zugriff) |

Es gibt bewusst **keine Abbrechen-Taste** am Gerät: Ein Tippen ohne
Bestätigung würde einen Druck ruinieren. Abbrechen geht über das Widget (mit
Bestätigung) und über Szenen. Temperaturen und Solltemperaturen sind nur
lesbar, und die Integration sendet **überhaupt keinen Heizbefehl**: Eine
Heizung des Druckers lässt sich nie aus Gladys einschalten, auch nicht über
HomeKit, Alexa oder Google. Für Gladys sind es „Gerätetemperaturen“, daher zählen sie nie zur Raumtemperatur.

Wenn der Drucker anfängt, seine Filamentart zu melden, oder eine Kamera
auftaucht, bietet Gladys im Reiter **Entdecken** an, das Gerät zu
aktualisieren.

## Dashboard-Widget

Füge das Widget **3D-Drucker** einem Dashboard hinzu und wähle den Drucker in
seinen Einstellungen. Es zeigt:

- die Fortschrittsanzeige, die Restzeit, die Temperaturen von Düse und
  Druckbett (live);
- das Kamerabild, falls vorhanden, sonst das Vorschaubild der gedruckten
  Datei;
- den Status, die Meldung des Druckers, wenn etwas nicht stimmt, die Datei,
  die verstrichene Zeit, die voraussichtliche Endzeit, die aktiven
  Solltemperaturen, die Geschwindigkeit und das Filament;
- die passenden Tasten: **Pausieren** oder **Fortsetzen** und **Abbrechen**
  (fragt nach Bestätigung) während eines Drucks. Wenn der Drucker einen
  Eingriff braucht, nur Abbrechen: Die Antwort gibst du am Drucker.

## Szenenauslöser

In der Kategorie **Integrationen** des Szeneneditors. Jeder lässt sich auf
einen Drucker beschränken.

- **Druck gestartet** — Variablen: Druckername, Datei.
- **Druck fertig** — Variablen: Druckername, Datei, Druckdauer (als Text wie
  `1 Std. 05 Min.` und in Minuten).
- **Druck fehlgeschlagen oder abgebrochen** — lässt sich auf einen Grund
  beschränken (abgebrochen, Fehler). Variablen: Druckername, Datei,
  Druckdauer, Grund, Druckermeldung.
- **Druck pausiert** — am Drucker, in PrusaLink, Prusa Connect oder Gladys.
  Variablen: Druckername, Datei, verstrichene Zeit.
- **Eingriff nötig** — der Drucker wartet auf jemanden: Filamentende, eine
  Frage auf dem Display. Variablen: Druckername, Datei, verstrichene Zeit,
  Druckermeldung.
- **Druckerfehler** — der Drucker ist in den Fehlerzustand gewechselt, mit
  oder ohne Druck (ein Fehler während eines Drucks löst auch Druck
  fehlgeschlagen aus). Variablen: Druckername, Datei, verstrichene Zeit,
  Druckermeldung.

Die Variablen liest du in den folgenden Aktionen zum Beispiel mit
`{{triggerEvent.data.file}}` und `{{triggerEvent.data.duration}}`.

## Szenenaktionen

- **Druck pausieren, fortsetzen oder abbrechen** — gibt **Ausgeführt**: falsch
  zurück, wenn nichts zu pausieren, fortzusetzen oder abzubrechen war (die
  Szene läuft weiter). Ein Abbruch ist endgültig: Wähle ihn bewusst.
- **Druckerstatus lesen** — gibt einen fertigen **Satz** zum Senden oder
  Vorlesen zurück („Prusa MK4: Druckt, benchy.bgcode, 37 %, noch 1 Std.
  05 Min.“) und die Werte zum Prüfen in den folgenden Aktionen: Status
  (`printing`, `paused`, `finished`…), Status wie angezeigt, Datei,
  Fortschritt, Restzeit in Minuten.

## Szenenbeispiele

- **Druck fertig → Benachrichtigung**: Auslöser Druck fertig, Aktion
  „Nachricht senden“:
  `{{triggerEvent.data.file}} fertig in {{triggerEvent.data.duration}}`.
- **Filamentende → jemanden rufen**: Auslöser Eingriff nötig, Aktion
  „Nachricht senden“:
  `Der Drucker braucht dich: {{triggerEvent.data.message}}`.
- **Rauch erkannt → Druck stoppen**: Auslöser am Rauchmelder, Aktion Druck
  pausieren, fortsetzen oder abbrechen (abbrechen), dann die smarte Steckdose
  des Druckers ausschalten.
- **Wie weit ist mein Druck?**: eine Aktion „Druckerstatus lesen“, dann
  „Nachricht senden“ mit ihrem Satz, per Taste oder stündlich während eines
  Drucks.

## Fehlerbehebung

- **PrusaLink antwortet nicht**: Prüfe, ob PrusaLink am Drucker aktiviert ist,
  und die Adresse vom Gladys-Rechner aus
  (`curl http://192.168.1.60/api/version` antwortet ohne Passwort mit 401:
  Der Drucker ist erreichbar). Nimm eine IP-Adresse statt eines
  `.local`-Namens.
- **Benutzer oder Passwort abgelehnt**: Kopiere das Passwort erneut aus
  **Einstellungen → Netzwerk → PrusaLink** (es ändert sich, wenn du es am
  Drucker neu erzeugst). Lass Benutzer leer, außer bei PrusaLink auf einem
  Raspberry Pi.
- **Die Werte ändern sich langsam**: Der Drucker wird während eines Drucks
  alle 10 Sekunden gelesen, sonst alle 30 Sekunden. Ein kürzerer Druck wird
  eventuell erst an seinem Ende gesehen.
- **Keine Filamentart**: Ältere Firmware meldet sie nicht; die Funktion gibt
  es dann nicht.
- **Kein Kamerabild**: Nur PrusaLink auf einem Raspberry Pi liefert ein
  Kamerabild; es muss ein JPEG oder PNG von höchstens etwa 110 KB sein (eine
  Grenze von Gladys).
- Protokolle: auf der Seite der Integration in Gladys oder mit `docker logs`
  auf dem Rechner. `LOG_LEVEL=debug` zeigt die Details. Das Passwort erscheint
  nie in den Protokollen.

## Grenzen

- Bis zu drei Drucker.
- Kein Hochladen von Dateien, kein Druckstart aus Gladys, kein Temperatur- oder G-Code-Befehl, kein Zeitraffer, kein Prusa Connect (Cloud).
- Ein Druck, der ohne Fertig oder Abgebrochen zu Inaktiv oder Bereit
  zurückkehrt (Display bestätigt, während der Drucker nicht erreichbar war),
  löst kein Ende aus.
- Der Drucker wird gelesen, er meldet nichts von sich aus: Ein Ereignis von
  weniger als 10 Sekunden kann übersehen werden.
- Der XL meldet nur eine Düsentemperatur.
- Ohne die Hardware entwickelt: Rückmeldungen willkommen.
- Nicht mit Prusa Research verbunden. Prusa, Original Prusa und PrusaLink sind
  Marken von Prusa Research a.s.
