# Hearthfall playtest kit

A checklist for a playtest with real people: one player alone, or two players on two computers at home. The single player plan (what to try, in order) is in `docs/PROGRESS.md` "First human playtest"; this page adds the two computer session and what to bring back.

## 1. Build and start (host computer)
```
cd C:\Users\stewa\Documents\Claude\Hearthfall
npm run build
npm run serve -- --lan
```
- The window prints the address for this computer (http://127.0.0.1:5182/) and one "LAN play" address per network card for the other computer. Leave the window open; Ctrl+C stops it when you are done.
- The first time, Windows may ask whether Node may use private networks: allow it, or the other computer cannot connect.
- Use Chrome or Edge on both computers. Full screen at 1920x1080 or larger looks best; Interface size is in Settings.
- One player alone: `npm run serve` without `--lan` is enough.

## 2. Join (second computer)
1. Open the "LAN play" address in Chrome or Edge.
2. Both pick **Play together** on the main menu.
3. One presses **Host a match** and reads out the four letter room code; the other types it and presses **Join**.
4. The host picks the match. It uses the host's Skirmish setup (map, size, rivals, rules), so set that up first.
   - **Play against each other:** head to head; any extra tribes keep their AI.
   - **Play together against the AI:** one team against every AI rival in the setup.
   - **Play the campaign together:** both command the same tribe in the host's next open campaign level.

## 3. What to try together (about 90 minutes)
1. **Together against one easy AI rival** on continents (20 min). Do orders from both players feel instant? Is it clear which units are whose?
2. **Against each other,** small map, no AI (20 min). Does the match stay in step the whole way (no "Waiting for your partner" notes that last)?
3. **Campaign together,** the first open level (20 min). Who does what when you share one tribe?
4. **Drop out on purpose** (5 min): on the second computer, turn Wi-Fi off for 5 seconds and back on. It should say "Connection lost. Rejoining the match..." and carry on. Then close its tab: the host waits 30 seconds (or press "Let the AI play their tribe") and the AI takes over.
5. **After a match:** Watch replay on the end screen (or Main menu > Last replay) on both computers. Both should play to the end and show Verified, not Out of sync.

## 4. If something goes wrong
- **"The two games drifted apart (a desync)":** the end screen offers **Save a desync report**. Save it on both computers and keep the files; they hold the tick, both checks and the last 400 orders.
- **A visual bug:** photo mode (F, then Enter saves a PNG), or note the seed, the map and the minute.
- **Cannot connect:** both computers must be on the same network; check the Windows firewall prompt from step 1; try the other "LAN play" address if there are two.
- **Stutter:** note the map size and the number of tribes; Settings > Quality has lower settings.

## 5. What to bring back
A few lines each is plenty.
- The best moment and the most frustrating moment, for each player.
- Anything you could not figure out without asking.
- Pace: matches too slow or too fast? Mana too scarce?
- Spells that felt weak or useless; units you never trained.
- For the shared matches: did the network ever get in the way? Any desync reports, photo mode shots and the replays you want me to look at (end screen > Download replay).
