import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { makeRoom, action, snapshot, note } from './game.js';

const port = Number(process.env.PORT || 3000);
const origins = (process.env.ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}`).split(',').map(s => s.trim());
const rooms = new Map(); const sessions = new Map(); const rates = new Map();
const root = fileURLToPath(new URL('../public/', import.meta.url));
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
function broadcast(room) {
  room.updated = Date.now();
  for (const p of room.players) {
    const session = sessions.get(p.token);
    if (session?.stream) session.stream.write(`data: ${JSON.stringify(snapshot(room, p.id))}\n\n`);
  }
}
function remove(room, player) {
  const i = room.players.indexOf(player);
  const session = sessions.get(player.token);
  if (session?.stream) { session.stream.write('event: removed\ndata: {}\n\n'); session.stream.end(); }
  sessions.delete(player.token); room.players.splice(i, 1);
  if (!room.players.length) { rooms.delete(room.code); return; }
  room.host = room.players.some(p => p.id === room.host) ? room.host : room.players[0].id;
  // Returning to the lobby avoids changing turn order or leaking abandoned hands mid-round.
  if (room.phase === 'playing') { room.phase = 'lobby'; room.winner = null; note(room, 'Round ended because a player left.'); }
  room.turn = 0; note(room, `${player.name} left.`); broadcast(room);
}
async function body(req) {
  let text = '';
  for await (const part of req) { text += part; if (text.length > 4096) throw new Error('Request too large.'); }
  try { return JSON.parse(text || '{}'); } catch { throw new Error('Invalid JSON.'); }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return send(res, 403, { error: 'This frontend origin is not allowed by the server.' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });
    try {
      if (url.pathname === '/api/events' && req.method === 'GET') {
        const session = sessions.get(url.searchParams.get('token'));
        if (!session) return send(res, 401, { error: 'Session expired. Join the room again.' });
        session.stream?.end(); session.stream = res; session.player.online = true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n'); broadcast(session.room);
        req.on('close', () => {
          if (session.stream !== res) return;
          session.stream = null; session.player.online = false; broadcast(session.room);
        }); return;
      }
      if (req.method !== 'POST') return send(res, 404, { error: 'Not found.' });
      const key = req.socket.remoteAddress;
      const now = Date.now(); let rate = rates.get(key);
      if (!rate || now - rate.time > 10000) { rate = { time: now, count: 0 }; rates.set(key, rate); }
      if (++rate.count > 120) return send(res, 429, { error: 'Too many requests. Wait a moment.' });
      const data = await body(req);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid request.');
      if (url.pathname === '/api/create' || url.pathname === '/api/join') {
        const name = typeof data.name === 'string' ? data.name.trim().slice(0, 20) : '';
        if (!name) throw new Error('Enter your name.');
        let room;
        if (url.pathname === '/api/create') {
          if (rooms.size >= 500) throw new Error('Server is full. Try again later.');
          let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          room = makeRoom(code); rooms.set(code, room);
        } else {
          room = rooms.get(String(data.code || '').toUpperCase());
          if (!room) throw new Error('Room not found. Check the code.');
          if (room.phase === 'playing') throw new Error('This round is in progress. Join after it ends.');
          if (room.players.length >= 8) throw new Error('This room is full (8 players).');
        }
        const token = randomBytes(32).toString('hex');
        const player = { id: randomUUID(), token, name, hand: [], online: false, uno: false, wins: 0 };
        room.players.push(player); room.host ||= player.id;
        sessions.set(token, { room, player, stream: null }); note(room, `${name} joined.`); broadcast(room);
        return send(res, 200, { token, playerId: player.id, code: room.code });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const session = sessions.get(token);
      if (!session) return send(res, 401, { error: 'Session expired. Join the room again.' });
      const { room, player } = session;
      if (url.pathname === '/api/leave') remove(room, player);
      else if (url.pathname === '/api/kick') {
        if (room.host !== player.id) throw new Error('Only the host can remove players.');
        const target = room.players.find(p => p.id === data.playerId && p.id !== player.id);
        if (!target) throw new Error('Player not found.');
        remove(room, target);
      } else if (url.pathname === '/api/chat') {
        const text = typeof data.text === 'string' ? data.text.trim().slice(0, 240) : '';
        if (!text) throw new Error('Enter a message.');
        room.chat.push({ id: randomUUID(), name: player.name, text }); room.chat = room.chat.slice(-50); broadcast(room);
      } else if (url.pathname === '/api/action') { action(room, player, data.type, data); broadcast(room); }
      else return send(res, 404, { error: 'Not found.' });
      send(res, 200, { ok: true });
    } catch (error) { if (!res.headersSent) send(res, 400, { error: error.message }); }
    return;
  }
  const files = { '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/sound.js': ['sound.js','text/javascript'], '/style.css': ['style.css','text/css'], '/config.js': ['config.js','text/javascript'] };
  const entry = files[url.pathname];
  if (!entry || !['GET','HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  try { const file = await readFile(root + entry[0]); res.writeHead(200, { 'Content-Type': entry[1] }); res.end(req.method === 'HEAD' ? undefined : file); }
  catch { res.writeHead(500); res.end('Could not load frontend'); }
});
setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) session.stream?.write(': heartbeat\n\n');
  for (const room of rooms.values()) if (now - room.updated > 2 * 60 * 60 * 1000 && !room.players.some(p => p.online)) {
    for (const p of room.players) sessions.delete(p.token); rooms.delete(room.code);
  }
  for (const [key, rate] of rates) if (now - rate.time > 60000) rates.delete(key);
}, 15000).unref();
server.listen(port, '0.0.0.0', () => console.log(`RUNO listening on http://localhost:${server.address().port}`));
