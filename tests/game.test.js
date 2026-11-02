'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalize, normalizeGuess, maskAnswer, sanitizeStroke, Phase,
} = require('../src/gartic-game');
const { RoomManager, ROOM_LIMITS, parseRoomId, buildTutorial } = require('../src/gartic-room');

function makeRng(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeManager(overrides = {}) {
  const events = [];
  let now = 1_000_000;
  const manager = new RoomManager({
    words: overrides.words || ['con mèo', 'mặt trời', 'xe đạp', 'quả táo', 'cái ghế'],
    emit: (roomId, event, payload, to) => events.push({ roomId, event, payload, to }),
    rng: overrides.rng || makeRng(),
    clock: () => now,
    engineConfig: {
      drawTime: 60,
      finalGuessTime: 60,
      turnEndTime: 5,
      hintInterval: 20,
      wrongGuessDelay: 10,
      ...(overrides.engineConfig || {}),
    },
    ...(overrides.manager || {}),
  });
  return {
    manager,
    events,
    setNow: (v) => { now = v; },
    advance: (ms) => { now += ms; },
    now: () => now,
  };
}

function addPlayers(ctx, count, settings = { drawMinutes: 1, maxPlayers: 10 }) {
  const created = ctx.manager.createRoom('s1', 'Alice', settings);
  assert.equal(created.ok, true, created.error);
  const roomId = created.room.id;
  const ids = [created.playerId];
  for (let i = 2; i <= count; i += 1) {
    const joined = ctx.manager.joinRoom(roomId, `s${i}`, `Player${i}`);
    assert.equal(joined.ok, true, joined.error);
    ids.push(joined.playerId);
  }
  return { roomId, ids };
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------
test('normalize ignores accents and letter case', () => {
  assert.equal(normalize('  CON MÈO!  '), 'con meo');
  assert.equal(normalize('ĐỒNG HỒ'), 'dong ho');
});

test('maskAnswer hides the secret word inside chat, including longer sentences', () => {
  assert.equal(maskAnswer('con mèo', 'con mèo'), '*******');
  assert.equal(maskAnswer('CON MEO', 'con mèo'), '*******');
  assert.equal(maskAnswer('từ khóa là con mèo', 'con mèo'), 'từ khóa là *******');
  assert.equal(maskAnswer('hello cả nhà', 'con mèo'), 'hello cả nhà');
});

test('sanitizeStroke accepts normalized points and rejects invalid points', () => {
  const valid = sanitizeStroke({
    id: 'stroke-1', tool: 'brush', color: '#aabbcc', size: 0.01,
    points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  assert.equal(valid.id, 'stroke-1');
  assert.equal(valid.points.length, 2);
  assert.equal(sanitizeStroke({ tool: 'brush', color: '#fff', size: 1, points: [{ x: 2, y: 0 }] }), null);
});

// ---------------------------------------------------------------------------
// Phòng / ID / tên / host
// ---------------------------------------------------------------------------
test('room IDs are six digits and /join links only accept six digits', () => {
  assert.equal(ROOM_LIMITS.ID_LENGTH, 6);
  assert.equal(parseRoomId('123456'), '123456');
  assert.equal(parseRoomId('/join/123456'), '123456');
  assert.equal(parseRoomId('12345'), null);
  assert.equal(parseRoomId('1234567'), null);
  assert.equal(parseRoomId('abcdef'), null);

  const ctx = makeManager();
  const created = ctx.manager.createRoom('s1', 'Alice', { drawMinutes: 1, maxPlayers: 6 });
  assert.equal(created.ok, true);
  assert.equal(created.room.id.length, 6);
});

test('room requires 3 to 10 players and rejects duplicate names', () => {
  const ctx = makeManager();
  const created = ctx.manager.createRoom('s1', 'Alice', { drawMinutes: 1, maxPlayers: 3 });
  const roomId = created.room.id;

  assert.equal(ctx.manager.startGame(created.playerId).error, 'NOT_ENOUGH_PLAYERS');
  assert.equal(ctx.manager.joinRoom(roomId, 's2', 'Bob').ok, true);
  assert.equal(ctx.manager.startGame(created.playerId).error, 'NOT_ENOUGH_PLAYERS');
  assert.equal(ctx.manager.joinRoom(roomId, 's3', 'Charlie').ok, true);
  assert.equal(ctx.manager.startGame(created.playerId).ok, true);

  // Tên trùng trong cùng phòng / toàn hệ thống đều bị chặn.
  const ctx2 = makeManager();
  const a = ctx2.manager.createRoom('x1', 'Alice', { drawMinutes: 1, maxPlayers: 10 });
  assert.equal(ctx2.manager.createRoom('x2', 'Alice', { drawMinutes: 1, maxPlayers: 10 }).error, 'NAME_TAKEN');
  assert.equal(ctx2.manager.joinRoom(a.room.id, 'x3', 'alice').error, 'NAME_TAKEN');
});

test('a disconnected player frees their name; the newcomer takes it over and the old label is renamed', () => {
  const ctx = makeManager();
  const r1 = ctx.manager.createRoom('s1', 'Alice', { drawMinutes: 1, maxPlayers: 6 });
  assert.equal(ctx.manager.joinRoom(r1.room.id, 's2', 'Bob').ok, true);

  // Alice mất kết nối nhưng còn trong thời gian giữ chỗ (chưa rời hẳn).
  ctx.manager.handleDisconnect('s1');

  // Người mới vẫn tạo được phòng với cùng tên — người cũ tự đổi nhãn "Alice #2".
  const r2 = ctx.manager.createRoom('s3', 'alice', { drawMinutes: 1, maxPlayers: 6 });
  assert.equal(r2.ok, true);
  const r1game = ctx.manager.rooms.get(r1.room.id).game;
  assert.equal(r1game.players.get(r1.playerId).name, 'Alice #2');
  assert.ok(ctx.events.some(e => e.event === 'player_renamed' && e.payload.oldName === 'Alice'));

  // Tên của người ĐANG kết nối vẫn bị khoá như luật.
  assert.equal(ctx.manager.createRoom('s4', 'Alice').error, 'NAME_TAKEN');
});

test('maximum 10 players is enforced', () => {
  const ctx = makeManager();
  const created = ctx.manager.createRoom('s1', 'Alice', { drawMinutes: 1, maxPlayers: 10 });
  const roomId = created.room.id;
  for (let i = 2; i <= 10; i += 1) {
    assert.equal(ctx.manager.joinRoom(roomId, `s${i}`, `Player${i}`).ok, true);
  }
  assert.equal(ctx.manager.joinRoom(roomId, 's11', 'Player11').error, 'ROOM_FULL');
});

test('host departure transfers host randomly and closes empty rooms', () => {
  const ctx = makeManager();
  const created = ctx.manager.createRoom('s1', 'Alice', { drawMinutes: 1, maxPlayers: 6 });
  const roomId = created.room.id;
  ctx.manager.joinRoom(roomId, 's2', 'Bob');
  ctx.manager.joinRoom(roomId, 's3', 'Charlie');

  ctx.manager.leaveRoom(created.playerId);
  const room = ctx.manager.rooms.get(roomId);
  assert.ok(room);
  assert.notEqual(room.hostId, created.playerId);
  assert.equal(room.game.publicPlayers().find(p => p.id === room.hostId).isHost, true);

  // Rời lần lượt tới khi hết phòng.
  for (const p of [...room.game.players.keys()]) ctx.manager.leaveRoom(p);
  assert.equal(ctx.manager.rooms.has(roomId), false);
});

test('tutorial reflects new room and timing rules', () => {
  const text = buildTutorial().join(' ');
  assert.match(text, /3 người/);
  assert.match(text, /10 người/);
  assert.match(text, /1–6 phút/);
});

// ---------------------------------------------------------------------------
// Vẽ trực tiếp + undo/redo
// ---------------------------------------------------------------------------
test('live strokes sync while drawing and undo/redo work', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 3);
  assert.equal(ctx.manager.startGame(ids[0]).ok, true);
  const game = ctx.manager.rooms.get(roomId).game;
  const drawer = game.turn.drawerId;
  const guesser = ids.find(id => id !== drawer);

  const start = { id: 's-live', tool: 'brush', color: '#112233', size: 0.01, points: [{ x: 0.1, y: 0.1 }] };
  assert.equal(ctx.manager.beginStroke(drawer, start), true);
  assert.equal(ctx.manager.beginStroke(guesser, start), false);
  assert.equal(ctx.manager.appendStrokePoints(drawer, 's-live', [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }]), true);
  assert.ok(ctx.events.some(e => e.event === 'draw:start'));
  assert.ok(ctx.events.some(e => e.event === 'draw:points'));

  assert.equal(ctx.manager.endStroke(drawer, 's-live'), true);
  assert.equal(game.turn.strokes.length, 1);

  assert.equal(ctx.manager.undoStroke(drawer), true);
  assert.equal(game.turn.strokes.length, 0);
  assert.equal(game.turn.undone.length, 1);
  assert.ok(ctx.events.some(e => e.event === 'draw:undo'));

  assert.equal(ctx.manager.redoStroke(drawer), true);
  assert.equal(game.turn.strokes.length, 1);
  assert.ok(ctx.events.some(e => e.event === 'draw:redo'));
});

// ---------------------------------------------------------------------------
// Tính điểm
// ---------------------------------------------------------------------------
test('guess points use remaining time and drawer points use solve ratio', () => {
  const ctx = makeManager({ words: ['con mèo'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  assert.equal(ctx.manager.startGame(ids[0]).ok, true);
  const game = ctx.manager.rooms.get(roomId).game;
  const drawer = game.turn.drawerId;
  const guessers = ids.filter(id => id !== drawer);

  // T = 60s vẽ + 60s bonus = 120s, G = 2 người đoán.
  assert.equal(game.turn.totalGuessers, 2);
  assert.equal(game.turnLengthMs(), 120_000);

  ctx.advance(5_000); // t = 5s, hạng nhất → 10 × (1 − 5/120) × 1
  const g1 = ctx.manager.submitGuess(guessers[0], 'con mèo');
  assert.equal(g1.correct, true);
  assert.equal(g1.points, 9.58);

  ctx.advance(10_000); // t = 15s, hạng nhì → 10 × (1 − 15/120) × (1 − 0.2)
  const g2 = ctx.manager.submitGuess(guessers[1], 'CON MÈO');
  assert.equal(g2.correct, true);
  assert.equal(g2.points, 7);

  // Người vẽ: (10/2) × [(1 − 5/120) + (1 − 15/120)] = 9.17
  assert.equal(game.phase, Phase.TURN_END);
  assert.equal(game.players.get(drawer).score, 9.17);
  assert.equal(game.players.get(guessers[0]).score, 9.58);
  assert.equal(game.players.get(guessers[1]).score, 7);
});

test('a correct guess during the bonus phase still scores (T covers the whole turn)', () => {
  const ctx = makeManager({ words: ['con mèo'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const guesser = ids.find(id => id !== game.turn.drawerId);

  ctx.advance(70_000); // đã qua giờ vẽ → đang ở fase đoán bonus
  game.tick();
  assert.equal(game.phase, Phase.FINAL_GUESS);
  const g = ctx.manager.submitGuess(guesser, 'con mèo');
  assert.equal(g.correct, true);
  assert.equal(g.points, Math.round(10 * (1 - 70_000 / 120_000) * 100) / 100); // 4.17
});

test('nobody guessing correctly gives the drawer zero points', () => {
  const ctx = makeManager({ words: ['con mèo', 'mặt trời'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const drawer = game.turn.drawerId;

  ctx.advance(61_000);
  game.tick();                      // sang fase đoán bonus
  ctx.advance(60_000);
  game.tick();                      // hết bonus, không ai đoán đúng
  assert.equal(game.phase, Phase.TURN_END);
  assert.equal(game.players.get(drawer).score, 0);
});

test('guesses are diacritic-sensitive but ignore case and extra spaces', () => {
  const ctx = makeManager({ words: ['cái gương'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const guesser = ids.find(id => id !== game.turn.drawerId);

  // Không dấu → sai.
  assert.equal(ctx.manager.submitGuess(guesser, 'cai guong').correct, false);
  ctx.advance(10_000); // hết cooldown 10s
  // Sai dấu → sai.
  assert.equal(ctx.manager.submitGuess(guesser, 'cài gượng').correct, false);
  assert.equal(game.players.get(guesser).score, 0);
  ctx.advance(10_000);
  // Đúng dấu, khác hoa/thường và thừa khoảng trắng → đúng.
  assert.equal(ctx.manager.submitGuess(guesser, '  CÁI   GƯƠNG! ').correct, true);
});

test('normalizeGuess keeps diacritics, normalize (chat masking) still ignores them', () => {
  assert.equal(normalizeGuess('Cái   Gương!'), 'cái gương');
  assert.equal(normalizeGuess('cai guong'), 'cai guong');
  assert.notEqual(normalizeGuess('cài gượng'), normalizeGuess('cái gương'));
  assert.equal(normalize('CAI GUONG'), normalize('cái gương'));
});

test('wrong guesses give no points and enforce a 10 second cooldown', () => {
  const ctx = makeManager({ words: ['con mèo'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const guesser = ids.find(id => id !== game.turn.drawerId);

  const wrong = ctx.manager.submitGuess(guesser, 'con chó');
  assert.equal(wrong.correct, false);
  assert.equal(game.players.get(guesser).score, 0);

  const again = ctx.manager.submitGuess(guesser, 'con mèo');
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'COOLDOWN');
  ctx.advance(10_000);
  const later = ctx.manager.submitGuess(guesser, 'con mèo');
  assert.equal(later.correct, true);
});

test('hints reveal at most half of the letters, one every 20 seconds, never spaces', () => {
  const ctx = makeManager({ words: ['con mèo'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  assert.equal(game.turn.word, 'con mèo');

  ctx.advance(20_000);
  game.tick();
  assert.equal(game.turn.hintsShown, 1);
  ctx.advance(20_000);
  game.tick();
  assert.equal(game.turn.hintsShown, 2);
  ctx.advance(20_000);
  game.tick();
  assert.equal(game.turn.hintsShown, 3);
  ctx.advance(20_000);
  game.tick();
  assert.equal(game.turn.hintsShown, 3); // cap = floor(6/2) = 3
  for (const idx of game.turn.revealedIdx) assert.notEqual(game.turn.word[idx], ' ');
  assert.ok(ctx.events.some(e => e.event === 'hint' && e.payload.viTri >= 1));
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
test('lobby and in-game chat histories are separate and keywords are masked', () => {
  const ctx = makeManager({ words: ['con mèo'] });
  const { roomId, ids } = addPlayers(ctx, 3);

  ctx.manager.sendChat(ids[0], 'hello cả phòng');
  const lobbyMsg = ctx.events.find(e => e.event === 'chat' && e.payload.text === 'hello cả phòng');
  assert.equal(lobbyMsg.payload.kenh, 'lobby');

  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  assert.equal(game.chats.game.length, 0);
  assert.ok(game.chats.lobby.some(m => m.noiDungChat === 'hello cả phòng'));

  ctx.manager.sendChat(ids[0], 'từ khóa là con mèo');
  const gameMsg = ctx.events.filter(e => e.event === 'chat' && e.payload.kenh === 'game').at(-1);
  assert.equal(gameMsg.payload.text, 'từ khóa là *******');
  assert.equal(game.chats.game.at(-1).noiDungChat, 'từ khóa là *******');
  assert.equal(game.chats.lobby.some(m => m.noiDungChat.includes('*******')), false);
});

// ---------------------------------------------------------------------------
// Tố cáo & bình chọn
// ---------------------------------------------------------------------------
test('report vote succeeds with two thirds and applies 15% penalty', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 4);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const target = ids.find(id => id !== game.turn.drawerId);
  const reporters = ids.filter(id => id !== target && id !== game.turn.drawerId);
  game.players.get(target).score = 20;

  const created = ctx.manager.createReport(reporters[0], target, 'tiet_lo_dap_an');
  assert.equal(created.ok, true);
  assert.equal(game.reportsUsed, 1);
  assert.equal(game.reportLimit, 2);

  assert.equal(ctx.manager.voteReport(reporters[0], created.voteId, true).ok, true);
  assert.equal(ctx.manager.voteReport(reporters[1], created.voteId, true).ok, true);
  ctx.advance(20_000);
  game.tick();

  assert.equal(game.players.get(target).violations, 1);
  assert.equal(game.players.get(target).score, 17); // 20 - floor(20*0.15)
  assert.ok(ctx.events.some(e => e.event === 'report_result' && e.payload.success === true));
});

test('report fails without enough votes and the room report limit is enforced', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const target = ids.find(id => id !== game.turn.drawerId);
  const reporter = ids.find(id => id !== target && id !== game.turn.drawerId);

  const vote = ctx.manager.createReport(reporter, target, 'pha_hoai');
  assert.equal(vote.ok, true);
  // Chỉ 1 phiếu, dưới mức tối thiểu 2 → thất bại.
  ctx.manager.voteReport(reporter, vote.voteId, true);
  ctx.advance(20_000);
  game.tick();
  assert.equal(game.players.get(target).violations, 0);
  assert.ok(ctx.events.some(e => e.event === 'report_result' && e.payload.success === false));

  // Phòng 3 người: L = max(2, floor(3/2)) = 2.
  const reporter2 = ids.find(id => id !== target && id !== reporter);
  assert.equal(ctx.manager.createReport(reporter2, target, 'thong_dong').ok, true);
  assert.equal(ctx.manager.createReport(reporter, target, 'gian_lan_diem').reason, 'REPORT_LIMIT');
});

test('fourth successful report removes the player from the room', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 4);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const target = ids.find(id => id !== game.turn.drawerId);
  const reporters = ids.filter(id => id !== target && id !== game.turn.drawerId);
  game.players.get(target).violations = 3;

  const vote = ctx.manager.createReport(reporters[0], target, 'tiet_lo_dap_an');
  ctx.manager.voteReport(reporters[0], vote.voteId, true);
  ctx.manager.voteReport(reporters[1], vote.voteId, true);
  ctx.advance(20_000);
  game.tick();

  assert.equal(game.players.get(target).left, true);
  assert.equal(ctx.manager.rooms.get(roomId).game.players.get(target).score, 0);
  assert.ok(ctx.events.some(e => e.event === 'report_result' && e.payload.removed === true));
});

// ---------------------------------------------------------------------------
// Mất kết nối / rời trận
// ---------------------------------------------------------------------------
test('disconnected player keeps a seat for 30 seconds and can resume', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 4);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const hostId = ctx.manager.rooms.get(roomId).hostId;

  ctx.manager.handleDisconnect('s1');
  assert.equal(game.players.get(hostId).connected, false);
  assert.equal(ctx.manager.rooms.get(roomId).hostId, hostId); // chưa chuyển host

  ctx.advance(10_000);
  ctx.manager.tick();
  const resumed = ctx.manager.resumeSession('s1b', hostId);
  assert.equal(resumed.ok, true);
  assert.equal(game.players.get(hostId).connected, true);
  assert.equal(ctx.manager.rooms.get(roomId).hostId, hostId);
});

test('lobby disconnect keeps the seat for 30 seconds and can resume', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 3);
  const room = ctx.manager.rooms.get(roomId);

  ctx.manager.handleDisconnect('s2');
  assert.equal(room.game.players.get(ids[1]).connected, false);
  assert.equal(room.game.players.get(ids[1]).left, false);
  assert.equal(ctx.manager.rooms.has(roomId), true);

  ctx.advance(10_000);
  ctx.manager.tick();
  const resumed = ctx.manager.resumeSession('s2b', ids[1]);
  assert.equal(resumed.ok, true);
  assert.equal(room.game.players.get(ids[1]).connected, true);
  assert.equal(room.game.phase, Phase.LOBBY);
});

test('lobby host transfer happens only after the grace expires', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 3);
  const room = ctx.manager.rooms.get(roomId);
  const hostId = room.hostId;

  ctx.manager.handleDisconnect('s1');
  ctx.advance(29_000);
  ctx.manager.tick();
  assert.equal(room.hostId, hostId);
  assert.equal(room.game.players.get(hostId).left, false);

  ctx.advance(2_000);
  ctx.manager.tick();
  assert.notEqual(room.hostId, hostId);
  assert.equal(room.game.players.has(hostId), false);
  assert.equal(ctx.manager.rooms.has(roomId), true);
  assert.ok(ids.includes(room.hostId));
});

test('host transfers only after the 30 second grace expires; game ends below 3 players', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const hostId = ctx.manager.rooms.get(roomId).hostId;

  ctx.manager.handleDisconnect('s1');
  ctx.advance(29_000);
  ctx.manager.tick();
  assert.equal(ctx.manager.rooms.get(roomId).hostId, hostId);
  assert.equal(game.phase !== Phase.GAME_END, true);

  ctx.advance(2_000);
  ctx.manager.tick();
  assert.equal(game.phase, Phase.GAME_END);
  assert.notEqual(ctx.manager.rooms.get(roomId).hostId, hostId);
});

test('host leaving mid-game transfers host without ending the game', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 4);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const hostId = ctx.manager.rooms.get(roomId).hostId;

  ctx.manager.leaveRoom(hostId);
  assert.notEqual(ctx.manager.rooms.get(roomId).hostId, hostId);
  assert.notEqual(game.phase, Phase.GAME_END);
  assert.equal(game.players.get(hostId).left, true);
  assert.equal(game.players.get(hostId).score, 0);
});

// ---------------------------------------------------------------------------
// Vòng chơi / từ khoá
// ---------------------------------------------------------------------------
test('turn order is random, every player draws exactly once, then the game ends', () => {
  const ctx = makeManager({ words: ['con mèo', 'mặt trời', 'xe đạp'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;

  const drawers = [];
  for (let turn = 0; turn < 3; turn += 1) {
    drawers.push(game.turn.drawerId);
    ctx.setNow(game.deadline);
    ctx.manager.tick(); // DRAWING → FINAL_GUESS
    assert.equal(game.phase, Phase.FINAL_GUESS);
    ctx.setNow(game.deadline);
    ctx.manager.tick(); // FINAL_GUESS → TURN_END
    assert.equal(game.phase, Phase.TURN_END);
    ctx.setNow(game.deadline);
    ctx.manager.tick(); // TURN_END → lượt kế hoặc GAME_END
  }

  assert.equal(game.phase, Phase.GAME_END);
  assert.equal(new Set(drawers).size, 3);
  assert.deepEqual(new Set(drawers), new Set(ids));
  const words = game.history.map(h => h.word);
  assert.equal(new Set(words).size, words.length);
  assert.ok(ctx.events.some(e => e.event === 'game_ended'));
});

test('a player who reconnects after missing a turn still draws exactly once', () => {
  const ctx = makeManager({
    words: ['con mèo', 'mặt trời', 'xe đạp', 'quả táo', 'cái ghế'],
    // Giữ tổng thời gian 1 lượt dưới 30 giây để còn trong thời gian giữ chỗ.
    engineConfig: { drawTime: 5, finalGuessTime: 5, turnEndTime: 1 },
  });
  const { roomId, ids } = addPlayers(ctx, 4);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;

  const victim = ids.find(id => id !== game.turn.drawerId);
  const victimSocket = `s${ids.indexOf(victim) + 1}`;
  const finishTurn = () => {
    ctx.setNow(game.deadline);
    ctx.manager.tick(); // DRAWING → FINAL_GUESS
    ctx.setNow(game.deadline);
    ctx.manager.tick(); // FINAL_GUESS → TURN_END
    ctx.setNow(game.deadline);
    ctx.manager.tick(); // TURN_END → lượt kế hoặc GAME_END
  };

  const drawers = [game.turn.drawerId];
  ctx.manager.handleDisconnect(victimSocket);
  finishTurn(); // lượt của victim (nếu tới) bị bỏ qua vì đang mất kết nối

  const resumed = ctx.manager.resumeSession('s-victim-new', victim);
  assert.equal(resumed.ok, true);

  while (game.phase !== Phase.GAME_END) {
    drawers.push(game.turn.drawerId);
    finishTurn();
  }

  assert.equal(drawers.length, 4);
  assert.deepEqual(new Set(drawers), new Set(ids));
});

test('a temporarily disconnected player keeps their score if the game ends during grace', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  const victim = ids.find(id => id !== game.turn.drawerId);

  game.players.get(victim).score = 7;
  ctx.manager.handleDisconnect(`s${ids.indexOf(victim) + 1}`);
  assert.equal(game.players.get(victim).connected, false);
  assert.equal(game.players.get(victim).left, false);

  game.endGame('completed');
  assert.equal(game.players.get(victim).score, 7);
  assert.equal(game.players.get(victim).left, false);
});

test('disconnect at the results screen keeps the 30s resume seat (no ghost player)', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  game.endGame('completed');
  assert.equal(game.phase, Phase.GAME_END);

  // Mất kết nối ngay khi đang ở màn hình tổng kết.
  ctx.manager.handleDisconnect(`s${ids.indexOf(ids[1]) + 1}`);

  // Trong 30 giây đầu: vẫn resume được, KHÔNG bị xoá sớm khỏi phòng.
  ctx.advance(15_000);
  ctx.manager.tick();
  assert.equal(ctx.manager.rooms.has(roomId), true);
  assert.equal(game.players.has(ids[1]), true);
  const resumed = ctx.manager.resumeSession('s-new', ids[1]);
  assert.equal(resumed.ok, true);
  assert.equal(game.players.get(ids[1]).connected, true);

  // Người khác mất kết nối và không quay lại: sau 30 giây bị rời hẳn, không còn bóng ma.
  ctx.manager.handleDisconnect(`s${ids.indexOf(ids[2]) + 1}`);
  ctx.advance(31_000);
  ctx.manager.tick();
  assert.equal(game.players.has(ids[2]), false);
  // Mapping phiên phải được dọn sạch: không resume được nữa.
  assert.equal(ctx.manager.resumeSession('s-other', ids[2]).ok, false);
  // Phòng vẫn tồn tại vì còn người.
  assert.equal(ctx.manager.rooms.has(roomId), true);
});

test('returning to lobby sends a fresh player list (no ghosts after cleanup)', () => {
  const ctx = makeManager();
  const { roomId, ids } = addPlayers(ctx, 4);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  // Một người rời hẳn; engine chỉ xoá hẳn khỏi danh sách ở GAME_END → returnToLobby.
  ctx.manager.leaveRoom(ids[3]);
  game.endGame('completed');

  ctx.manager.continueRoom(ids[0]); // host mở lại phòng chờ
  const cont = ctx.events.filter(e => e.event === 'room_continued').at(-1);
  assert.ok(cont, 'room_continued must be emitted');
  assert.ok(Array.isArray(cont.payload.players), 'players list must be attached');
  assert.equal(cont.payload.players.some(p => p.id === ids[3]), false,
    'player who left must not appear in the fresh lobby list');
  assert.equal(cont.payload.players.length, 3);
});

test('ties share the same rank in the final ranking', () => {
  const ctx = makeManager({ words: ['con mèo', 'mặt trời', 'xe đạp'] });
  const { roomId, ids } = addPlayers(ctx, 3);
  ctx.manager.startGame(ids[0]);
  const game = ctx.manager.rooms.get(roomId).game;
  game.players.get(ids[0]).score = 10;
  game.players.get(ids[1]).score = 10;
  game.players.get(ids[2]).score = 5;
  game.endGame('completed');
  const ranks = game.lastResult.ranking.map(r => r.rank);
  assert.deepEqual(ranks, [1, 1, 3]);
});
