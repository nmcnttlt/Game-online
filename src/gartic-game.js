'use strict';
// gartic-game.js — Engine luồng game vẽ & đoán.
// Framework-agnostic: nối với Socket.IO qua callback `emit` (xem socket-server.js).
// Server gọi game.tick() mỗi ~100ms. Phần phòng/host/ID nằm ở gartic-room.js.

const Phase = Object.freeze({
  LOBBY: 'LOBBY',             // phòng chờ
  DRAWING: 'DRAWING',         // người vẽ vẽ, mọi người đoán
  FINAL_GUESS: 'FINAL_GUESS', // hết giờ vẽ: khoá canvas, +60s đoán nốt
  TURN_END: 'TURN_END',       // lộ đáp án, chuyển lượt
  GAME_END: 'GAME_END',       // tổng kết / bảng xếp hạng
});

const REPORT_REASONS = Object.freeze({
  tiet_lo_dap_an: 'Tiết lộ đáp án',
  thong_dong: 'Thông đồng',
  pha_hoai: 'Phá hoại trận đấu',
  gian_lan_diem: 'Gian lận tính điểm',
  hanh_vi_khong_phu_hop: 'Hành vi không phù hợp',
});

const DEFAULT_CONFIG = {
  drawTime: 180,           // giây. Host chọn 1..6 phút (xem gartic-room.js)
  finalGuessTime: 60,      // hết giờ vẽ → +60 giây đoán nốt
  wrongGuessDelay: 10,     // đoán sai → khoá ô đoán 10 giây
  turnEndTime: 5,          // thời gian lộ đáp án trước lượt kế
  hintInterval: 20,        // mỗi 20 giây lộ 1 chữ cái ngẫu nhiên
  minPlayers: 3,
  maxPlayers: 10,
  maxChatLength: 200,
  maxStrokes: 3000,
  maxStrokePoints: 4000,
  reportVoteTime: 20,
  reportPenalties: [0.15, 0.25, 0.40],
  maxChatHistory: 120,
};

// ---------- Tiện ích ----------
/** Bỏ dấu tiếng Việt, hoa/thường, ký tự đặc biệt, khoảng trắng thừa. */
function normalize(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Chuẩn hoá ĐÁP ÁN khi đoán: giữ nguyên dấu tiếng Việt, chỉ bỏ hoa/thường,
 * dấu câu và khoảng trắng thừa. "cai guong" ≠ "cái gương" ≠ "cài gượng".
 */
function normalizeGuess(s) {
  return String(s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Điểm làm tròn 2 chữ số thập phân, kẹp trong khoảng 0..10. */
function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(10, Math.max(0, value)) * 100) / 100;
}

/** Chuẩn hoá 1 ký tự nhưng GIỮ khoảng trắng + dấu câu (dùng để che từ khoá). */
function normalizeChar(ch) {
  return String(ch)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Che từ khoá bí mật trong nội dung chat.
 * "từ khóa là con mèo" + "con mèo" → "từ khóa là *******".
 * So khớp không dấu / không phân biệt hoa thường / cho phép nhiều khoảng trắng.
 */
function maskAnswer(text, word) {
  const src = String(text ?? '');
  const answer = String(word ?? '').trim();
  if (!src || !answer) return src;

  // Chuỗi đã chuẩn hoá + bản đồ vị trí về chuỗi gốc.
  let norm = '';
  const map = [];
  for (let i = 0; i < src.length; i += 1) {
    const part = normalizeChar(src[i]);
    for (const c of part) { norm += c; map.push(i); }
  }
  const tokens = answer.split(/\s+/).map(t => normalizeChar(t)).filter(Boolean);
  if (!tokens.length) return src;
  const pattern = new RegExp(tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');

  let out = '';
  let cursor = 0;
  let m;
  while ((m = pattern.exec(norm)) !== null) {
    const start = map[m.index];
    const end = map[m.index + m[0].length - 1] + 1;
    if (start === undefined || end === undefined || start < cursor) continue;
    out += src.slice(cursor, start) + '*'.repeat(end - start);
    cursor = end;
  }
  return out + src.slice(cursor);
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Kiểm tra & chuẩn hoá 1 nét vẽ:
 * { id, tool: 'brush'|'eraser', color: '#rrggbb', size: 0..0.5,
 *   points: [{x, y}] với x,y đã chuẩn hoá 0..1 }. Trả null nếu không hợp lệ.
 */
function sanitizeStroke(raw, makeId = () => `stroke-${Date.now()}`) {
  if (!raw || typeof raw !== 'object') return null;
  const tool = raw.tool === undefined || raw.tool === 'brush' ? 'brush' : raw.tool === 'eraser' ? 'eraser' : null;
  if (!tool) return null;
  const color = tool === 'eraser' ? '#ffffff' : (raw.color ?? '#1f2937');
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  const size = raw.size ?? 0.006;
  if (!Number.isFinite(size) || size <= 0 || size > 0.5) return null;
  const pts = raw.points;
  if (!Array.isArray(pts) || pts.length === 0 || pts.length > DEFAULT_CONFIG.maxStrokePoints) return null;
  const points = [];
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
    points.push({ x: p.x, y: p.y });
  }
  const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : makeId();
  return { id, tool, color: color.toLowerCase(), size, points };
}

/** Che từ khoá trong chat (export để test). */
function safeChatText(text, word) { return maskAnswer(text, word); }

// ---------- Game ----------
class GarticGame {
  /**
   * @param {object} opts
   * @param {string[]} opts.words
   * @param {(event:string, payload:object, toPlayerId?:string|null)=>void} opts.emit
   * @param {object} [opts.config]
   * @param {()=>number} [opts.clock]
   * @param {()=>number} [opts.rng]
   * @param {()=>string|null} [opts.getHostId]
   * @param {(playerId:string, reason:string)=>void} [opts.onPlayerRemoved]
   */
  constructor({ words, emit, config = {}, clock = Date.now, rng = Math.random, getHostId = () => null, onPlayerRemoved = () => {} }) {
    this.wordPool = [...new Set(words)];
    this.emit = emit;
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.clock = clock;
    this.rng = rng;
    this.getHostId = getHostId;
    this.onPlayerRemoved = onPlayerRemoved;

    this.players = new Map(); // id -> {id,name,score,connected,left,violations}
    this.phase = Phase.LOBBY;
    this.usedWords = new Set();
    this.drawnThisRound = new Set();
    this.history = [];
    this.chats = { lobby: [], game: [] };
    this.lastResult = null;
    this.strokeSeq = 0;
    this.voteSeq = 0;
    this.activeVote = null;
    this.reportLimit = 0;
    this.reportsUsed = 0;
    this.resetGameState();
  }

  resetGameState() {
    this.round = 0;
    this.turnQueue = [];
    this.turn = null;
    this.deadline = 0;
    this.usedWords.clear();
    this.drawnThisRound.clear();
    this.history = [];
    this.lastResult = null;
    this.activeVote = null;
    this.reportLimit = 0;
    this.reportsUsed = 0;
    this.chats.game = [];
    for (const p of this.players.values()) p.score = 0;
  }

  setConfig(partial) {
    if (this.phase !== Phase.LOBBY) return false;
    Object.assign(this.cfg, partial);
    return true;
  }

  // ----- Quản lý người chơi -----
  addPlayer(id, name) {
    if (this.players.has(id)) return false;
    this.players.set(id, { id, name, score: 0, connected: true, left: false, violations: 0 });
    this.emit('player_joined', { id, name, players: this.publicPlayers() }, null);
    return true;
  }

  /** Mất kết nối tạm thời — vẫn giữ chỗ, chờ reconnect. */
  markDisconnected(id) {
    const p = this.players.get(id);
    if (!p || p.left) return;
    p.connected = false;
    // Nếu người vẽ đang kéo dở một nét, chốt nét đó để không treo trạng thái liveStroke.
    if (this.turn && this.turn.drawerId === id && this.turn.liveStroke) this.finalizeLiveStroke();
    const kenh = this.phase === Phase.LOBBY || this.phase === Phase.GAME_END ? 'lobby' : 'game';
    this.emit('player_connection', { id, name: p.name, connected: false, kenh, players: this.publicPlayers() }, null);
  }

  markReconnected(id) {
    const p = this.players.get(id);
    if (!p || p.left) return false;
    p.connected = true;

    // Nếu lượt của người này đã bị bỏ qua lúc mất kết nối, xếp lại vào cuối hàng đợi
    // để bảo đảm mỗi người vẫn có đúng một lượt vẽ trước khi trận kết thúc.
    const inGame = this.phase !== Phase.LOBBY && this.phase !== Phase.GAME_END;
    if (inGame && this.turn && this.turn.drawerId !== id
      && !this.drawnThisRound.has(id) && !this.turnQueue.includes(id)) {
      this.turnQueue.push(id);
    }

    const kenh = this.phase === Phase.LOBBY || this.phase === Phase.GAME_END ? 'lobby' : 'game';
    this.emit('player_connection', { id, name: p.name, connected: true, kenh, players: this.publicPlayers() }, null);
    return true;
  }

  /** Rời hẳn (hết thời gian giữ chỗ hoặc tự bấm rời). */
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p || p.left) return;
    const inGame = this.phase !== Phase.LOBBY && this.phase !== Phase.GAME_END;
    if (!inGame) {
      this.players.delete(id);
      this.emit('player_left', { id, name: p.name, kenh: 'lobby', players: this.publicPlayers() }, null);
      return;
    }

    p.left = true;
    p.connected = false;
    p.score = 0; // người rời phòng lập tức 0 điểm
    if (this.activeVote && (this.activeVote.targetId === id || this.activeVote.reporterId === id)) {
      this.cancelVote('player_left');
    }
    this.emit('player_left', { id, name: p.name, scoreZero: true, kenh: 'game', players: this.publicPlayers() }, null);

    if (this.turn && this.turn.drawerId === id) this.endTurn('drawer_left');
    if (this.activePlayers().length < this.cfg.minPlayers) return this.endGame('not_enough_players');
    if (this.turn) this.checkAllGuessed();
  }

  /** Đổi tên hiển thị (ví dụ khi tên bị người khác nhận lại sau khi mất kết nối). */
  renamePlayer(id, newName, note = '') {
    const p = this.players.get(id);
    if (!p || p.left) return false;
    const oldName = p.name;
    p.name = String(newName).slice(0, 30) || oldName;
    const kenh = this.phase === Phase.LOBBY || this.phase === Phase.GAME_END ? 'lobby' : 'game';
    this.emit('player_renamed', {
      id, oldName, name: p.name, note, kenh, players: this.publicPlayers(),
    }, null);
    return true;
  }

  activePlayers() { return [...this.players.values()].filter(p => !p.left); }
  connectedPlayers() { return [...this.players.values()].filter(p => !p.left && p.connected); }

  publicPlayers() {
    const t = this.turn;
    const hostId = this.getHostId();
    return [...this.players.values()].map(({ id, name, score, connected, left, violations }) => ({
      id, name, score, connected, left,
      isHost: id === hostId,
      isDrawer: !!t && t.drawerId === id,
      solved: !!t && t.guessed.has(id),
      hasDrawn: this.drawnThisRound.has(id),
      violations,
      reportedThisTurn: !!t && t.reportedBy.has(id),
    }));
  }

  // ----- Bắt đầu game -----
  start() {
    if (this.phase !== Phase.LOBBY && this.phase !== Phase.GAME_END) return false;
    const active = this.connectedPlayers();
    if (active.length < this.cfg.minPlayers || active.length > this.cfg.maxPlayers) return false;
    for (const [id, p] of this.players) if (p.left || !p.connected) this.players.delete(id);

    this.resetGameState();
    this.round = 1;
    this.turnQueue = this.buildTurnOrder();
    const n = this.connectedPlayers().length;
    this.reportLimit = Math.max(2, Math.floor(n / 2));
    this.reportsUsed = 0;
    this.chats = { lobby: this.chats.lobby, game: [] };

    this.emit('game_started', { rounds: 1, players: this.publicPlayers(), reportLimit: this.reportLimit }, null);
    this.emit('chat_cleared', { kenh: 'game' }, null);
    this.nextTurn();
    return true;
  }

  returnToLobby() {
    if (this.phase !== Phase.GAME_END && this.phase !== Phase.LOBBY) return false;
    for (const [id, p] of this.players) if (p.left || !p.connected) this.players.delete(id);
    this.resetGameState();
    this.phase = Phase.LOBBY;
    this.chats = { lobby: [], game: [] };
    this.emit('lobby_reset', { players: this.publicPlayers() }, null);
    this.emit('chat_cleared', { kenh: 'lobby' }, null);
    return true;
  }

  /** Thứ tự vẽ: xáo ngẫu nhiên những người đang online, mỗi người đúng 1 lần. */
  buildTurnOrder() {
    return shuffle(this.connectedPlayers().map(p => p.id), this.rng);
  }

  drawWords(n) {
    const available = this.wordPool.filter(w => !this.usedWords.has(w));
    return shuffle(available, this.rng).slice(0, n);
  }

  // ----- Chuyển lượt -----
  nextTurn() {
    let drawerId = null;
    while (this.turnQueue.length > 0) {
      const candidate = this.turnQueue.shift();
      const p = this.players.get(candidate);
      if (p && !p.left && p.connected && !this.drawnThisRound.has(candidate)) { drawerId = candidate; break; }
    }
    if (!drawerId) return this.endGame('completed');

    const word = this.drawWords(1)[0];
    if (!word) return this.endGame('out_of_words');

    this.drawnThisRound.add(drawerId);
    // G = tổng số người có quyền đoán, chốt ngay khi bắt đầu lượt (kể cả ai rớt mạng
    // giữa lượt thì công thức điểm vẫn ổn định).
    const totalGuessers = this.activePlayers().filter((p) => p.id !== drawerId).length;
    this.turn = {
      drawerId,
      word,
      startedAt: 0,
      drawDeadline: 0,
      totalGuessers,
      guessed: new Map(),       // playerId -> điểm nhận khi đoán đúng
      guessedAt: new Map(),
      attempts: new Map(),
      cooldowns: new Map(),
      gains: new Map(),
      hintsShown: 0,
      revealedIdx: new Set(),
      strokes: [],
      undone: [],
      liveStroke: null,
      recorded: false,
      reportedBy: new Set(),
    };
    this.beginDrawing(word);
  }

  beginDrawing(word) {
    const t = this.turn;
    t.word = word;
    this.usedWords.add(word);
    t.startedAt = this.clock();
    this.phase = Phase.DRAWING;
    t.drawDeadline = t.startedAt + this.cfg.drawTime * 1000;
    this.deadline = t.drawDeadline;

    this.emit('drawing_started', {
      round: this.round,
      turnNo: this.history.length + 1,
      drawerId: t.drawerId,
      phase: this.phase,
      deadline: this.deadline,
      drawDeadline: t.drawDeadline,
      hint: this.maskedWord(),
      wordLength: this.letterCount(),
      players: this.publicPlayers(),
    }, null);
    this.emit('word_assigned', { word }, t.drawerId);
  }

  letterCount() {
    return this.turn ? [...this.turn.word].filter(c => !/\s/.test(c)).length : 0;
  }

  // ----- Vẽ: đồng bộ trực tiếp trong lúc kéo chuột -----
  beginStroke(playerId, raw) {
    if (this.phase !== Phase.DRAWING || playerId !== this.turn.drawerId) return false;
    if (this.turn.liveStroke) return false;
    if (this.turn.strokes.length >= this.cfg.maxStrokes) return false;
    const s = sanitizeStroke(raw, () => `stroke-${++this.strokeSeq}`);
    if (!s) return false;
    this.turn.liveStroke = s;
    this.emit('draw:start', { stroke: s, from: playerId }, null);
    return true;
  }

  appendStrokePoints(playerId, strokeId, points) {
    if (this.phase !== Phase.DRAWING || playerId !== this.turn.drawerId) return false;
    const live = this.turn.liveStroke;
    if (!live || live.id !== strokeId || !Array.isArray(points) || points.length === 0) return false;
    const added = [];
    for (const p of points) {
      if (live.points.length >= this.cfg.maxStrokePoints) break;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      const point = { x: p.x, y: p.y };
      live.points.push(point);
      added.push(point);
    }
    if (!added.length) return false;
    this.emit('draw:points', { id: live.id, points: added, from: playerId }, null);
    return true;
  }

  endStroke(playerId, strokeId) {
    if (this.phase !== Phase.DRAWING || playerId !== this.turn.drawerId) return false;
    const live = this.turn.liveStroke;
    if (!live || (strokeId && live.id !== strokeId)) return false;
    this.turn.liveStroke = null;
    this.turn.strokes.push(live);
    this.turn.undone = [];
    this.emit('draw:end', { id: live.id, from: playerId }, null);
    return true;
  }

  finalizeLiveStroke() {
    const t = this.turn;
    if (!t || !t.liveStroke) return;
    const live = t.liveStroke;
    t.liveStroke = null;
    t.strokes.push(live);
    t.undone = [];
    this.emit('draw:end', { id: live.id }, null);
  }

  undoStroke(playerId) {
    if (this.phase !== Phase.DRAWING || playerId !== this.turn.drawerId) return false;
    this.finalizeLiveStroke();
    const s = this.turn.strokes.pop();
    if (!s) return false;
    this.turn.undone.push(s);
    this.emit('draw:undo', { id: s.id, from: playerId }, null);
    return true;
  }

  redoStroke(playerId) {
    if (this.phase !== Phase.DRAWING || playerId !== this.turn.drawerId) return false;
    const s = this.turn.undone.pop();
    if (!s) return false;
    if (this.turn.strokes.length >= this.cfg.maxStrokes) return false;
    this.turn.strokes.push(s);
    this.emit('draw:redo', { stroke: s, from: playerId }, null);
    return true;
  }

  clearCanvas(playerId) {
    if (this.phase !== Phase.DRAWING || playerId !== this.turn.drawerId) return false;
    this.turn.strokes = [];
    this.turn.undone = [];
    this.turn.liveStroke = null;
    this.emit('canvas_cleared', { from: playerId }, null);
    return true;
  }

  // ----- Điểm -----
  /** Cộng điểm; làm tròn 2 chữ số thập phân để tổng không bị nhiễu số học dấu phẩy động. */
  addScore(playerId, delta) {
    const p = this.players.get(playerId);
    if (!p || !delta) return 0;
    p.score = Math.round(Math.max(0, p.score + delta) * 100) / 100;
    if (this.turn) this.turn.gains.set(playerId, Math.round(((this.turn.gains.get(playerId) ?? 0) + delta) * 100) / 100);
    return delta;
  }

  /**
   * Tổng thời gian một lượt chơi, T (ms) = thời gian vẽ + thời gian đoán bonus.
   * Dùng T của cả lượt (không chỉ phần vẽ) để một đáp án đúng trong fase bonus
   * vẫn nhận được điểm theo công thức.
   */
  turnLengthMs() {
    return (this.cfg.drawTime + this.cfg.finalGuessTime) * 1000;
  }

  /**
   * Điểm người đoán:
   *   P = 10 × (1 − t/T) × (1 − 0.2 × (r−1)/(G−1))
   * t = thời gian trôi qua (ms) tính từ đầu lượt tới lúc server nhận đáp án đúng,
   * r = thứ hạng trả lời đúng, G = tổng số người có quyền đoán.
   * Kết quả làm tròn 2 chữ số thập phân, kẹp trong 0..10.
   */
  calcGuessPoints(now, rank = 1) {
    const t = this.turn;
    const total = this.turnLengthMs();
    if (total <= 0) return 0;
    const elapsed = Math.min(total, Math.max(0, now - t.startedAt));
    const timeFactor = 1 - elapsed / total;
    const G = t.totalGuessers ?? Math.max(1, this.activePlayers().length - 1);
    // G = 1 → không có ai để so thứ hạng, hệ số hạng = 1.
    const rankFactor = G > 1 ? 1 - 0.2 * ((rank - 1) / (G - 1)) : 1;
    return clampScore(10 * timeFactor * rankFactor);
  }

  // ----- Đoán -----
  submitGuess(playerId, text) {
    const p = this.players.get(playerId);
    const t = this.turn;
    if (!p || !p.connected || p.left) return { ok: false, reason: 'NO_PLAYER' };
    const active = t && (this.phase === Phase.DRAWING || this.phase === Phase.FINAL_GUESS);
    if (!active) return { ok: false, reason: 'NOT_GUESSING_PHASE' };
    if (playerId === t.drawerId) return { ok: false, reason: 'IS_DRAWER' };
    if (t.guessed.has(playerId)) return { ok: false, reason: 'ALREADY_SOLVED' };
    const raw = String(text ?? '').trim();
    if (!raw || raw.length > this.cfg.maxChatLength) return { ok: false, reason: 'INVALID_TEXT' };

    const now = this.clock();
    const until = t.cooldowns.get(playerId) ?? 0;
    if (now < until) {
      const remainingMs = until - now;
      this.emit('guess_rejected', { reason: 'COOLDOWN', remainingMs, until }, playerId);
      return { ok: false, reason: 'COOLDOWN', remainingMs };
    }

    // So khớp CÓ phân biệt dấu tiếng Việt (chỉ bỏ hoa/thường + khoảng trắng thừa).
    const guess = normalizeGuess(raw);
    const answer = normalizeGuess(t.word);
    if (!guess) return { ok: false, reason: 'INVALID_TEXT' };

    if (guess === answer) {
      const attempts = (t.attempts.get(playerId) ?? 0) + 1;
      t.attempts.set(playerId, attempts);
      const rank = t.guessed.size + 1; // 1 = người đầu tiên đoán đúng
      const points = this.calcGuessPoints(now, rank);
      this.addScore(playerId, points);
      t.guessed.set(playerId, points);
      t.guessedAt.set(playerId, now);
      this.emit('guess_correct', {
        playerId, name: p.name, points, attempts, rank,
        solvedCount: t.guessed.size,
        guessers: t.totalGuessers ?? Math.max(1, this.activePlayers().length - 1),
        scores: this.publicPlayers(),
      }, null);
      this.checkAllGuessed();
      return { ok: true, correct: true, points, attempts };
    }

    const attempts = (t.attempts.get(playerId) ?? 0) + 1;
    t.attempts.set(playerId, attempts);
    const cooldownUntil = now + this.cfg.wrongGuessDelay * 1000;
    t.cooldowns.set(playerId, cooldownUntil);
    // Đoán sai: 0 điểm, không phạt, chỉ khoá ô đoán 10 giây.
    this.emit('guess_wrong', { attempts, cooldownUntil }, playerId);
    return { ok: true, correct: false, attempts, cooldownUntil };
  }

  checkAllGuessed() {
    const t = this.turn;
    if (!t) return;
    const guessers = this.connectedPlayers().filter(p => p.id !== t.drawerId);
    if (guessers.length > 0 && guessers.every(p => t.guessed.has(p.id))) this.endTurn('all_guessed');
  }

  // ----- Chat (tách khỏi ô đoán) -----
  sendChat(playerId, text) {
    const p = this.players.get(playerId);
    if (!p || !p.connected || p.left) return { ok: false, reason: 'NO_PLAYER' };
    const raw = String(text ?? '').trim();
    if (!raw || raw.length > this.cfg.maxChatLength) return { ok: false, reason: 'INVALID_TEXT' };

    const inGame = this.phase !== Phase.LOBBY && this.phase !== Phase.GAME_END;
    const kenh = inGame ? 'game' : 'lobby';
    const masked = maskAnswer(raw, this.turn?.word);
    const msg = { from: playerId, name: p.name, text: masked, kenh, at: this.clock(), daChe: masked !== raw };
    this.pushChat(kenh, { loai: 'chat', tenNguoiDung: p.name, noiDungChat: masked, kenh, at: msg.at });
    this.emit('chat', msg, null);
    return { ok: true, kenh, masked: masked !== raw };
  }

  pushChat(kenh, msg) {
    const list = kenh === 'game' ? this.chats.game : this.chats.lobby;
    list.push(msg);
    const max = this.cfg.maxChatHistory;
    if (list.length > max) list.splice(0, list.length - max);
  }

  // ----- Gợi ý: 20 giây / 1 chữ, tối đa floor(số chữ / 2) -----
  maskedWord() {
    const t = this.turn;
    if (!t) return '';
    return [...t.word].map((ch, i) => {
      if (/\s/.test(ch)) return '  ';
      return t.revealedIdx.has(i) ? ch : '_';
    }).join(' ');
  }

  updateHints(now) {
    const t = this.turn;
    if (!t) return;
    const letters = [...t.word].map((c, i) => (/\s/.test(c) ? -1 : i)).filter(i => i >= 0);
    const cap = Math.floor(letters.length / 2);
    const elapsed = now - t.startedAt;
    const due = Math.min(cap, Math.floor(elapsed / (this.cfg.hintInterval * 1000)));
    while (t.hintsShown < due) {
      const hidden = letters.filter(i => !t.revealedIdx.has(i));
      if (!hidden.length) break;
      const idx = hidden[Math.floor(this.rng() * hidden.length)];
      t.revealedIdx.add(idx);
      t.hintsShown += 1;
      this.emit('hint', {
        hint: this.maskedWord(),
        viTri: letters.indexOf(idx) + 1,
        chuCai: t.word[idx],
        soGoiY: t.hintsShown,
        toiDaGoiY: cap,
      }, null);
    }
  }

  // ----- Vòng lặp thời gian -----
  tick() {
    const now = this.clock();
    if (this.activeVote && now >= this.activeVote.deadline) this.resolveVote();
    switch (this.phase) {
      case Phase.DRAWING:
        this.updateHints(now);
        if (now >= this.deadline) this.enterFinalGuess(now);
        break;
      case Phase.FINAL_GUESS:
        if (now >= this.deadline) this.endTurn('timeout');
        break;
      case Phase.TURN_END:
        if (now >= this.deadline) this.nextTurn();
        break;
      default:
        break;
    }
  }

  enterFinalGuess(now) {
    if (this.cfg.finalGuessTime <= 0) return this.endTurn('timeout');
    this.finalizeLiveStroke();
    this.phase = Phase.FINAL_GUESS;
    this.deadline = now + this.cfg.finalGuessTime * 1000;
    this.emit('final_guess_started', { deadline: this.deadline, hint: this.maskedWord(), conLaiMs: this.cfg.finalGuessTime * 1000 }, null);
  }

  // ----- Kết thúc lượt -----
  recordTurn(reason) {
    const t = this.turn;
    if (!t || t.recorded) return;
    t.recorded = true;
    this.history.push({
      no: this.history.length + 1,
      round: this.round,
      drawerId: t.drawerId,
      drawerName: this.players.get(t.drawerId)?.name ?? '',
      word: t.word,
      reason,
      gains: Object.fromEntries(t.gains),
    });
  }

  endTurn(reason) {
    const t = this.turn;
    if (!t || this.phase === Phase.TURN_END || this.phase === Phase.GAME_END) return;
    this.finalizeLiveStroke();
    this.cancelVote('turn_end');

    // Người vẽ rời trận → huỷ lượt, hoàn lại toàn bộ điểm đã cộng trong lượt.
    if (reason === 'drawer_left') {
      for (const [id, delta] of t.gains) {
        const p = this.players.get(id);
        if (p) p.score = Math.max(0, p.score - delta);
      }
      t.gains.clear();
      t.guessed.clear();
    }

    let drawerPoints = 0;
    if (reason !== 'drawer_left') {
      // Điểm người vẽ: D = (10/G) × Σ_{i=1..C} (1 − t_i/T)
      // G = tổng số người có quyền đoán (chốt đầu lượt), C = số người đoán đúng,
      // t_i = thời điểm người thứ i đoán đúng (tính từ đầu lượt).
      const T = this.turnLengthMs();
      const G = t.totalGuessers ?? this.activePlayers().filter((p) => p.id !== t.drawerId).length;
      if (T > 0 && G > 0) {
        let sum = 0;
        for (const at of t.guessedAt.values()) {
          sum += 1 - Math.min(T, Math.max(0, at - t.startedAt)) / T;
        }
        drawerPoints = clampScore((10 / G) * sum);
      }
      if (drawerPoints > 0) this.addScore(t.drawerId, drawerPoints);
    }

    this.recordTurn(reason);
    this.phase = Phase.TURN_END;
    this.deadline = this.clock() + this.cfg.turnEndTime * 1000;
    const gains = [...t.gains].filter(([, d]) => d !== 0)
      .map(([id, delta]) => ({ id, name: this.players.get(id)?.name ?? '', delta }));
    this.emit('turn_ended', {
      reason,
      turnNo: this.history.length,
      word: t.word,
      drawerId: t.drawerId,
      drawerPoints,
      guessed: Object.fromEntries(t.guessed),
      gains,
      deadline: this.deadline,
      scores: this.publicPlayers(),
    }, null);
  }

  // ----- Tố cáo & bình chọn -----
  reportStateFor(playerId) {
    const t = this.turn;
    const v = this.activeVote;
    const inGame = !!t && (this.phase === Phase.DRAWING || this.phase === Phase.FINAL_GUESS);
    let reason = null;
    if (!inGame) reason = 'NOT_IN_GAME';
    else if (this.reportsUsed >= this.reportLimit) reason = 'REPORT_LIMIT';
    else if (v) reason = 'VOTE_ACTIVE';
    else if (t.reportedBy.has(playerId)) reason = 'ALREADY_REPORTED_THIS_TURN';
    return {
      canReport: !reason,
      reason,
      reportLimit: this.reportLimit,
      reportsUsed: this.reportsUsed,
      reportedThisTurn: !!t && t.reportedBy.has(playerId),
      vote: v ? {
        id: v.id,
        reporterId: v.reporterId,
        reporterName: this.players.get(v.reporterId)?.name ?? '',
        targetId: v.targetId,
        targetName: this.players.get(v.targetId)?.name ?? '',
        reason: v.reason,
        reasonText: REPORT_REASONS[v.reason] || v.reason,
        deadline: v.deadline,
        conLaiMs: Math.max(0, v.deadline - this.clock()),
        eligibleCount: v.eligible.size,
        eligibleIds: [...v.eligible],
        yes: [...v.votes.values()].filter(Boolean).length,
        no: [...v.votes.values()].filter(x => !x).length,
        voted: v.votes.has(playerId),
        canVote: v.eligible.has(playerId) && !v.votes.has(playerId),
      } : null,
    };
  }

  createReport(reporterId, targetId, reason) {
    const reporter = this.players.get(reporterId);
    const target = this.players.get(targetId);
    const t = this.turn;
    const inGame = !!t && (this.phase === Phase.DRAWING || this.phase === Phase.FINAL_GUESS);
    if (!reporter || !reporter.connected || reporter.left) return { ok: false, reason: 'NO_PLAYER' };
    if (!inGame) return { ok: false, reason: 'NOT_IN_GAME' };
    if (!target || target.left || target.id === reporterId) return { ok: false, reason: 'INVALID_TARGET' };
    if (!REPORT_REASONS[reason]) return { ok: false, reason: 'INVALID_REASON' };
    if (this.reportsUsed >= this.reportLimit) return { ok: false, reason: 'REPORT_LIMIT' };
    if (this.activeVote) return { ok: false, reason: 'VOTE_ACTIVE' };
    if (t.reportedBy.has(reporterId)) return { ok: false, reason: 'ALREADY_REPORTED_THIS_TURN' };

    const eligible = new Set(this.activePlayers().filter(p => p.id !== targetId).map(p => p.id));
    if (eligible.size < 2) return { ok: false, reason: 'NOT_ENOUGH_VOTERS' };

    this.reportsUsed += 1;
    t.reportedBy.add(reporterId);
    this.activeVote = {
      id: `vote-${++this.voteSeq}`,
      reporterId,
      targetId,
      reason,
      votes: new Map(),
      eligible,
      deadline: this.clock() + this.cfg.reportVoteTime * 1000,
    };
    this.emit('report_started', {
      id: this.activeVote.id,
      reporterId,
      reporterName: reporter.name,
      targetId,
      targetName: target.name,
      reason,
      reasonText: REPORT_REASONS[reason],
      deadline: this.activeVote.deadline,
      eligibleCount: eligible.size,
      eligibleIds: [...eligible],
      reportsUsed: this.reportsUsed,
      reportLimit: this.reportLimit,
    }, null);
    return { ok: true, voteId: this.activeVote.id };
  }

  voteReport(playerId, reportId, agree) {
    const v = this.activeVote;
    const p = this.players.get(playerId);
    if (!v || v.id !== reportId) return { ok: false, reason: 'NO_VOTE' };
    if (!p || !p.connected || p.left) return { ok: false, reason: 'NO_PLAYER' };
    if (!v.eligible.has(playerId)) return { ok: false, reason: 'NOT_ELIGIBLE' };
    if (v.votes.has(playerId)) return { ok: false, reason: 'ALREADY_VOTED' };
    v.votes.set(playerId, !!agree);
    this.emit('report_vote_updated', {
      id: v.id,
      yes: [...v.votes.values()].filter(Boolean).length,
      no: [...v.votes.values()].filter(x => !x).length,
      total: v.votes.size,
      eligibleCount: v.eligible.size,
      deadline: v.deadline,
    }, null);
    if (v.votes.size >= v.eligible.size) this.resolveVote();
    return { ok: true };
  }

  cancelVote(reason) {
    if (!this.activeVote) return;
    const v = this.activeVote;
    this.activeVote = null;
    this.emit('report_result', {
      id: v.id, huy: true, lyDo: reason,
      targetId: v.targetId, targetName: this.players.get(v.targetId)?.name ?? '',
    }, null);
  }

  resolveVote() {
    const v = this.activeVote;
    if (!v) return;
    this.activeVote = null;
    const target = this.players.get(v.targetId);
    const yes = [...v.votes.values()].filter(Boolean).length;
    const no = [...v.votes.values()].filter(x => !x).length;
    const total = v.votes.size;
    // Tối thiểu 2 phiếu; đồng ý phải đạt >= 2/3 số phiếu hợp lệ.
    const success = total >= 2 && yes * 3 >= total * 2;

    let penalty = 0;
    let removed = false;
    let violations = target?.violations ?? 0;
    if (success && target && !target.left) {
      target.violations += 1;
      violations = target.violations;
      if (violations >= 4) {
        removed = true;
        target.score = 0;
      } else {
        const pct = this.cfg.reportPenalties[violations - 1] ?? 0.4;
        penalty = Math.floor(target.score * pct);
        target.score = Math.max(0, target.score - penalty);
      }
    }

    this.emit('report_result', {
      id: v.id,
      huy: false,
      success,
      yes,
      no,
      total,
      eligibleCount: v.eligible.size,
      targetId: v.targetId,
      targetName: target?.name ?? '',
      reporterId: v.reporterId,
      reporterName: this.players.get(v.reporterId)?.name ?? '',
      reason: v.reason,
      reasonText: REPORT_REASONS[v.reason],
      penalty,
      score: target?.score ?? 0,
      violations,
      removed,
      scores: this.publicPlayers(),
    }, null);

    if (removed) this.onPlayerRemoved(v.targetId, 'report');
  }

  // ----- Kết thúc game -----
  endGame(reason) {
    if (this.phase === Phase.GAME_END) return;
    if (this.turn && !this.turn.recorded) this.recordTurn('aborted');
    this.cancelVote('game_end');
    // Người đang trong 30 giây giữ chỗ vẫn giữ điểm; chỉ người đã rời hẳn mới bị 0 điểm.
    this.phase = Phase.GAME_END;
    this.turn = null;
    this.deadline = 0;

    const sorted = [...this.players.values()]
      .map(p => ({
        id: p.id, name: p.name, score: p.score, connected: p.connected, left: p.left,
        violations: p.violations,
        perTurn: this.history.map(h => h.gains[p.id] ?? 0),
      }))
      .sort((a, b) => b.score - a.score);

    const ranking = [];
    sorted.forEach((p, i) => {
      const rank = i > 0 && p.score === ranking[i - 1].score ? ranking[i - 1].rank : i + 1;
      ranking.push({ ...p, rank });
    });
    const turns = this.history.map(h => ({ no: h.no, drawerName: h.drawerName, word: h.word, reason: h.reason }));
    this.lastResult = { reason, ranking, turns, winner: ranking[0] ?? null };
    this.emit('game_ended', this.lastResult, null);
  }

  snapshotFor(playerId) {
    const t = this.turn;
    const me = this.players.get(playerId);
    const inGame = this.phase !== Phase.LOBBY && this.phase !== Phase.GAME_END;
    return {
      phase: this.phase,
      round: this.round,
      rounds: 1,
      deadline: this.deadline,
      conLaiMs: Math.max(0, this.deadline - this.clock()),
      drawDeadline: t?.drawDeadline ?? 0,
      conLaiVeMs: t ? Math.max(0, t.drawDeadline - this.clock()) : 0,
      players: this.publicPlayers(),
      drawerId: t?.drawerId ?? null,
      hint: t?.word ? this.maskedWord() : null,
      word: t && (playerId === t.drawerId || this.phase === Phase.TURN_END || this.phase === Phase.GAME_END) ? t.word : undefined,
      strokes: t?.strokes ?? [],
      liveStroke: t?.liveStroke ?? null,
      turnNo: this.history.length + (t && !t.recorded ? 1 : 0),
      me: me && {
        score: me.score,
        attempts: t?.attempts.get(playerId) ?? 0,
        solved: !!t && t.guessed.has(playerId),
        cooldownUntil: t?.cooldowns.get(playerId) ?? 0,
        canGuess: !!t && inGame && playerId !== t.drawerId && !t.guessed.has(playerId),
        connected: me.connected,
        left: me.left,
      },
      chats: this.chats[inGame ? 'game' : 'lobby'],
      report: this.reportStateFor(playerId),
      reportLimit: this.reportLimit,
      reportsUsed: this.reportsUsed,
      lastResult: this.phase === Phase.GAME_END ? this.lastResult : null,
    };
  }
}

module.exports = {
  GarticGame, Phase, DEFAULT_CONFIG, REPORT_REASONS,
  normalize, normalizeGuess, normalizeChar, maskAnswer, safeChatText, sanitizeStroke, clampScore,
};
