# Souk Siege

A multiplayer first-person shooter in the browser, set in a walled desert
town that is generated fresh for every match. Up to 8 players per match,
across four modes:

| Mode | Teams | Goal |
| --- | --- | --- |
| Team Deathmatch | 4 v 4 | First team to 50 kills (10 min) |
| Free for All | everyone | First to 25 kills (10 min) |
| King of the Hill | 4 v 4 | Hold the hill with no enemy on it; it moves every 75 s. First to 150 |
| Bomb Defusal | 4 v 4 | Plant at A or B / stop it. One life per round, first to 7, sides swap after 6 |

A match needs at least 2 players to start. Until then everyone can warm up.

Four loadouts (SMG, LMG, Shotgun, Sniper), each with the same pistol and
two grenades. Aiming uses iron sights on the SMG, Shotgun and pistol, a red
dot on the LMG and a 6× scope on the Sniper. Holding F aims (and stops a run);
a two-finger click toggles aim. The controls are tuned for a
trackpad, and every key can be rebound in Settings, with two bindings per
action.

## Running it

It needs Python 3.9 or newer and nothing else. There are no packages to
install.

```bash
python3 server/server.py 8765      # then open http://localhost:8765
```

Anyone on the same Wi-Fi can join at `http://<this Mac's IP>:8765`.

The server serves the page and runs the rooms over a WebSocket at `/ws`.
It reads `$PORT` when no port is given, which is how cloud hosts pass it
in.

## Putting it online

- **Render**: push this folder to a GitHub repo, then in Render choose
  New → Blueprint and pick the repo. `render.yaml` does the rest. The
  free plan sleeps after 15 idle minutes, so the first visitor waits about
  a minute. The Starter plan stays up all the time.
- **Fly.io / Railway / a VPS**: use the `Dockerfile`.

## Releasing a change

Every change ships with a version bump and patch notes, which players see
every time the page loads:

1. Bump `VERSION` in `public/js/version.js` **and** `server/server.py`.
2. Add an entry at the top of `PATCH_NOTES` in `public/js/version.js`,
   written for players.

When the server's version changes, open pages reload themselves once to
pick up the new build.

## Layout

| Path | What it is |
| --- | --- |
| `server/server.py` | HTTP + WebSocket server, rooms, match rules, damage |
| `server/mapgen.py` | the random town: buildings with interiors and stairs, props, spawns, sites, hills |
| `public/js/game.js` | local player, weapons, bloom and recoil, network glue, render loop |
| `public/js/viewmodel.js` | first-person guns, sights, reload animations |
| `public/js/physics.js` | collision and raycasts against the town's oriented boxes |
| `public/js/world.js` | builds the town's meshes, sky and sun |
| `public/js/avatars.js` | other players, interpolation, hit volumes |
| `public/js/effects.js` | tracers, muzzle flashes, impacts, grenades, explosions |
| `public/js/hud.js`, `main.js` | HUD, menus, settings, patch notes |
| `tools/bot.py` | a scripted test player |
| `tools/test_server.py` | checks each mode's rules against a running server |

## Testing

```bash
python3 tools/test_server.py            # kills and scores, hill, bomb plant/explode/defuse
python3 tools/bot.py --mode tdm         # a second player so a match starts
```

Opening the page with `?autotest=tdm` (or `ffa`, `koth`, `bomb`) joins
straight away and runs through the controls. It reports to the server log,
which also collects script errors from every player's browser.
