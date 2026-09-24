# Stal Windrakerhof planning

Weekschema voor het buiten en binnen zetten van de paarden, gedeeld via een link in de WhatsApp-groep.

- Twee weken tegelijk: **Deze week (actueel)** en **Volgende week**, maandag t/m zondag.
- Per dag 2 personen voor *buiten zetten* en 2 voor *binnen zetten*.
- **Vast**-vinkje: die naam komt elke week automatisch terug op die dag, tot iemand het uitvinkt.
- Nieuwe week? Dan schuift het schema vanzelf door.
- Gedeeld notitieveld, oranje markering voor lege plekken, weerbericht voor Puth (Open-Meteo).
- Alles wordt live gedeeld via Firebase Firestore; inloggen is niet nodig.

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html`, `style.css`, `app.js` | De website |
| `firebase-config.js` | Koppeling met het Firebase-project |
| `firestore.rules` | Wie wat mag opslaan (plakken in Firebase → Firestore → Regels) |
| `img/` | Logo en iconen |

Live: <https://rraaiimmoonndd.github.io/stal-windrakerhof-planning/>

## Firebase

De site gebruikt Firestore in het Firebase-project `stal-windrakerhof` (ingesteld in `firebase-config.js`; alleen de project-ID is nodig).

Regels aanpassen: Firebase console → **Firestore Database → Regels**, vervang alles door de inhoud van `firestore.rules` en klik **Publiceren**.

Met een lege `projectId` bewaart de site alles alleen op het eigen apparaat (handig om te testen).

## Lokaal bekijken

```bash
python3 -m http.server 8000
```

en open <http://localhost:8000>.
