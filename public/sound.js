// Short synthesized cues; no audio downloads or autoplay on page load.
(() => {
  let context, muted = false;
  try { muted = localStorage.getItem('last-card-muted') === 'true'; } catch {}
  const button = document.createElement('button');
  button.className = 'text-button sound-toggle';
  function update() {
    button.textContent = muted ? 'Sound off' : 'Sound on';
    button.setAttribute('aria-label', muted ? 'Unmute game sounds' : 'Mute game sounds');
    button.setAttribute('aria-pressed', String(!muted));
  }
  function unlock() {
    if (muted) return;
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* Gameplay works in browsers without Web Audio. */ }
  }
  const cues = {
    play: [420, 300], draw: [230, 170], uno: [660, 880],
    turn: [520], win: [523, 659, 784, 1047], deal: [300, 400, 500]
  };
  function play(name, offset = 0) {
    if (muted || !context || context.state !== 'running' || document.hidden) return;
    cues[name].forEach((frequency, index) => {
      const start = context.currentTime + offset + index * .085;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.09, start + .008);
      gain.gain.exponentialRampToValueAtTime(.001, start + .12);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + .13);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }
  button.onclick = () => {
    muted = !muted; update();
    try { localStorage.setItem('last-card-muted', String(muted)); } catch {}
    if (!muted) { unlock(); play('turn'); }
  };
  update(); document.querySelector('.header-right').append(button);
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  window.gameAudio = {
    update(previous, next, playerId) {
      if (!previous) return; // Reconnect snapshots should not replay old moves.
      if (next.phase === 'finished' && previous.phase !== 'finished') return play('win');
      if (next.phase !== 'playing') return;
      if (previous.phase !== 'playing') return play('deal');
      if (next.players.some(p => p.uno && !previous.players.find(old => old.id === p.id)?.uno)) play('uno');
      else if (next.top?.id !== previous.top?.id) play('play');
      else if (next.players.some(p => p.count > (previous.players.find(old => old.id === p.id)?.count ?? p.count))) play('draw');
      if (next.turn === playerId && previous.turn !== playerId) play('turn', .2);
    }
  };
})();
