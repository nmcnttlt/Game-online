'use strict';
// gartic-room.js — Quản lý phòng: tạo phòng, vào phòng bằng ID, host, rời / reconnect.
// Mỗi phòng sở hữu 1 GarticGame.

const { randomUUID } = require('node:crypto');
const { GarticGame, Phase, DEFAULT_CONFIG, normalize } = require('./gartic-game');

const ROOM_LIMITS = Object.freeze({
  ID_LENGTH: 6,                 // mã phòng gồm 6 chữ số
  MIN_CAPACITY: 3,
  MAX_CAPACITY: 10,
  MIN_TO_START: 3,
  TIME_OPTIONS: [1, 2, 3, 4, 5, 6], // mỗi bước 1 phút
  MAX_NAME: 15,
  RECONNECT_GRACE_MS: 30_000,   // giữ chỗ 30 giây khi mất kết nối
});

const DEFAULT_ROOM_SETTINGS = Object.freeze({ drawMinutes: 3, maxPlayers: 6 });

const ID_REGEX = new RegExp(`^\\d{${ROOM_LIMITS.ID_LENGTH}}$`);
const LINK_REGEX = new RegExp(`(?:^|/join/)(\\d{${ROOM_LIMITS.ID_LENGTH}})/?$`);

/** Nội dung "Cách chơi" (tutorial), sinh từ cấu hình thật để luôn đúng luật. */
function buildTutorial(cfg = DEFAULT_CONFIG) {
  const T = (cfg.drawTime + cfg.finalGuessTime) / 60;
  return [
    `Phòng cần tối thiểu ${ROOM_LIMITS.MIN_TO_START} người và tối đa ${ROOM_LIMITS.MAX_CAPACITY} người để bắt đầu. Host chọn thời gian vẽ ${ROOM_LIMITS.TIME_OPTIONS[0]}–${ROOM_LIMITS.TIME_OPTIONS[ROOM_LIMITS.TIME_OPTIONS.length - 1]} phút, mỗi bước 1 phút.`,
    `Mỗi lượt, hệ thống chọn ngẫu nhiên một người chưa vẽ. Mỗi người đúng 1 lượt vẽ; hết lượt của tất cả mọi người thì tổng kết.`,
    'Đáp án phân biệt dấu tiếng Việt: chỉ bỏ hoa/thường và khoảng trắng thừa. Với đáp án “cái gương”, “cai guong” hay “cài gượng” đều bị tính là sai.',
    `Người đoán: P = 10 × (1 − t/T) × (1 − 0.2 × (r−1)/(G−1)); làm tròn 2 chữ số thập phân, trong khoảng 0–10. Trong đó T là tổng thời gian lượt chơi (${T} phút với cấu hình hiện tại: ${Math.round(cfg.drawTime / 60)} phút vẽ + ${Math.round(cfg.finalGuessTime / 60)} phút đoán bonus), t là thời gian đã trôi qua khi server nhận đáp án đúng, r là thứ hạng trả lời đúng, G là tổng số người có quyền đoán.`,
    `Người vẽ: D = (10/G) × Σ(1 − tᵢ/T) lấy theo i = 1..C, với C là số người đoán đúng và tᵢ là thời điểm người thứ i đoán đúng; làm tròn 2 chữ số thập phân, trong khoảng 0–10. Đoán sai 0 điểm, không bị trừ điểm, chỉ khoá ô đoán ${cfg.wrongGuessDelay} giây; nếu không ai đoán đúng thì người vẽ nhận 0 điểm.`,
    'Phân loại điểm mỗi lượt: 0 – dưới 3.5 là Thấp, 3.5 – dưới 7 là Trung bình, 7 – 10 là Cao. Thời gian luôn do server ghi nhận.',
    `Cứ ${cfg.hintInterval} giây hệ thống lộ ngẫu nhiên 1 chữ cái (không tính khoảng trắng), tối đa floor(n/2) chữ.`,
    `Hết giờ vẽ, canvas bị khoá và mọi người có thêm ${Math.round(cfg.finalGuessTime / 60)} phút đoán nốt.`,
    'Chat phòng chờ và chat trong trận tách biệt. Từ khoá bí mật trong chat được tự động che bằng dấu *.',
    `Tố cáo: mỗi phòng tối đa L = max(2, floor(N/2)) lượt/trận. Bình chọn 20 giây, cần tối thiểu 2 phiếu và 2/3 đồng ý. Phạt 15% / 25% / 40% điểm, lần thứ 4 bị loại khỏi phòng.`,
  ];
}

function parseRoomId(input) {
  const s = String(input ?? '').trim();
  const m = s.match(LINK_REGEX);
  return m ? m[1] : null;
}

const fail = (error) => ({ ok: false, error });

function cleanName(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, ROOM_LIMITS.MAX_NAME);
  return n || null;
}

function validateSettings(input = {}, current = DEFAULT_ROOM_SETTINGS) {
  const s = { ...current, ...input };
  const drawMinutes = Number(s.drawMinutes);
  const maxPlayers = Number(s.maxPlayers);
  if (!Number.isInteger(drawMinutes) || !ROOM_LIMITS.TIME_OPTIONS.includes(drawMinutes)) return fail('INVALID_TIME');
  if (!Number.isInteger(maxPlayers) || maxPlayers < ROOM_LIMITS.MIN_CAPACITY || maxPlayers > ROOM_LIMITS.MAX_CAPACITY)
    return fail('INVALID_PLAYER_LIMIT');
  return { ok: true, settings: { drawMinutes, maxPlayers } };
}

class Room {
  constructor(id, hostId, settings) {
    this.id = id;
    this.hostId = hostId;
    this.settings = settings;
    this.game = null;
    this.stayVotes = new Set();
  }
}

class RoomManager {
  /**
   * @param {object} opts
   * @param {string[]} opts.words
   * @param {(roomId:string, event:string, payload:object, toPlayerId?:string|null)=>void} opts.emit
   * @param {object} [opts.engineConfig]
   * @param {string} [opts.baseUrl]
   */
  constructor({ words, emit, clock = Date.now, rng = Math.random, baseUrl = 'http://localhost:3000', engineConfig = {} }) {
    this.words = words;
    this.emitFn = emit;
    this.clock = clock;
    this.rng = rng;
    this.engineConfig = engineConfig;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.rooms = new Map();        // roomId -> Room
    this.playerRoom = new Map();   // playerId -> roomId
    this.socketPlayer = new Map(); // socketId -> playerId
    this.disconnects = new Map();  // playerId -> { deadline, roomId }
  }

  // ----- Truy vấn -----
  playerOf(socketId) { return this.socketPlayer.get(socketId) ?? null; }
  roomOfPlayer(playerId) { return this.rooms.get(this.playerRoom.get(playerId)) ?? null; }
  roomOf(socketOrPlayerId) {
    const playerId = this.socketPlayer.get(socketOrPlayerId) || socketOrPlayerId;
    return this.roomOfPlayer(playerId);
  }

  roomInfo(room) {
    return {
      id: room.id,
      hostId: room.hostId,
      drawMinutes: room.settings.drawMinutes,
      maxPlayers: room.settings.maxPlayers,
      minPlayers: ROOM_LIMITS.MIN_TO_START,
      playerCount: room.game.activePlayers().length,
      connectedCount: room.game.connectedPlayers().length,
      phase: room.game.phase,
      shareLink: this.shareLink(room.id),
      reportLimit: room.game.reportLimit,
      reportsUsed: room.game.reportsUsed,
    };
  }

  shareLink(roomId) { return `${this.baseUrl}/join/${roomId}`; }
  defaultConfig() { return { ...DEFAULT_CONFIG, ...this.engineConfig }; }

  suggestRoomId() {
    for (let i = 0; i < 1000; i++) {
      const lo = 10 ** (ROOM_LIMITS.ID_LENGTH - 1);
      const id = String(lo + Math.floor(this.rng() * 9 * lo));
      if (!this.rooms.has(id)) return id;
    }
    throw new Error('Không tạo được ID phòng');
  }

  /**
   * Tên không được trùng với người chơi ĐANG kết nối. Người mất kết nối (còn giữ chỗ)
   * cho phép người mới nhận lại tên — người cũ tự động đổi tên nhãn để không trùng hiển thị.
   */
  nameHolders(name, exceptPlayerId = null) {
    const n = normalize(name);
    if (!n) return { conflict: true, holders: [] };
    const holders = [];
    for (const room of this.rooms.values()) {
      for (const p of room.game.players.values()) {
        if (p.left || p.id === exceptPlayerId) continue;
        if (normalize(p.name) === n) holders.push({ p, room });
      }
    }
    return { conflict: holders.some(h => h.p.connected), holders };
  }

  isNameTaken(name, exceptPlayerId = null) {
    return this.nameHolders(name, exceptPlayerId).conflict;
  }

  /** Người mới nhận tên của người mất kết nối: đổi tên nhãn người cũ thành `Tên #2`, `#3`... */
  freeUpName(name) {
    const { conflict, holders } = this.nameHolders(name);
    if (conflict) return fail('NAME_TAKEN');
    for (const holder of holders) {
      if (holder.p.connected) continue; // an toàn: chỉ người đang mất kết nối
      const base = holder.p.name;
      const taken = [...holder.room.game.players.values()].map(p => p.name);
      let i = 2;
      let candidate;
      do { candidate = `${base} #${i}`; i += 1; } while (taken.some(t => normalize(t) === normalize(candidate)));
      holder.room.game.renamePlayer(holder.p.id, candidate, `một người chơi khác đã nhận tên “${base}”`);
    }
    return { ok: true, freed: holders.length };
  }

  newPlayerId() { return `p_${randomUUID()}`; }

  bindSocket(socketId, playerId) { this.socketPlayer.set(socketId, playerId); }

  // ----- Tạo phòng -----
  createRoom(socketId, name, settings = {}, preferredId = null) {
    if (this.socketPlayer.has(socketId)) return fail('ALREADY_IN_ROOM');
    const nm = cleanName(name);
    if (!nm) return fail('INVALID_NAME');
    // Người chỉ bị chặn bởi người chơi đang kết nối; người mất kết nối (giữ chỗ 30s)
    // có thể bị người khác nhận lại tên — họ sẽ tự đổi tên nhãn.
    const freed = this.freeUpName(nm);
    if (!freed.ok) return freed;
    const v = validateSettings(settings);
    if (!v.ok) return v;

    const wanted = preferredId != null ? parseRoomId(preferredId) : null;
    const id = wanted && !this.rooms.has(wanted) ? wanted : this.suggestRoomId();
    const playerId = this.newPlayerId();

    const room = new Room(id, playerId, v.settings);
    room.game = new GarticGame({
      words: this.words,
      emit: (event, payload, to) => this.emitFn(id, event, payload, to),
      config: { drawTime: v.settings.drawMinutes * 60, ...this.engineConfig },
      clock: this.clock,
      rng: this.rng,
      getHostId: () => room.hostId,
      onPlayerRemoved: (pid) => this.finalizeLeave(pid, 'report'),
    });
    this.rooms.set(id, room);
    this.playerRoom.set(playerId, id);
    this.bindSocket(socketId, playerId);
    room.game.addPlayer(playerId, nm);

    const info = this.roomInfo(room);
    this.emitFn(id, 'room_created', { room: info }, playerId);
    return { ok: true, room: info, playerId, token: playerId };
  }

  updateSettings(playerId, input) {
    const room = this.roomOfPlayer(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.game.phase !== Phase.LOBBY) return fail('ALREADY_STARTED');
    const v = validateSettings(input, room.settings);
    if (!v.ok) return v;
    if (v.settings.maxPlayers < room.game.activePlayers().length) return fail('INVALID_PLAYER_LIMIT');
    room.settings = v.settings;
    room.game.setConfig({ drawTime: v.settings.drawMinutes * 60, ...this.engineConfig });
    this.emitFn(room.id, 'settings_updated', { room: this.roomInfo(room) }, null);
    return { ok: true, room: this.roomInfo(room) };
  }

  // ----- Vào phòng -----
  joinRoom(roomId, socketId, name) {
    if (this.socketPlayer.has(socketId)) return fail('ALREADY_IN_ROOM');
    const nm = cleanName(name);
    if (!nm) return fail('INVALID_NAME');
    const freed = this.freeUpName(nm);
    if (!freed.ok) return freed;
    const id = parseRoomId(roomId);
    if (!id) return fail('INVALID_ID');
    const room = this.rooms.get(id);
    if (!room) return fail('ROOM_NOT_FOUND');
    if (room.game.phase !== Phase.LOBBY) return fail('ROOM_IN_PROGRESS');
    if (room.game.activePlayers().length >= room.settings.maxPlayers) return fail('ROOM_FULL');

    const playerId = this.newPlayerId();
    this.playerRoom.set(playerId, id);
    this.bindSocket(socketId, playerId);
    room.game.addPlayer(playerId, nm);
    return { ok: true, room: this.roomInfo(room), playerId, token: playerId };
  }

  /** Khôi phục phiên sau khi mất mạng (trong 30 giây). */
  resumeSession(socketId, token) {
    const playerId = String(token ?? '');
    const room = this.roomOfPlayer(playerId);
    if (!room) return fail('SESSION_NOT_FOUND');
    const player = room.game.players.get(playerId);
    if (!player || player.left) return fail('SESSION_NOT_FOUND');

    // Một người chơi chỉ ứng với một socket mới nhất (tránh tab cũ làm mất kết nối oan).
    const replacedSocketIds = [];
    this.socketPlayer.forEach((pid, sid) => {
      if (pid === playerId && sid !== socketId) {
        replacedSocketIds.push(sid);
        this.socketPlayer.delete(sid);
      }
    });
    this.bindSocket(socketId, playerId);
    this.disconnects.delete(playerId);
    room.game.markReconnected(playerId);
    return {
      ok: true,
      room: this.roomInfo(room),
      playerId,
      token: playerId,
      replacedSocketIds,
      snapshot: room.game.snapshotFor(playerId),
    };
  }

  // ----- Mất kết nối / rời phòng -----
  handleDisconnect(socketId) {
    const playerId = this.socketPlayer.get(socketId);
    if (!playerId) return { ok: false };
    this.socketPlayer.delete(socketId);
    const room = this.roomOfPlayer(playerId);
    if (!room) return { ok: false };

    // Mọi giai đoạn đều giữ chỗ 30 giây để người chơi tải lại trang / mất mạng có thể quay lại.
    // Chỉ sau khi hết hạn mới rời hẳn và chuyển host.
    room.game.markDisconnected(playerId);
    this.disconnects.set(playerId, {
      roomId: room.id,
      deadline: this.clock() + ROOM_LIMITS.RECONNECT_GRACE_MS,
    });
    return { ok: true, graceMs: ROOM_LIMITS.RECONNECT_GRACE_MS };
  }

  /** Rời hẳn: chuyển host ngẫu nhiên, xoá phòng nếu hết người. */
  finalizeLeave(playerId, reason = 'leave') {
    const room = this.roomOfPlayer(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    const player = room.game.players.get(playerId);
    const wasHost = room.hostId === playerId;
    const remaining = room.game.activePlayers().filter(p => p.id !== playerId);

    if (wasHost && remaining.length > 0) {
      // Ưu tiên người đang kết nối; nếu tất cả đều mất kết nối thì vẫn chọn ngẫu nhiên.
      const connected = remaining.filter(p => p.connected);
      const pool = connected.length ? connected : remaining;
      const next = pool[Math.floor(this.rng() * pool.length)];
      room.hostId = next.id; // đổi host TRƯỚC để sự kiện sau mang cờ isHost đúng
    }

    room.game.removePlayer(playerId);
    this.playerRoom.delete(playerId);
    this.socketPlayer.forEach((pid, sid) => { if (pid === playerId) this.socketPlayer.delete(sid); });
    this.disconnects.delete(playerId);
    room.stayVotes.delete(playerId);

    // Người bị loại do tố cáo vẫn đang kết nối: đưa họ ra khỏi phòng và về trang chủ.
    if (reason === 'report') {
      this.emitFn(room.id, 'player_kicked', { playerId, name: player?.name ?? '' }, null);
    }

    if (remaining.length === 0) {
      this.rooms.delete(room.id);
      return { ok: true, closed: true, reason, name: player?.name };
    }
    if (wasHost) {
      const kenh = room.game.phase === Phase.LOBBY || room.game.phase === Phase.GAME_END ? 'lobby' : 'game';
      this.emitFn(room.id, 'host_changed', {
        hostId: room.hostId,
        hostName: room.game.players.get(room.hostId)?.name,
        kenh,
        players: room.game.publicPlayers(),
        reason,
      }, null);
    }
    return { ok: true, closed: false, newHostId: wasHost ? room.hostId : undefined, reason, name: player?.name };
  }

  leaveRoom(playerId) { return this.finalizeLeave(playerId, 'leave'); }

  // ----- Phòng chờ -----
  /** Xoá mapping của những người đã bị game loại khỏi phòng (ví dụ lúc bắt đầu trận). */
  cleanupStalePlayers(room) {
    for (const [pid, rid] of [...this.playerRoom]) {
      if (rid === room.id && !room.game.players.has(pid)) {
        this.playerRoom.delete(pid);
        this.disconnects.delete(pid);
      }
    }
  }

  startGame(playerId) {
    const room = this.roomOfPlayer(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.hostId !== playerId) return fail('NOT_HOST');
    if (room.game.phase !== Phase.LOBBY) return fail('ALREADY_STARTED');
    const count = room.game.connectedPlayers().length;
    if (count < ROOM_LIMITS.MIN_TO_START) return fail('NOT_ENOUGH_PLAYERS');
    if (count > room.settings.maxPlayers) return fail('TOO_MANY_PLAYERS');
    room.stayVotes.clear();
    if (!room.game.start()) return fail('CANNOT_START');
    this.cleanupStalePlayers(room);
    return { ok: true };
  }

  continueRoom(playerId) {
    const room = this.roomOfPlayer(playerId);
    if (!room) return fail('NOT_IN_ROOM');
    if (room.game.phase !== Phase.GAME_END) return fail('NOT_AT_RESULTS');
    if (room.hostId === playerId) {
      room.stayVotes.clear();
      room.game.returnToLobby();
      this.cleanupStalePlayers(room);
      // Gửi cả danh sách người chơi: returnToLobby vừa xoá người bỏ đi (bóng ma),
      // client cần danh sách mới ngay để nút "Bắt đầu" đếm đúng.
      this.emitFn(room.id, 'room_continued', { room: this.roomInfo(room), players: room.game.publicPlayers() }, null);
      return { ok: true, phase: Phase.LOBBY };
    }
    room.stayVotes.add(playerId);
    this.emitFn(room.id, 'player_staying', { playerId, stayCount: room.stayVotes.size }, null);
    return { ok: true, phase: Phase.GAME_END };
  }

  // ----- Delegate sang game -----
  getSnapshot(playerId) {
    const room = this.roomOfPlayer(playerId);
    if (!room) return null;
    return {
      ...room.game.snapshotFor(playerId),
      roomId: room.id,
      hostId: room.hostId,
      settings: room.settings,
      room: this.roomInfo(room),
    };
  }

  sendChat(playerId, text) { const r = this.roomOfPlayer(playerId); return r ? r.game.sendChat(playerId, text) : fail('NOT_IN_ROOM'); }
  submitGuess(playerId, text) { const r = this.roomOfPlayer(playerId); return r ? r.game.submitGuess(playerId, text) : fail('NOT_IN_ROOM'); }
  beginStroke(playerId, stroke) { const r = this.roomOfPlayer(playerId); return r ? r.game.beginStroke(playerId, stroke) : false; }
  appendStrokePoints(playerId, id, points) { const r = this.roomOfPlayer(playerId); return r ? r.game.appendStrokePoints(playerId, id, points) : false; }
  endStroke(playerId, id) { const r = this.roomOfPlayer(playerId); return r ? r.game.endStroke(playerId, id) : false; }
  undoStroke(playerId) { const r = this.roomOfPlayer(playerId); return r ? r.game.undoStroke(playerId) : false; }
  redoStroke(playerId) { const r = this.roomOfPlayer(playerId); return r ? r.game.redoStroke(playerId) : false; }
  clearCanvas(playerId) { const r = this.roomOfPlayer(playerId); return r ? r.game.clearCanvas(playerId) : false; }
  createReport(playerId, targetId, reason) { const r = this.roomOfPlayer(playerId); return r ? r.game.createReport(playerId, targetId, reason) : fail('NOT_IN_ROOM'); }
  voteReport(playerId, reportId, agree) { const r = this.roomOfPlayer(playerId); return r ? r.game.voteReport(playerId, reportId, agree) : fail('NOT_IN_ROOM'); }

  /** Gọi định kỳ: chạy timer game + xử lý người quá hạn giữ chỗ. */
  tick() {
    const now = this.clock();
    for (const room of this.rooms.values()) room.game.tick();
    for (const [playerId, info] of [...this.disconnects]) {
      if (now >= info.deadline) {
        this.disconnects.delete(playerId);
        this.finalizeLeave(playerId, 'timeout');
      }
    }
    // KHÔNG dọn playerRoom sớm ở GAME_END: người mất kết nối ở màn hình tổng kết
    // vẫn phải được giữ chỗ 30 giây để reconnect (deadline nằm ở `disconnects`).
  }
}

module.exports = {
  RoomManager, Room, ROOM_LIMITS, DEFAULT_ROOM_SETTINGS,
  buildTutorial, parseRoomId, validateSettings, cleanName,
};
