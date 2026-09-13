import { randomInt, randomUUID } from 'node:crypto';

export const COLORS = ['red', 'yellow', 'green', 'blue'];
const fail = message => { throw new Error(message); };
export function deck() {
  const cards = [];
  const add = (color, value) => cards.push({ id: randomUUID(), color, value });
  for (const color of COLORS) {
    add(color, '0');
    for (const value of ['1','2','3','4','5','6','7','8','9','skip','reverse','+2']) {
      add(color, value); add(color, value);
    }
  }
  for (let i = 0; i < 4; i++) { add('wild', 'wild'); add('wild', '+4'); }
  return shuffle(cards);
}
function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function makeRoom(code) {
  return { code, players: [], host: null, phase: 'lobby', pile: [], discard: [], turn: 0,
    direction: 1, color: null, winner: null, chat: [], log: [], updated: Date.now() };
}
export function note(room, text) { room.log.push(text); room.log = room.log.slice(-6); }
export function start(room, player) {
  if (room.host !== player.id) fail('Only the host can deal.');
  if (room.phase === 'playing') fail('A round is already in progress.');
  if (room.players.length < 2) fail('You need at least two players.');
  if (room.players.some(p => !p.online)) fail('Wait for everyone to reconnect, or remove them.');
  room.pile = deck(); room.discard = []; room.turn = 0; room.direction = 1;
  room.winner = null; room.log = []; room.phase = 'playing';
  for (const p of room.players) { p.hand = room.pile.splice(0, 7); p.uno = false; }
  const index = room.pile.findIndex(c => /^\d$/.test(c.value));
  room.discard.push(room.pile.splice(index, 1)[0]); room.color = room.discard[0].color;
  note(room, `${player.name} dealt a new round.`);
}
function take(room, player, count) {
  player.uno = false;
  const added = [];
  for (let i = 0; i < count; i++) {
    if (!room.pile.length && room.discard.length > 1) {
      const top = room.discard.pop(); room.pile = shuffle(room.discard); room.discard = [top];
    }
    if (room.pile.length) { const card = room.pile.pop(); player.hand.push(card); added.push(card); }
  }
  return added;
}
function advance(room, steps = 1) {
  room.turn = (room.turn + room.direction * steps + room.players.length * 3) % room.players.length;
}
export function playable(room, player, card) {
  return card.color === 'wild' || card.color === room.color || card.value === room.discard.at(-1)?.value;
}
export function action(room, player, type, data = {}) {
  if (type === 'start') return start(room, player);
  if (room.phase !== 'playing') fail('There is no active round.');
  if (room.players[room.turn]?.id !== player.id) fail('Wait for your turn.');
  if (type === 'uno') {
    if (player.hand.length !== 1) fail('Call UNO when you have one card, before playing it.');
    if (!player.uno) { player.uno = true; note(room, `${player.name} called UNO!`); }
    return;
  }
  if (type === 'draw') {
    take(room, player, 1);
    note(room, `${player.name} drew a card.`);
    advance(room);
    return;
  }
  if (type !== 'play') fail('Unknown action.');
  const card = player.hand.find(c => c.id === data.cardId);
  if (!card) fail('That card is not in your hand.');
  if (!playable(room, player, card)) fail('Match the color or symbol, or play a Wild.');
  if (card.color === 'wild' && !COLORS.includes(data.color)) fail('Choose a color.');
  if (player.hand.length === 1 && !player.uno) {
    take(room, player, 2); note(room, `${player.name} forgot UNO. Two-card penalty!`); advance(room); return;
  }
  player.hand = player.hand.filter(c => c.id !== card.id); player.uno = false;
  room.discard.push(card); room.color = card.color === 'wild' ? data.color : card.color;
  note(room, `${player.name} played ${card.color === 'wild' ? '' : card.color + ' '}${card.value}${card.color === 'wild' ? ` → ${data.color}` : ''}.`);
  let steps = 1;
  if (card.value === 'reverse') { room.direction *= -1; if (room.players.length === 2) steps = 2; }
  if (card.value === 'skip') steps = 2;
  if (card.value === '+2' || card.value === '+4') {
    const next = (room.turn + room.direction + room.players.length) % room.players.length;
    take(room, room.players[next], card.value === '+2' ? 2 : 4); steps = 2;
  }
  if (!player.hand.length) {
    room.phase = 'finished'; room.winner = player.id; player.wins++;
    note(room, `${player.name} won the round!`);
  }
  advance(room, steps);
}
export function snapshot(room, viewer) {
  const me = room.players.find(p => p.id === viewer);
  return { code: room.code, phase: room.phase, host: room.host, turn: room.players[room.turn]?.id,
    direction: room.direction, color: room.color, top: room.discard.at(-1), winner: room.winner,
    players: room.players.map(({ id, name, hand, online, uno, wins }) => ({ id, name, count: hand.length, online, uno, wins })),
    hand: me?.hand ?? [], playable: room.phase === 'playing' && room.players[room.turn]?.id === viewer
      ? me.hand.filter(c => playable(room, me, c)).map(c => c.id) : [],
    chat: room.chat, log: room.log };
}
