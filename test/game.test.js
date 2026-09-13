import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, deck, action, snapshot } from '../server/game.js';

let id = 0;
const card = (color, value) => ({ id: String(++id), color, value });
function setup(count = 3) {
  const room = makeRoom('TEST01');
  room.players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, hand: [card('red','1'), card('blue','2')], online: true, uno: false, wins: 0 }));
  room.host = 'p0'; room.phase = 'playing'; room.color = 'red'; room.discard = [card('red','5')];
  room.pile = Array.from({ length: 30 }, () => card('green','3'));
  return room;
}
test('108 unique cards and standard distribution', () => {
  const cards = deck(); assert.equal(cards.length,108); assert.equal(new Set(cards.map(c=>c.id)).size,108);
  assert.equal(cards.filter(c=>c.color === 'red').length,25); assert.equal(cards.filter(c=>c.value === '+4').length,4);
});
test('only host starts, at least two connected players, seven cards each', () => {
  const r = setup(); r.phase = 'lobby';
  assert.throws(()=>action(r,r.players[1],'start'),/host/);
  r.players[1].online = false; assert.throws(()=>action(r,r.players[0],'start'),/reconnect/);
  r.players[1].online = true; action(r,r.players[0],'start');
  assert.ok(r.players.every(p=>p.hand.length === 7)); assert.match(r.discard[0].value,/^\d$/);
  assert.equal(r.pile.length,86);
});
test('enforces turn, ownership, and matches without changing hands', () => {
  const r=setup(), p=r.players[0];
  assert.throws(()=>action(r,r.players[1],'draw'),/turn/);
  assert.throws(()=>action(r,p,'play',{cardId:'missing'}),/hand/);
  assert.throws(()=>action(r,p,'play',{cardId:p.hand[1].id}),/Match/);
  assert.equal(p.hand.length,2); action(r,p,'play',{cardId:p.hand[0].id}); assert.equal(r.turn,1);
});
test('UNO cannot be called before the penultimate card', () => {
  const r=setup(); assert.throws(()=>action(r,r.players[0],'uno'),/one card/);
  action(r,r.players[0],'play',{cardId:r.players[0].hand[0].id}); assert.equal(r.players[0].hand.length,1);
  assert.equal(r.players[0].uno,false); assert.equal(r.phase,'playing');
});
test('forgotten UNO retains final card, draws two, and ends the turn', () => {
  const r=setup(), p=r.players[0]; p.hand=[card('red','3')]; const last=p.hand[0];
  action(r,p,'play',{cardId:last.id}); assert.equal(p.hand.length,3); assert.ok(p.hand.includes(last));
  assert.equal(r.discard.length,1); assert.equal(r.turn,1); assert.equal(r.phase,'playing');
});
test('UNO before final card wins, and finishing draw cards still apply', () => {
  const r=setup(), p=r.players[0]; p.hand=[card('red','+2')];
  action(r,p,'uno'); action(r,p,'play',{cardId:p.hand[0].id});
  assert.equal(r.winner,p.id); assert.equal(r.phase,'finished'); assert.equal(p.wins,1); assert.equal(r.players[1].hand.length,4);
});
test('wild +4 is legal with matching colors in hand and needs a valid color', () => {
  const r=setup(), p=r.players[0], wild=card('wild','+4'); p.hand.push(wild);
  assert.throws(()=>action(r,p,'play',{cardId:wild.id,color:'purple'}),/Choose/);
  action(r,p,'play',{cardId:wild.id,color:'green'}); assert.equal(r.color,'green'); assert.equal(r.players[1].hand.length,6); assert.equal(r.turn,2);
});
test('both wild types remain playable after choosing a color on a wild +4', () => {
  const r=setup(2), p=r.players[0];
  const first=card('wild','+4'), nextWild=card('wild','wild'), nextFour=card('wild','+4');
  p.hand.push(first,nextWild,nextFour);
  action(r,p,'play',{cardId:first.id,color:'red'});
  assert.equal(r.turn,0);
  const available=snapshot(r,p.id).playable;
  assert.ok(available.includes(nextWild.id));
  assert.ok(available.includes(nextFour.id));
  action(r,p,'play',{cardId:nextFour.id,color:'blue'});
  assert.equal(r.color,'blue');
  action(r,p,'play',{cardId:nextWild.id,color:'green'});
  assert.equal(r.color,'green'); assert.equal(r.turn,1);
});
test('drawing a playable card ends the turn and pass is not an action', () => {
  const r=setup(), p=r.players[0]; r.pile.push(card('red','8')); action(r,p,'draw');
  assert.equal(p.hand.length,3); assert.equal(r.turn,1);
  assert.throws(()=>action(r,p,'draw'),/turn/);
  assert.throws(()=>action(r,p,'play',{cardId:p.hand.at(-1).id}),/turn/);
  assert.throws(()=>action(r,r.players[1],'pass'),/Unknown action/);
});
test('unplayable draw passes automatically and resets UNO', () => {
  const r=setup(), p=r.players[0]; p.hand=[card('blue','9')]; action(r,p,'uno'); action(r,p,'draw');
  assert.equal(p.uno,false); assert.equal(r.turn,1);
});
test('reverse changes direction; two-player reverse and skip return to same player', () => {
  for (const count of [2,3]) {
    const r=setup(count), p=r.players[0]; p.hand.push(card('red','reverse'));
    action(r,p,'play',{cardId:p.hand.at(-1).id}); assert.equal(r.direction,-1); assert.equal(r.turn,count===2?0:2);
  }
  const r=setup(2),p=r.players[0];p.hand.push(card('red','skip'));action(r,p,'play',{cardId:p.hand.at(-1).id});assert.equal(r.turn,0);
});
test('discard recycling preserves top card and card identities', () => {
  const r=setup(), p=r.players[0], top=r.discard[0], recycled=card('blue','7');
  r.pile=[]; r.discard.unshift(recycled); action(r,p,'draw');
  assert.deepEqual(r.discard,[top]); assert.ok(p.hand.includes(recycled));
});
test('snapshot exposes only viewer hand, not secrets or deck order', () => {
  const r=setup(); r.players[1].token='secret'; const s=snapshot(r,'p0');
  assert.equal(s.hand,r.players[0].hand); assert.equal(s.players[1].count,2);
  assert.equal(s.players[1].hand,undefined); assert.equal(s.players[1].token,undefined); assert.equal(s.pile,undefined);
  assert.equal(snapshot(r,'p1').playable.length,0);
});
