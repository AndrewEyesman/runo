const $ = id => document.getElementById(id);
const API = (window.GAME_SERVER || location.origin).replace(/\/$/, '');
let session, state, stream, pending = false, chosenCard, toastTimer;
try { session = JSON.parse(localStorage.getItem('last-card-session')); $('name').value = localStorage.getItem('last-card-name') || ''; } catch {}
const inviteCode = new URL(location.href).searchParams.get('room');
if (inviteCode) $('code').value = inviteCode.toUpperCase();
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function saveSession() { try { if (session) localStorage.setItem('last-card-session', JSON.stringify(session)); else localStorage.removeItem('last-card-session'); } catch {} }
async function request(path, data = {}) {
  const response = await fetch(`${API}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) reset(); throw new Error(result.error || 'Something went wrong.'); }
  return result;
}
async function run(work) {
  if (pending) return; pending = true;
  if (state) render(); else { $('create').disabled = true; $('join').disabled = true; }
  try { await work(); } catch (error) { toast(error.name === 'TimeoutError' || error instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : error.message); }
  finally { pending = false; if (state) render(); $('create').disabled = false; $('join').disabled = false; }
}
function reset() {
  document.body.classList.remove('in-room');
  document.getElementById('table-panel')?.close();
  stream?.close(); stream = null; session = null; state = null; saveSession();
  $('room').hidden = true; $('home').hidden = false; $('connection').hidden = true; $('color-picker').close();
}
function connect() {
  document.body.classList.add('in-room');
  stream?.close(); $('home').hidden = true; $('room').hidden = false; $('connection').hidden = false; $('connection').textContent = 'Connecting…';
  stream = new EventSource(`${API}/api/events?token=${encodeURIComponent(session.token)}`);
  let firstSnapshot = true;
  stream.onmessage = event => {
    const next = JSON.parse(event.data);
    window.gameAudio?.update(firstSnapshot ? null : state, next, session.playerId);
    firstSnapshot = false; state = next;
    $('connection').textContent = '● Connected'; render();
  };
  stream.addEventListener('removed', () => { reset(); toast('You have left the room.'); });
  stream.onerror = () => {
    $('connection').textContent = 'Reconnecting…';
    // EventSource hides HTTP status. Probe the authenticated endpoint to detect expired sessions.
    fetch(`${API}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.token}` }, body: '{}', signal: AbortSignal.timeout(5000) }).then(r => { if (r.status === 401) { reset(); toast('Your session expired. Please join again.'); } }).catch(() => {});
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
    node.classList.toggle('unplayable', state.turn === session.playerId && !state.playable.includes(card.id));
    node.disabled = pending || stream?.readyState !== EventSource.OPEN || !state.playable.includes(card.id);
    node.onclick = () => { if (card.color === 'wild') { chosenCard = card.id; $('color-picker').showModal(); } else act('play', { cardId: card.id }); };
  }
  return node;
}
let chatSignature = '';
const table = document.querySelector('.table');
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
  const blocked = pending || stream?.readyState !== EventSource.OPEN;
  table.classList.toggle('in-play', playing);
  $('room').classList.toggle('playing', playing);
  if (playing) sidePanel.querySelector('.aside-heading').after($('players'));
  else table.before($('players'));
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
  $('lobby').hidden = playing; $('board').hidden = !playing; $('hand-area').hidden = !playing;
  if (!playing) {
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
if (session?.token) connect();
