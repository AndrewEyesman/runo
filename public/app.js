const $ = id => document.getElementById(id);
const API = (window.GAME_SERVER || location.origin).replace(/\/$/, '');
let session, state, stream, pending = false, chosenCard, toastTimer, sessionExpired = false;
try { session = JSON.parse(localStorage.getItem('last-card-session')); $('name').value = localStorage.getItem('last-card-name') || ''; } catch {}
const inviteCode = new URL(location.href).searchParams.get('room');
if (inviteCode) $('code').value = inviteCode.toUpperCase();
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function saveSession() { try { if (session) localStorage.setItem('last-card-session', JSON.stringify(session)); else localStorage.removeItem('last-card-session'); } catch {} }
async function request(path, data = {}) {
  const response = await fetch(`${API}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) expireSession(); throw new Error(result.error || 'Something went wrong.'); }
  return result;
}
async function run(work) {
  if (pending) return; pending = true;
  if (state) render(); else { $('create').disabled = true; $('join').disabled = true; }
  try { await work(); } catch (error) { toast(error.name === 'TimeoutError' || error instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : error.message); }
  finally { pending = false; if (state) render(); $('create').disabled = false; $('join').disabled = false; }
}
function reset() {
  sessionExpired = false;
  document.body.classList.remove('in-room');
  document.getElementById('table-panel')?.close();
  stream?.close(); stream = null; session = null; state = null; saveSession();
  $('room').hidden = true; $('home').hidden = false; $('connection').hidden = true; $('color-picker').close();
  refreshLobbies();
}
function expireSession() {
  if (state?.phase !== 'finished') { reset(); return; }
  // Preserve the result if a deployment or server restart invalidates the room.
  sessionExpired = true; stream?.close(); stream = null;
  try { localStorage.removeItem('last-card-session'); } catch {}
  $('connection').textContent = 'Room disconnected'; render();
}
function connect() {
  sessionExpired = false;
  document.body.classList.add('in-room');
  stream?.close(); $('home').hidden = true; $('room').hidden = false; $('connection').hidden = false; $('connection').textContent = 'Connecting…';
  stream = new EventSource(`${API}/api/events?token=${encodeURIComponent(session.token)}`);
  const connection = stream;
  let firstSnapshot = true;
  stream.onmessage = event => {
    if (connection !== stream || !session) return;
    const next = JSON.parse(event.data);
    window.gameAudio?.update(firstSnapshot ? null : state, next, session.playerId);
    firstSnapshot = false; state = next;
    $('connection').textContent = '● Connected'; render();
  };
  stream.addEventListener('removed', () => { if (connection === stream) { reset(); toast('You have left the room.'); } });
  stream.onerror = () => {
    if (connection !== stream || !session) return;
    $('connection').textContent = 'Reconnecting…';
    // EventSource hides HTTP status. Probe the authenticated endpoint to detect expired sessions.
    fetch(`${API}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: '{}', signal: AbortSignal.timeout(5000) }).then(r => { if (connection === stream && r.status === 401) { expireSession(); toast('The server no longer has this room.'); } }).catch(() => {});
    if (state) render();
  };
  stream.onopen = () => { $('connection').textContent = '● Connected'; if (state) render(); };
}
function join(create) {
  if (!$('entry').reportValidity()) return;
  const name = $('name').value.trim(); const code = $('code').value.trim().toUpperCase();
  if (!create && !/^[A-F0-9]{6}$/.test(code)) return toast('Enter a six-character room code.');
  run(async () => {
    session = await request(create ? 'create' : 'join', { name, code }); saveSession();
    try { localStorage.setItem('last-card-name', name); } catch {}
    connect();
  });
}
$('entry').onsubmit = e => { e.preventDefault(); join(!($('code').value.trim())); };
$('create').onclick = e => { e.preventDefault(); join(true); };
$('join').onclick = () => join(false);
$('rules-open').onclick = () => $('rules').showModal();
$('rules').querySelector('.close').onclick = () => $('rules').close();
$('color-picker').querySelector('.close-color').onclick = () => $('color-picker').close();
$('leave').onclick = () => { if (!confirm(state?.phase === 'playing' ? 'Leave the table? This will end the current round for everyone.' : 'Leave this table?')) return; run(async () => { await request('leave'); reset(); }); };
$('invite').onclick = async () => {
  const code = session.code;
  try { await navigator.clipboard.writeText(code); toast('Room code copied.'); } catch { prompt('Copy this room code:', code); }
};
const act = (type, data = {}) => run(() => request('action', { type, ...data }));
$('start').onclick = () => act('start'); $('draw').onclick = () => act('draw'); $('uno').onclick = () => act('uno');
$('chat-form').onsubmit = e => { e.preventDefault(); const text = $('chat-input').value.trim(); if (text) run(async () => { await request('chat', { text }); $('chat-input').value = ''; }); };
for (const button of document.querySelectorAll('[data-color]')) button.onclick = () => { $('color-picker').close(); act('play', { cardId: chosenCard, color: button.dataset.color }); };
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
const symbols = { skip: '⊘', reverse: '↺', wild: '✳' };
function cardNode(card, interactive = false) {
  const node = el(interactive ? 'button' : 'div', `card ${card.color}`, symbols[card.value] || card.value);
  node.setAttribute('aria-label', `${card.color} ${card.value}`);
  node.append(el('span','card-corner', symbols[card.value] || card.value),el('span','card-corner bottom', symbols[card.value] || card.value));
  if (interactive) {
    node.disabled = pending || stream?.readyState !== EventSource.OPEN || !state.playable.includes(card.id);
    node.onclick = () => { if (card.color === 'wild') { chosenCard = card.id; $('color-picker').showModal(); } else act('play', { cardId: card.id }); };
  }
  return node;
}
let chatSignature = '';
const table = document.querySelector('.table');
const results = el('section', 'results');
results.id = 'results'; results.hidden = true;
results.setAttribute('aria-live', 'polite');
const resultTitle = el('h1', 'result-title');
const resultMessage = el('p', 'result-message');
const standings = el('div', 'standings');
const replay = el('button', 'primary', 'Play again');
replay.id = 'replay';
const replayStatus = el('p', 'replay-status');
replay.onclick = () => {
  if (!sessionExpired) { act('start'); return; }
  const name = state.players.find(p => p.id === session.playerId)?.name || 'Player';
  run(async () => { session = await request('create', { name }); state = null; saveSession(); connect(); });
};
results.append(resultTitle, resultMessage, standings, replay, replayStatus);
table.append(results);
const opponents = el('div', 'opponents');
table.append(opponents, $('hand-area'));
const sidePanel = document.querySelector('aside');
const tablePanel = el('dialog', 'table-panel');
tablePanel.id = 'table-panel';
tablePanel.setAttribute('aria-label', 'Players and table talk');
const panelClose = el('button', 'close', '×');
panelClose.setAttribute('aria-label', 'Close table panel');
panelClose.onclick = () => tablePanel.close();
tablePanel.append(panelClose, sidePanel);
document.body.append(tablePanel);
const panelToggle = el('button', 'text-button', 'Chat & players');
panelToggle.setAttribute('aria-haspopup', 'dialog');
panelToggle.onclick = () => tablePanel.showModal();
const roomNavigation = el('div', 'room-navigation');
roomNavigation.append(panelToggle, $('leave'));
document.querySelector('.header-right').append(roomNavigation);
sidePanel.querySelector('.aside-heading').after($('players'));
const lobbySeats = el('section', 'lobby-seats');
lobbySeats.setAttribute('aria-label', 'Players in the room');
const seatHeading = el('div', 'seat-heading');
const seatCount = el('span', 'seat-count');
seatHeading.append(el('h2', '', 'At the table'), seatCount);
lobbySeats.append(seatHeading);
document.querySelector('.play-area').append(lobbySeats);
function renderOpponents(me) {
  const mine = state.players.findIndex(p => p.id === me.id);
  // Rotate the seating order so every viewer sits at the bottom.
  const others = [...state.players.slice(mine + 1), ...state.players.slice(0, mine)];
  const lanes = ['left', 'top', 'right'].map(side => el('div', `seats seats-${side}`));
  others.forEach((player, index) => {
    const lane = others.length === 1 ? 1 : others.length === 2 ? index * 2 : Math.floor(index * 3 / others.length);
    const seat = el('section', `opponent${player.id === state.turn ? ' active' : ''}${player.online ? '' : ' offline'}`);
    seat.dataset.playerId = player.id;
    const label = el('div', 'opponent-label');
    label.append(el('span', 'player-name', player.name));
    const status = [player.uno ? 'UNO!' : '', player.online ? '' : 'Offline'].filter(Boolean).join(' · ');
    if (status) label.append(el('span', 'opponent-count', status));
    const backs = el('div', 'opponent-hand');
    backs.setAttribute('role', 'img');
    backs.setAttribute('aria-label', `${player.name}: ${player.count} face-down cards`);
    backs.style.setProperty('--cards', Math.max(1, player.count));
    for (let i = 0; i < player.count; i++) {
      const back = el('div', 'card card-back opponent-card', '✳');
      back.setAttribute('aria-hidden', 'true');
      backs.append(back);
    }
    seat.append(label, backs); lanes[lane].append(seat);
  });
  opponents.replaceChildren(...lanes);
}
function render() {
  if (!state || !session) return;
  const me = state.players.find(p => p.id === session.playerId); if (!me) return;
  const turn = state.players.find(p => p.id === state.turn);
  const playing = state.phase === 'playing'; const myTurn = playing && state.turn === me.id;
  const finished = state.phase === 'finished';
  const blocked = pending || stream?.readyState !== EventSource.OPEN;
  table.classList.toggle('in-play', playing);
  table.classList.toggle('round-finished', finished);
  $('room').classList.toggle('playing', playing || finished);
  if (playing || finished) sidePanel.querySelector('.aside-heading').after($('players'));
  else lobbySeats.append($('players'));
  lobbySeats.hidden = playing || finished;
  seatCount.textContent = `${state.players.length} / 4`;
  opponents.hidden = !playing;
  if (playing) renderOpponents(me);
  $('invite').textContent = `${state.code} ⧉`; $('round-status').textContent = playing ? 'In play' : state.phase === 'finished' ? 'Round complete' : 'Waiting room';
  $('players').replaceChildren(...state.players.map(p => {
    const node = el('div', `player${playing && p.id === state.turn ? ' active' : ''}${!p.online ? ' offline' : ''}`);
    node.append(el('span','player-name', `${p.name}${p.id === me.id ? ' (you)' : ''}`));
    node.append(el('span','player-meta', `${!p.online ? 'Offline · ' : ''}${playing ? `${p.count} card${p.count === 1 ? '' : 's'}` : p.id === state.host ? 'Host' : 'Ready'}${p.uno ? ' · UNO!' : ''}${p.wins ? ` · ${p.wins}★` : ''}`));
    if (state.host === me.id && p.id !== me.id) { const kick = el('button','kick','×'); kick.setAttribute('aria-label', `Remove ${p.name}`); kick.onclick = () => { if (confirm(`Remove ${p.name}?${playing ? ' This ends the current round.' : ''}`)) run(() => request('kick', { playerId: p.id })); }; node.append(kick); }
    return node;
  }));
  if (!playing && !finished) {
    for (let seat = state.players.length; seat < 4; seat++) {
      const empty = el('div', 'player empty-seat');
      empty.append(el('span', 'player-name', 'Open seat'), el('span', 'player-meta', 'Waiting for a friend'));
      $('players').append(empty);
    }
  }
  $('lobby').hidden = playing || finished; $('board').hidden = !playing; $('hand-area').hidden = !playing;
  results.hidden = !finished;
  if (finished) {
    $('color-picker').close();
    const winner = state.players.find(p => p.id === state.winner);
    const won = state.winner === me.id;
    results.classList.toggle('victory', won);
    resultTitle.textContent = won ? 'Victory!' : 'Defeat';
    resultMessage.textContent = won ? 'You played your last card.' : `${winner?.name || 'Your opponent'} won the round.`;
    standings.replaceChildren(...[...state.players].sort((a, b) => (b.id === state.winner) - (a.id === state.winner) || a.count - b.count).map(p => {
      const row = el('div', 'standing');
      row.append(el('span', '', `${p.name}${p.id === me.id ? ' (you)' : ''}`), el('span', '', p.id === state.winner ? 'Winner' : `${p.count} cards left`), el('span', '', `${p.wins} win${p.wins === 1 ? '' : 's'}`));
      return row;
    }));
    replay.hidden = !sessionExpired && state.host !== me.id;
    replay.disabled = pending || (!sessionExpired && (blocked || state.players.length < 2 || state.players.some(p => !p.online)));
    replay.textContent = sessionExpired ? 'Create a new room' : 'Play again';
    replayStatus.textContent = sessionExpired ? 'The server restarted or this room expired. Create a new room to continue.' : state.players.length < 2 ? 'Invite another player to play again.' : state.players.some(p => !p.online) ? 'Waiting for players to reconnect. The host can remove them in Chat & players.' : state.host !== me.id ? 'Waiting for the host to start the next round.' : 'Same room. Same players.';
  } else if (!playing) {
    const winner = state.players.find(p => p.id === state.winner);
    $('lobby-title').textContent = state.phase === 'finished' ? `${winner?.name || 'Someone'} wins.` : 'The table is yours.';
    $('lobby-text').textContent = state.players.length < 2 ? 'Copy the room code above and invite a friend.' : state.host === me.id ? `${state.players.length} players at the table. Deal when everyone is here.` : 'Waiting for the host to deal.';
    $('start').hidden = state.host !== me.id;
    $('start').disabled = blocked || state.players.length < 2 || state.players.some(p => !p.online);
    $('start').textContent = state.phase === 'finished' ? 'Play again →' : 'Deal the cards →';
  } else {
    $('turn-label').textContent = myTurn ? 'Your move.' : `${turn?.name}’s turn${turn?.online ? '' : ' · reconnecting'}`;
    $('discard').replaceChildren(cardNode(state.top));
    $('draw').disabled = blocked || !myTurn;
    $('active-color').replaceChildren(el('span', `color-dot ${state.color}`),document.createTextNode(state.color[0].toUpperCase() + state.color.slice(1)));
    $('direction').textContent = state.direction === 1 ? '↻ Clockwise' : '↺ Counterclockwise';
    $('uno').disabled = blocked || !myTurn || state.hand.length !== 1 || me.uno;
    $('uno').hidden = !myTurn || state.hand.length !== 1 || me.uno;
    $('uno').textContent = me.uno ? 'UNO ✓' : 'UNO!'; $('uno').classList.toggle('called', me.uno);
    const scroll = $('hand').scrollLeft; $('hand').replaceChildren(...state.hand.map(c => cardNode(c,true))); $('hand').scrollLeft = scroll;
  }
  $('log').replaceChildren(...state.log.map(text => el('li','',text)));
  const signature = JSON.stringify(state.chat);
  if (signature !== chatSignature) {
    chatSignature = signature;
    $('messages').replaceChildren(...state.chat.map(m => { const node = el('div','message'); node.append(el('b','',m.name),document.createTextNode(m.text)); return node; }));
    $('messages').scrollTop = $('messages').scrollHeight;
  }
  $('chat-form').querySelector('button').disabled = blocked;
}
const lobbyBrowser = el('section', 'lobby-browser');
const lobbyHeading = el('div', 'lobby-browser-heading');
const refreshButton = el('button', 'text-button', 'Refresh');
refreshButton.type = 'button';
const lobbyList = el('div', 'lobby-list');
lobbyList.id = 'lobby-list';
const lobbyStatus = el('p', 'lobby-status', 'Loading rooms…');
lobbyStatus.setAttribute('role', 'status');
lobbyHeading.append(el('h2', '', 'Active lobbies'), refreshButton);
lobbyBrowser.append(lobbyHeading, lobbyList, lobbyStatus);
$('entry').append(lobbyBrowser);
let loadingLobbies = false;
async function refreshLobbies() {
  if (loadingLobbies || $('home').hidden || document.hidden) return;
  loadingLobbies = true; refreshButton.disabled = true;
  try {
    const response = await fetch(`${API}/api/lobbies`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Could not load rooms.');
    const { lobbies } = await response.json();
    lobbyList.replaceChildren(...lobbies.map(lobby => {
      const row = el('div', 'lobby-row');
      const info = el('div', 'lobby-info');
      info.append(el('strong', '', `${lobby.host}’s room`), el('span', '', `${lobby.players}/${lobby.capacity} players`));
      const button = el('button', '', 'Join'); button.type = 'button';
      button.setAttribute('aria-label', `Join ${lobby.host}'s room`);
      button.onclick = () => { $('code').value = lobby.code; join(false); };
      row.append(info, button); return row;
    }));
    lobbyStatus.textContent = lobbies.length ? '' : 'No open rooms. Create one to get started.';
  } catch {
    lobbyList.replaceChildren();
    lobbyStatus.textContent = 'Could not load rooms. Try refreshing.';
  } finally { loadingLobbies = false; refreshButton.disabled = false; }
}
refreshButton.onclick = refreshLobbies;
setInterval(refreshLobbies, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLobbies(); });
if (session?.token) connect();
else refreshLobbies();
