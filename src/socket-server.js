'use strict';
// socket-server.js — Nối RoomManager (logic game) với Socket.IO.
// Server là nguồn sự thật duy nhất: client không tự quyết định quyền vẽ, đáp án hay điểm số.

const { RoomManager, buildTutorial, ROOM_LIMITS } = require('./gartic-room');
const { WORDS } = require('./words');
const { REPORT_REASONS } = require('./gartic-game');

const ERROR_TEXT = {
  INVALID_NAME: 'Bạn hãy nhập tên trước nhé!',
  INVALID_ID: 'Mã phòng phải gồm đúng 6 chữ số.',
  INVALID_TIME: 'Thời gian vẽ phải từ 1 đến 6 phút.',
  INVALID_PLAYER_LIMIT: 'Số người phải từ 3 đến 10 (và không nhỏ hơn số người đang trong phòng).',
  ALREADY_IN_ROOM: 'Bạn đang ở trong một phòng rồi.',
  ROOM_NOT_FOUND: 'Không tìm thấy phòng này.',
  ROOM_FULL: 'Phòng đã đủ người.',
  ROOM_IN_PROGRESS: 'Phòng đã bắt đầu chơi, không thể vào lúc này.',
  NAME_TAKEN: 'Tên này đã có người dùng, hãy chọn tên khác.',
  NOT_IN_ROOM: 'Bạn chưa ở trong phòng nào.',
  NOT_HOST: 'Chỉ chủ phòng mới làm được việc này.',
  NOT_ENOUGH_PLAYERS: 'Cần ít nhất 3 người để bắt đầu.',
  TOO_MANY_PLAYERS: 'Phòng đã vượt quá số người tối đa.',
  ALREADY_STARTED: 'Trận đấu đã bắt đầu rồi.',
  NOT_AT_RESULTS: 'Chưa ở màn hình tổng kết.',
  CANNOT_START: 'Không thể bắt đầu trận đấu.',
  SESSION_NOT_FOUND: 'Không tìm thấy phiên chơi để khôi phục.',
  NOT_IN_GAME: 'Chỉ có thể tố cáo trong lúc chơi.',
  INVALID_TARGET: 'Người bị tố cáo không hợp lệ.',
  INVALID_REASON: 'Lý do tố cáo không hợp lệ.',
  REPORT_LIMIT: 'Phòng đã dùng hết số lượt tố cáo của trận này.',
  VOTE_ACTIVE: 'Đang có một cuộc bình chọn khác.',
  ALREADY_REPORTED_THIS_TURN: 'Mỗi người chỉ được tố cáo 1 lần trong một lượt.',
  NOT_ENOUGH_VOTERS: 'Không đủ người để bình chọn.',
  NO_VOTE: 'Cuộc bình chọn không còn tồn tại.',
  NOT_ELIGIBLE: 'Bạn không được bỏ phiếu trong cuộc bình chọn này.',
  ALREADY_VOTED: 'Bạn đã bỏ phiếu rồi.',
  NO_PLAYER: 'Không tìm thấy người chơi.',
  NOT_GUESSING_PHASE: 'Chưa đến lúc đoán.',
  IS_DRAWER: 'Bạn là người vẽ, không thể đoán.',
  ALREADY_SOLVED: 'Bạn đã đoán đúng rồi.',
  COOLDOWN: 'Bạn vừa đoán sai, chờ một chút rồi thử lại.',
  INVALID_TEXT: 'Nội dung không hợp lệ.',
};
const errorOf = (code) => ({ ok: false, ma: code, thongBao: ERROR_TEXT[code] || 'Có lỗi xảy ra.' });

// Snapshot từ engine dùng nhãn tiếng Anh (name/score...) — phải đổi về nhãn view
// giống các sự kiện, nếu không client khôi phục phiên sẽ hiển thị "undefined".
const viewSnapshot = (snap) => {
  if (!snap) return snap;
  return { ...snap, players: Array.isArray(snap.players) ? viewPlayers(snap.players) : snap.players };
};

// ----- View model gửi cho client -----
const viewPlayer = (p) => ({
  id: p.id, ten: p.name, diem: p.score,
  laChuPhong: p.isHost, laNguoiVe: p.isDrawer, daDoanDung: p.solved, daVe: p.hasDrawn,
  ngatKetNoi: !p.connected, daRoi: p.left,
  viPham: p.violations, daToCaoLuotNay: p.reportedThisTurn,
});
const viewPlayers = (list) => list.map(viewPlayer);
const viewRoom = (r) => ({
  idPhong: r.id, chuPhongId: r.hostId, thoiGianPhut: r.drawMinutes,
  soNguoiToiDa: r.maxPlayers, soNguoiToiThieu: r.minPlayers, soNguoiHienTai: r.playerCount,
  gioiHanToCao: r.reportLimit, soToCaoDaDung: r.reportsUsed,
});

function makeEmitter(io, clock = Date.now) {
  const remaining = (deadline) => Math.max(0, deadline - clock());
  const sys = (roomId, text, kenh = 'game') =>
    io.to(roomId).emit('tin_nhan_tu_server', { loai: 'he_thong', noiDungChat: text, kenh });
  const sendPlayers = (roomId, list) => io.to(roomId).emit('cap_nhat_danh_sach_nguoi_choi', viewPlayers(list));
  const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

  return function emit(roomId, event, p, to) {
    switch (event) {
      case 'player_joined':
        sendPlayers(roomId, p.players);
        sys(roomId, `👋 ${p.name} đã vào phòng.`, 'lobby');
        break;
      case 'player_left':
        sendPlayers(roomId, p.players);
        sys(roomId, `🚪 ${p.name} đã rời phòng.${p.scoreZero ? ' Điểm của người này được tính là 0.' : ''}`, p.kenh || 'game');
        break;
      case 'player_connection':
        sendPlayers(roomId, p.players);
        sys(roomId, p.connected
          ? `🔄 ${p.name} đã kết nối lại.`
          : `📡 ${p.name} mất kết nối — giữ chỗ ${Math.round(ROOM_LIMITS.RECONNECT_GRACE_MS / 1000)} giây.`, p.kenh || 'game');
        break;
      case 'player_renamed':
        sendPlayers(roomId, p.players);
        sys(roomId, p.note ? `ℹ️ ${p.note}. “${p.oldName}” giờ hiển thị là “${p.name}”.` : `ℹ️ “${p.oldName}” giờ hiển thị là “${p.name}”.`, p.kenh || 'lobby');
        break;
      case 'host_changed':
        sendPlayers(roomId, p.players);
        sys(roomId, `👑 ${p.hostName} là chủ phòng mới.`, p.kenh || 'lobby');
        io.to(roomId).emit('chu_phong_moi', { chuPhongId: p.hostId, ten: p.hostName });
        break;
      case 'game_started':
      case 'scores_updated':
        sendPlayers(roomId, p.players);
        if (event === 'game_started') io.to(roomId).emit('bat_dau_tran', { reportLimit: p.reportLimit });
        break;
      case 'settings_updated':
        io.to(roomId).emit('phong_cap_nhat', viewRoom(p.room));
        break;
      case 'chat_cleared':
        io.to(roomId).emit('xoa_lich_su_chat', { kenh: p.kenh });
        break;

      case 'drawing_started': {
        const drawer = p.players.find(x => x.id === p.drawerId);
        io.to(roomId).emit('draw:clear');
        for (const pl of p.players) {
          if (!pl.connected) continue;
          io.to(pl.id).emit('chuyen_luot_ve', {
            vaiTro: pl.id === p.drawerId ? 'nguoi_ve' : 'nguoi_doan',
            tenNguoiVe: drawer ? drawer.name : '',
            goiY: p.hint,
            luot: p.turnNo,
            conLaiMs: remaining(p.deadline),
            conLaiVeMs: remaining(p.drawDeadline),
            doDaiTu: p.wordLength,
          });
        }
        sendPlayers(roomId, p.players);
        break;
      }
      case 'word_assigned':
        io.to(to).emit('tu_khoa', { tuKhoa: p.word });
        break;
      case 'hint':
        io.to(roomId).emit('goi_y_tu_khoa', {
          goiY: p.hint, viTri: p.viTri, chuCai: p.chuCai, soGoiY: p.soGoiY, toiDaGoiY: p.toiDaGoiY,
        });
        break;
      case 'final_guess_started':
        io.to(roomId).emit('doan_cuoi', { goiY: p.hint, conLaiMs: remaining(p.deadline) });
        sys(roomId, '⏰ Hết giờ vẽ! Canvas đã khoá — mọi người có thêm 60 giây để đoán nốt.');
        break;

      // Đồng bộ nét vẽ trực tiếp trong lúc kéo chuột.
      case 'draw:start':
        io.to(roomId).except(p.from).emit('draw:stroke-start', p.stroke);
        break;
      case 'draw:points':
        io.to(roomId).except(p.from).emit('draw:stroke-points', { id: p.id, points: p.points });
        break;
      case 'draw:end':
        io.to(roomId).except(p.from).emit('draw:stroke-end', { id: p.id });
        break;
      case 'draw:undo':
        io.to(roomId).except(p.from).emit('draw:undo', { id: p.id });
        break;
      case 'draw:redo':
        io.to(roomId).except(p.from).emit('draw:redo', { stroke: p.stroke });
        break;
      case 'canvas_cleared':
        io.to(roomId).except(p.from).emit('draw:clear');
        break;

      case 'chat':
        io.to(roomId).emit('tin_nhan_tu_server', {
          loai: 'chat', tenNguoiDung: p.name, noiDungChat: p.text, kenh: p.kenh,
        });
        break;
      case 'guess_correct':
        io.to(roomId).emit('doan_dung', {
          id: p.playerId, ten: p.name, diem: p.points, soNguoiDung: p.solvedCount, tongNguoiDoan: p.guessers,
        });
        sys(roomId, `🎉 ${p.name} đã đoán đúng! (${fmt(p.points)} điểm)`);
        sendPlayers(roomId, p.scores);
        break;
      case 'guess_wrong':
        io.to(to).emit('doan_sai', { conLaiMs: remaining(p.cooldownUntil), soLan: p.attempts });
        break;
      case 'guess_rejected':
        io.to(to).emit('doan_bi_chan', { lyDo: p.reason, conLaiMs: p.remainingMs ?? 0 });
        break;

      case 'turn_ended': {
        const gains = p.gains.map(g => `${g.name} ${fmt(g.delta)}`).join(', ') || 'không ai ghi điểm';
        const why = { all_guessed: 'Mọi người đã đoán đúng!', timeout: 'Hết giờ!', drawer_left: 'Người vẽ đã rời phòng.' }[p.reason] || '';
        io.to(roomId).emit('ket_thuc_luot', {
          luot: p.turnNo, tuKhoa: p.word, lyDo: p.reason, diemLuot: p.gains,
          diemNguoiVe: p.drawerPoints, conLaiMs: remaining(p.deadline),
        });
        if (p.word) sys(roomId, `✅ ${why} Từ khoá là “${p.word}”. Điểm lượt: ${gains}.`);
        else sys(roomId, `${why} Lượt bị huỷ.`);
        sendPlayers(roomId, p.scores);
        break;
      }
      case 'game_ended':
        io.to(roomId).emit('ket_thuc_game_dau', {
          lyDo: p.reason,
          cacLuot: p.turns.map(t => ({ luot: t.no, nguoiVe: t.drawerName, tuKhoa: t.word, lyDo: t.reason })),
          bangDiemFinal: p.ranking.map(r => ({
            id: r.id, ten: r.name, diem: r.score, hang: r.rank, diemTheoLuot: r.perTurn,
            ngatKetNoi: !r.connected, daRoi: r.left, viPham: r.violations,
          })),
        });
        break;
      case 'lobby_reset':
        sendPlayers(roomId, p.players);
        break;
      case 'room_continued':
        if (Array.isArray(p.players)) sendPlayers(roomId, p.players);
        io.to(roomId).emit('ve_phong_cho', viewRoom(p.room));
        break;
      case 'player_staying':
        io.to(roomId).emit('nguoi_choi_o_lai', { id: p.playerId, soNguoi: p.stayCount });
        break;
      case 'player_kicked':
        io.to(p.playerId).emit('bi_loai', {
          thongBao: 'Bạn đã bị loại khỏi phòng do nhận đủ số phiếu tố cáo vi phạm.',
        });
        io.in(p.playerId).socketsLeave(roomId);
        io.in(p.playerId).socketsLeave(p.playerId);
        break;

      case 'report_started':
        io.to(roomId).emit('to_cao_bat_dau', { ...p, conLaiMs: remaining(p.deadline) });
        sys(roomId, `🚨 ${p.reporterName} đã tố cáo ${p.targetName} — lý do: ${p.reasonText}. Bình chọn trong 20 giây.`);
        break;
      case 'report_vote_updated':
        io.to(roomId).emit('to_cao_cap_nhat', { ...p, conLaiMs: remaining(p.deadline) });
        break;
      case 'report_result':
        io.to(roomId).emit('to_cao_ket_qua', p);
        if (p.huy) {
          sys(roomId, 'ℹ️ Cuộc bình chọn tố cáo đã kết thúc.');
        } else if (p.success) {
          sys(roomId, p.removed
            ? `⚖️ Tố cáo ${p.targetName} thành công lần ${p.violations} — người chơi bị loại khỏi phòng.`
            : `⚖️ Tố cáo ${p.targetName} thành công — trừ ${p.penalty} điểm (${p.violations} lần vi phạm).`);
        } else {
          sys(roomId, `⚖️ Tố cáo ${p.targetName} không đủ phiếu — không trừ điểm.`);
        }
        if (Array.isArray(p.scores)) sendPlayers(roomId, p.scores);
        break;
      case 'report_error':
        io.to(to).emit('to_cao_loi', { thongBao: ERROR_TEXT[p.reason] || 'Không thể tố cáo.' });
        break;
      default:
        break;
    }
  };
}

function registerSocket(socket, manager) {
  const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };
  const playerIdOf = () => manager.playerOf(socket.id);
  const playersOf = () => {
    const r = manager.roomOfPlayer(playerIdOf());
    return r ? viewPlayers(r.game.publicPlayers()) : [];
  };

  socket.on('xin_ma_phong', (ack) => reply(ack, { ok: true, idPhong: manager.suggestRoomId() }));
  socket.on('xin_luat_choi', (ack) => reply(ack, { ok: true, luat: buildTutorial(manager.defaultConfig()) }));

  socket.on('tao_phong', (data, ack) => {
    data = data || {};
    const r = manager.createRoom(
      socket.id, data.tenNguoiChon,
      { drawMinutes: Number(data.thoiGianPhut), maxPlayers: Number(data.soNguoiToiDa) },
      data.idGoiY,
    );
    if (!r.ok) return reply(ack, errorOf(r.error));
    socket.join(r.room.id);
    socket.join(r.playerId); // phòng riêng để server gửi vai trò / từ khoá / lỗi đoán
    reply(ack, { ok: true, phong: viewRoom(r.room), nguoiChoi: playersOf(), token: r.token });
  });

  socket.on('tham_gia_phong', (data, ack) => {
    data = data || {};
    const r = manager.joinRoom(data.idPhong, socket.id, data.tenNguoiChon);
    if (!r.ok) return reply(ack, errorOf(r.error));
    socket.join(r.room.id);
    socket.join(r.playerId);
    reply(ack, { ok: true, phong: viewRoom(r.room), nguoiChoi: playersOf(), token: r.token });
  });

  socket.on('khoi_phuc_phien', (data, ack) => {
    data = data || {};
    const r = manager.resumeSession(socket.id, data.token);
    if (!r.ok) return reply(ack, errorOf(r.error));
    // Đóng tab / socket cũ của cùng phiên để tránh hai nơi cùng điều khiển một người chơi.
    // Phải THÔNG BÁO trước khi ngắt, nếu không tab cũ với chế độ tự động kết nối lại
    // sẽ resume lại và "đánh cắp" phiên ngược lại → hai tab tranh nhau vô hạn.
    for (const sid of r.replacedSocketIds || []) {
      const old = socket.nsp.sockets.get(sid);
      if (old && old.id !== socket.id) {
        old.emit('phien_da_thay_the', { thongBao: 'Phiên của bạn vừa được khôi phục ở nơi khác. Tab này sẽ trở về trang chủ.' });
        old.leave(r.room.id);
        old.leave(r.playerId);
        old.disconnect(true);
      }
    }
    socket.join(r.room.id);
    socket.join(r.playerId);
    const snapshot = viewSnapshot(r.snapshot);
    reply(ack, {
      ok: true, phong: viewRoom(r.room), nguoiChoi: playersOf(),
      token: r.token, snapshot,
    });
    socket.emit('khoi_phuc_thanh_cong', { phong: viewRoom(r.room), snapshot });
  });

  socket.on('cap_nhat_cai_dat', (data, ack) => {
    data = data || {};
    const playerId = playerIdOf();
    const r = manager.updateSettings(playerId, { drawMinutes: Number(data.thoiGianPhut), maxPlayers: Number(data.soNguoiToiDa) });
    reply(ack, r.ok ? { ok: true, phong: viewRoom(r.room) } : errorOf(r.error));
  });

  // Chat riêng (không phải ô đoán).
  const onChat = (data) => {
    const playerId = playerIdOf();
    if (!playerId) return;
    const r = manager.sendChat(playerId, data && data.noiDungChat);
    if (!r.ok) socket.emit('loi_he_thong', errorOf(r.reason));
  };
  socket.on('tin_nhan_chat', onChat);
  socket.on('tin_nhan_tu_client', onChat); // tương thích client cũ

  // Ô đoán từ khoá riêng.
  socket.on('doan_tu_khoa', (data, ack) => {
    const playerId = playerIdOf();
    if (!playerId) return reply(ack, errorOf('NOT_IN_ROOM'));
    const r = manager.submitGuess(playerId, data && data.noiDung);
    if (!r.ok) {
      if (r.reason === 'COOLDOWN') return reply(ack, { ok: false, ma: r.reason, conLaiMs: r.remainingMs });
      return reply(ack, errorOf(r.reason));
    }
    reply(ack, r);
  });

  socket.on('bat_dau_tran_dau', (ack) => {
    const r = manager.startGame(playerIdOf());
    if (!r.ok) {
      const e = errorOf(r.error);
      socket.emit('loi_he_thong', e);
      return reply(ack, e);
    }
    reply(ack, { ok: true });
  });

  socket.on('draw:stroke-start', (stroke) => { manager.beginStroke(playerIdOf(), stroke); });
  socket.on('draw:stroke-points', (data) => {
    data = data || {};
    manager.appendStrokePoints(playerIdOf(), data.id, data.points);
  });
  socket.on('draw:stroke-end', (data) => { manager.endStroke(playerIdOf(), data && data.id); });
  socket.on('draw:undo', () => { manager.undoStroke(playerIdOf()); });
  socket.on('draw:redo', () => { manager.redoStroke(playerIdOf()); });
  socket.on('draw:clear', () => { manager.clearCanvas(playerIdOf()); });

  socket.on('tao_to_cao', (data, ack) => {
    data = data || {};
    const r = manager.createReport(playerIdOf(), data.targetId, data.lyDo);
    if (!r.ok) {
      socket.emit('to_cao_loi', { thongBao: ERROR_TEXT[r.reason] || 'Không thể tố cáo.' });
      return reply(ack, errorOf(r.reason));
    }
    reply(ack, { ok: true, voteId: r.voteId });
  });

  socket.on('bo_phieu_to_cao', (data, ack) => {
    data = data || {};
    const r = manager.voteReport(playerIdOf(), data.reportId, Boolean(data.dongY));
    if (!r.ok) {
      socket.emit('to_cao_loi', { thongBao: ERROR_TEXT[r.reason] || 'Không thể bỏ phiếu.' });
      return reply(ack, errorOf(r.reason));
    }
    reply(ack, { ok: true });
  });

  socket.on('yeu_cau_choi_tiep', (ack) => {
    const r = manager.continueRoom(playerIdOf());
    reply(ack, r.ok ? { ok: true, host: r.phase === 'LOBBY' } : errorOf(r.error));
  });

  socket.on('roi_phong', (ack) => {
    const playerId = playerIdOf();
    const room = manager.roomOfPlayer(playerId);
    const r = manager.leaveRoom(playerId);
    if (room) socket.leave(room.id);
    if (playerId) socket.leave(playerId);
    reply(ack, r.ok ? { ok: true } : errorOf(r.error));
  });

  socket.on('disconnect', () => { manager.handleDisconnect(socket.id); });
}

function setupGame(io, opts = {}) {
  const clock = opts.clock || Date.now;
  const manager = new RoomManager({
    words: opts.words || WORDS,
    emit: makeEmitter(io, clock),
    clock,
    rng: opts.rng || Math.random,
    engineConfig: opts.engineConfig || {},
    baseUrl: opts.baseUrl,
  });
  io.on('connection', (socket) => registerSocket(socket, manager));
  // Tick nhanh hơn → đặt/hết giờ, mở lượt, kết thúc lượt chính xác gần như tức thời.
  const timer = setInterval(() => manager.tick(), opts.tickMs || 100);
  if (timer.unref) timer.unref();

  const TIMED = new Set(['DRAWING', 'FINAL_GUESS', 'TURN_END']);
  // Đồng hồ 250ms/lần thay vì 1000ms: đếm ngược trên client mượt và tự hiệu chỉnh sớm hơn.
  const clockTimer = setInterval(() => {
    for (const room of manager.rooms.values()) {
      const g = room.game;
      if (!TIMED.has(g.phase)) continue;
      io.to(room.id).emit('dong_ho', { pha: g.phase, conLaiMs: Math.max(0, g.deadline - clock()) });
    }
  }, opts.clockMs || 250);
  if (clockTimer.unref) clockTimer.unref();

  return { manager, close: () => { clearInterval(timer); clearInterval(clockTimer); } };
}

module.exports = {
  setupGame, makeEmitter, registerSocket, viewPlayer, viewRoom, ERROR_TEXT, REPORT_REASONS,
};
