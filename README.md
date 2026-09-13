# RUNO

A small multiplayer UNO-style game. Static frontend, authoritative Node.js backend, no npm dependencies. Rooms for 2–8 players, invite links, chat, rematches, session reconnects, host controls, and session win counts. No accounts required. The home screen lists joinable rooms by host name and refreshes every five seconds; room codes still work.

**House rule: call UNO on your turn before playing the last card.** Attempting to play it without calling draws two penalty cards and ends the turn; the attempted card stays in hand.

## Run locally

Requires Node.js 22 or later.

```sh
npm start
```

Open http://localhost:3000. Use separate browsers or a private window for additional players. A browser stores one player session; refreshing reconnects to that seat. Run `npm test` for the rule and HTTP integration tests.

## Host the frontend on GitHub Pages

1. Set `window.GAME_SERVER` in `public/config.js` to the backend's HTTPS URL, such as `https://cards.example.com` (no trailing `/api`). This is public configuration, not a secret.
2. Push to GitHub on `main`.
3. In repository **Settings → Pages**, choose **GitHub Actions** as the source. The included workflow publishes only `public/`. Paths work with project Pages URLs such as `https://you.github.io/runo/`.

## Host the backend

Copy the repository to your server and run with Node 22+. No build or dependency installation is needed.

```sh
PORT=3000 ALLOWED_ORIGINS=https://you.github.io node server/index.js
```

`ALLOWED_ORIGINS` is a comma-separated list of exact frontend origins, without paths or trailing slashes. Local defaults allow `http://localhost:3000` and `http://127.0.0.1:3000`. Include your backend origin too if serving its bundled frontend. For LAN development, add the LAN frontend origin explicitly.

Put the server behind HTTPS (required when connecting from HTTPS GitHub Pages). Example Caddy configuration, which handles certificates and streams SSE automatically:

```caddyfile
cards.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

If using nginx, disable response buffering on `/api/events`, use a read timeout above 30 seconds, and forward requests to Node. Allow access to the public HTTPS port; keep the Node port private behind the proxy. Use systemd or your existing process manager to restart the Node process on failure.

Example systemd unit (adjust user and path):

```ini
[Unit]
Description=RUNO server
After=network.target

[Service]
Type=simple
User=runo
WorkingDirectory=/opt/runo
Environment=PORT=3000
Environment=ALLOWED_ORIGINS=https://you.github.io
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Health endpoint: `GET /api/health`. Gameplay uses authenticated JSON POSTs and Server-Sent Events. The server validates all moves, hides opponents' cards, caps room sizes and message lengths, and applies a basic per-IP request limit. SSE session tokens travel in query parameters: exclude `/api/events` query strings from proxy access logs.

## Rules and operational choices

- Standard 108-card deck; seven cards per player; each round starts on a number card.
- Match color or value. Wild chooses a color. Both Wild and Wild +4 are legal on any color during your turn, even with matching colors in hand.
- No stacking or jump-ins. Drawing one card always ends your turn, even if it is playable.
- Skip / draw cards skip the next turn. Two-player reverse acts as skip. Final action cards still apply.
- Host deals and can remove players. Leaving or removal during play cancels the round and returns everyone to the lobby. Disconnection preserves the seat and turn so a refresh doesn't punish a player; no turn timer or automatic kick.
- Wins are counted per seat, not by card points. No bots, automatic matchmaking, spectators, or persistent accounts.
- State lives in one Node process. A restart clears rooms; completely offline rooms expire after two hours. Use a single instance; persistent storage and shared state would be needed for restart recovery or multiple instances.
- Open rooms with at least one connected player appear in the public lobby list. Anyone can join from the list or by room code while space is available and a round is not in progress.

The visual style uses CSS cards and optional Google Fonts, with local system font fallbacks. Unofficial fan project; no Mattel artwork or logos.
