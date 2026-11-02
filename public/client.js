'use strict';

// ============================================================================
// Đoán Chữ Thần Tốc — client
// Server là nguồn sự thật. Client chỉ hiển thị và gửi thao tác.
// ============================================================================

const socket = io({
  transports: ['websocket'],
  reconnection: true,
  timeout: 10000,
  // Thử kết nối lại dồn dập: 200ms đầu, tối đa 1s giữa hai lần thử
  // → khôi phục tài khoản gần như tức thời sau khi mạng trở lại.
  reconnectionDelay: 200,
  reconnectionDelayMax: 1000,
  randomizationFactor: 0.2,
});

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

// ----- Trang -----
const page1 = $('page1');
const page2 = $('page2');
const page3 = $('page3');
const manHinhTranDau = $('manHinhTranDau');
const manHinhKetQua = $('manHinhKetQua');
const PAGES = [page1, page2, page3, manHinhTranDau, manHinhKetQua];

// ----- Đăng nhập / tạo phòng -----
const usernameInput = $('username');
const roomCodeField = $('roomCodeField');
const roomCodeInput = $('roomCode');
const createBtn = $('createBtn');
const joinBtn = $('joinBtn');
const backToHomeBtn = $('backToHomeBtn');
const generatedRoomId = $('generatedRoomId');
const timeSlider = $('timeSlider');
const timeVal = $('timeVal');
const maxPlayersSlider = $('maxPlayersSlider');
const maxPlayersVal = $('maxPlayersVal');
const finalCreateBtn = $('finalCreateBtn');

// ----- Lobby -----
const roomDisplayId = $('roomDisplayId');
const roomMetaTime = $('roomMetaTime');
const roomMetaPlayers = $('roomMetaPlayers');
const playerList = $('playerList');
const playerCountLabel = $('playerCountLabel');
const chatBox = $('chatBox');
const chatInput = $('chatInput');
const sendChatBtn = $('sendChatBtn');
const leaveBtn = $('leaveBtn');
const shareBtn = $('shareBtn');
const startGameBtn = $('startGameBtn');
const hostSettings = $('hostSettings');
const hostTimeSlider = $('hostTimeSlider');
const hostTimeVal = $('hostTimeVal');
const hostMaxPlayersSlider = $('hostMaxPlayersSlider');
const hostMaxPlayersVal = $('hostMaxPlayersVal');

// ----- Game -----
const vaiTroHienTai = $('vaiTroHienTai');
const turnLabel = $('turnLabel');
const hienThiTuKhoa = $('hienThiTuKhoa');
const nhanDongHo = $('nhanDongHo');
const dongHoDemNguoc = $('dongHoDemNguoc');
const bangDiemTran = $('bangDiemTran');
const chatBoxTran = $('chatBoxTran');
const inputChat = $('inputChat');
const btnGuiChat = $('btnGuiChat');
const inputDoan = $('inputDoan');
const btnGuiDoan = $('btnGuiDoan');
const guessStatus = $('guessStatus');
const khungVe = $('khungVe');
const lopPhuLuot = $('lopPhuLuot');
const reportBtn = $('reportBtn');
const reportInfo = $('reportInfo');

// ----- Kết quả -----
const resultNote = $('resultNote');
const tbodyKetQua = $('bangDiemChungCuocBody');
const btnTiepTuc = $('btnChoiTiep');
const btnVeDau = $('btnTroVe');
const ghiChuChoiTiep = $('ghiChuChoiTiep');

// ----- Modal / toast -----
const tutorialBtn = $('tutorialBtn');
const themeBtn = $('themeBtn');
const tutorialModal = $('tutorialModal');
const reportModal = $('reportModal');
const voteModal = $('voteModal');
const reportTarget = $('reportTarget');
const reportReason = $('reportReason');
const reportModalInfo = $('reportModalInfo');
const submitReportBtn = $('submitReportBtn');
const voteCountdown = $('voteCountdown');
const voteBody = $('voteBody');
const voteYes = $('voteYes');
const voteNo = $('voteNo');
const voteYesBar = $('voteYesBar');
const voteNoBar = $('voteNoBar');
const voteYesBtn = $('voteYesBtn');
const voteNoBtn = $('voteNoBtn');
const voteNote = $('voteNote');
const toastStack = $('toastStack');

// ============================================================================
// Trạng thái cục bộ
// ============================================================================
const state = {
  token: localStorage.getItem('dcts.token') || null,
  room: null,
  myId: null,
  players: [],
  phase: 'LOBBY',
  role: null,
  drawerId: null,
  deadline: 0,
  drawDeadline: 0,
  timer: { anchor: 0, remaining: 0, running: false },
  cooldownUntil: 0,
  solved: false,
  hint: '',
  vote: null,
  report: null,
  reportLimit: 0,
  reportsUsed: 0,
  resumeTried: false,
  daThayThe: false,
  lastResult: null,
};

const NHAN_DONG_HO = {
  DRAWING: 'THỜI GIAN VẼ',
  FINAL_GUESS: 'ĐOÁN BONUS',
  TURN_END: 'LƯỢT KẾ TIẾP',
};
const LY_DO = {
  all_guessed: 'Mọi người đã đoán đúng!',
  timeout: 'Hết giờ!',
  drawer_left: 'Người vẽ đã rời phòng.',
  not_enough_players: 'Không còn đủ người chơi tối thiểu.',
  completed: 'Đã hoàn thành tất cả lượt vẽ.',
  out_of_words: 'Đã hết từ khoá cho trận này.',
};

// ============================================================================
// Tiện ích giao diện
// ============================================================================
function showPage(el) {
  for (const p of PAGES) p.hidden = p !== el;
  const isLobby = el === page1 || el === page2 || el === page3;
  tutorialBtn.hidden = !isLobby;
  if (el === manHinhTranDau) {
    document.body.classList.add('in-game');
  } else {
    document.body.classList.remove('in-game');
  }
}

function toast(message, kind = '') {
  if (!message) return;
  const item = document.createElement('div');
  item.className = `toast-item ${kind}`;
  item.textContent = message;
  toastStack.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    setTimeout(() => item.remove(), 220);
  }, 3200);
}

function openModal(el) { el.hidden = false; }
function closeModal(el) { el.hidden = true; }

function applyTheme(theme) {
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('dcts.theme', theme);
}
applyTheme(localStorage.getItem('dcts.theme') || 'light');

themeBtn.addEventListener('click', () => {
  applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

tutorialBtn.addEventListener('click', () => openModal(tutorialModal));
document.querySelectorAll('[data-close="tutorial"]').forEach(el => {
  el.addEventListener('click', () => closeModal(tutorialModal));
});
document.querySelectorAll('[data-close="report"]').forEach(el => {
  el.addEventListener('click', () => closeModal(reportModal));
});

// ============================================================================
// Phiên chơi (token) — giữ chỗ 30 giây khi mất mạng
// ============================================================================
function saveSession(token, roomId) {
  state.token = token;
  state.myId = token;
  if (token) localStorage.setItem('dcts.token', token);
  if (roomId) localStorage.setItem('dcts.room', roomId);
}
function clearSession() {
  state.token = null;
  state.myId = null;
  localStorage.removeItem('dcts.token');
  localStorage.removeItem('dcts.room');
}
function goHome(options = {}) {
  // Tab bị thay phiên không được xoá localStorage: token đó đang thuộc về tab khác
  // (cùng origin dùng chung localStorage), xoá sẽ làm tab đang chơi mất khả năng resume.
  if (!options.keepSession) clearSession();
  state.room = null;
  state.players = [];
  state.phase = 'LOBBY';
  state.role = null;
  state.vote = null;
  stopTimer();
  closeModal(reportModal);
  closeModal(voteModal);
  closeModal(tutorialModal);
  showPage(page1);
}

function tryResume() {
  const token = state.token;
  const roomId = localStorage.getItem('dcts.room');
  if (!token || !roomId || state.resumeTried || state.daThayThe) return;
  state.resumeTried = true;
  socket.emit('khoi_phuc_phien', { token }, (r) => {
    if (!r || !r.ok) {
      clearSession();
      state.resumeTried = false;
      showPage(page1);
      return;
    }
    saveSession(r.token, r.phong.idPhong);
    state.room = r.phong;
    applySnapshot(r.snapshot, r.phong);
    toast('Đã khôi phục phiên chơi.', 'ok');
  });
}

// ============================================================================
// Điều hướng / tạo phòng / vào phòng
// ============================================================================
const invitedRoomCode = new URLSearchParams(window.location.search).get('room');
if (invitedRoomCode && /^\d{6}$/.test(invitedRoomCode)) {
  roomCodeField.hidden = false;
  roomCodeInput.value = invitedRoomCode;
}

function requireName() {
  const name = usernameInput.value.trim();
  if (!name) {
    toast('Bạn hãy nhập tên trước nhé!', 'warn');
    usernameInput.focus();
    return null;
  }
  return name;
}

createBtn.addEventListener('click', () => {
  if (!socket.connected) return toast('Chưa kết nối được máy chủ. Hãy thử tải lại trang.', 'warn');
  if (!requireName()) return;
  socket.emit('xin_ma_phong', (r) => {
    generatedRoomId.textContent = r.idPhong;
    showPage(page2);
  });
});

backToHomeBtn.addEventListener('click', () => showPage(page1));

timeSlider.addEventListener('input', () => { timeVal.textContent = `${timeSlider.value} phút`; });
maxPlayersSlider.addEventListener('input', () => { maxPlayersVal.textContent = `${maxPlayersSlider.value} người`; });

finalCreateBtn.addEventListener('click', () => {
  if (!socket.connected) return toast('Mất kết nối tới máy chủ. Hãy tải lại trang.', 'warn');
  const name = requireName();
  if (!name) return;
  finalCreateBtn.disabled = true;
  socket.emit('tao_phong', {
    tenNguoiChon: name,
    thoiGianPhut: Number(timeSlider.value),
    soNguoiToiDa: Number(maxPlayersSlider.value),
    idGoiY: generatedRoomId.textContent,
  }, (r) => {
    finalCreateBtn.disabled = false;
    if (!r || !r.ok) return toast(r ? r.thongBao : 'Không tạo được phòng.', 'warn');
    saveSession(r.token, r.phong.idPhong);
    state.room = r.phong;
    state.players = r.nguoiChoi || [];
    state.phase = 'LOBBY';
    updateRoom(r.phong); // hiện mã phòng + thời gian + số người ngay lập tức
    renderLobby();
    showPage(page3);
  });
});

joinBtn.addEventListener('click', () => {
  if (!socket.connected) return toast('Chưa kết nối được máy chủ. Hãy thử tải lại trang.', 'warn');
  const name = requireName();
  if (!name) return;
  if (roomCodeField.hidden) {
    roomCodeField.hidden = false;
    roomCodeInput.focus();
    return;
  }
  const code = roomCodeInput.value.trim();
  if (!/^\d{6}$/.test(code)) return toast('Mã phòng phải gồm đúng 6 chữ số.', 'warn');
  socket.emit('tham_gia_phong', { idPhong: code, tenNguoiChon: name }, (r) => {
    if (!r || !r.ok) return toast(r ? r.thongBao : 'Không vào được phòng.', 'warn');
    saveSession(r.token, r.phong.idPhong);
    state.room = r.phong;
    state.players = r.nguoiChoi || [];
    state.phase = 'LOBBY';
    updateRoom(r.phong); // hiện mã phòng + thời gian + số người ngay lập tức
    renderLobby();
    showPage(page3);
  });
});

leaveBtn.addEventListener('click', () => {
  if (!confirm('Bạn có chắc muốn rời phòng không?')) return;
  socket.emit('roi_phong', () => goHome());
});

shareBtn.addEventListener('click', () => {
  const id = state.room?.idPhong || roomDisplayId.textContent;
  const link = `${window.location.origin}/join/${id}`;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(link)
      .then(() => toast(`Đã copy link phòng: ${link}`, 'ok'))
      .catch(() => window.prompt('Sao chép link phòng:', link));
  } else {
    window.prompt('Sao chép link phòng:', link);
  }
});

startGameBtn.addEventListener('click', () => {
  if (!socket.connected) return toast('Mất kết nối tới máy chủ.', 'warn');
  startGameBtn.disabled = true;
  socket.emit('bat_dau_tran_dau', (r) => {
    startGameBtn.disabled = false;
    if (r && !r.ok) toast(r.thongBao, 'warn');
  });
});

hostTimeSlider.addEventListener('input', () => { hostTimeVal.textContent = `${hostTimeSlider.value} phút`; });
hostMaxPlayersSlider.addEventListener('input', () => { hostMaxPlayersVal.textContent = `${hostMaxPlayersSlider.value} người`; });
function sendHostSettings() {
  socket.emit('cap_nhat_cai_dat', {
    thoiGianPhut: Number(hostTimeSlider.value),
    soNguoiToiDa: Number(hostMaxPlayersSlider.value),
  }, (r) => { if (r && !r.ok) toast(r.thongBao, 'warn'); });
}
hostTimeSlider.addEventListener('change', sendHostSettings);
hostMaxPlayersSlider.addEventListener('change', sendHostSettings);

// ============================================================================
// Render lobby / người chơi / bảng điểm
// ============================================================================
function updateRoom(room) {
  if (!room) return;
  state.room = room;
  roomDisplayId.textContent = room.idPhong || '------';
  roomMetaTime.textContent = `⏱ ${room.thoiGianPhut} phút / lượt`;
  roomMetaPlayers.textContent = `👥 ${room.soNguoiHienTai}/${room.soNguoiToiDa} người`;
  if (document.activeElement !== hostTimeSlider) {
    hostTimeSlider.value = room.thoiGianPhut;
    hostTimeVal.textContent = `${room.thoiGianPhut} phút`;
  }
  if (document.activeElement !== hostMaxPlayersSlider) {
    hostMaxPlayersSlider.value = room.soNguoiToiDa;
    hostMaxPlayersVal.textContent = `${room.soNguoiToiDa} người`;
  }
  state.reportLimit = room.gioiHanToCao || 0;
  state.reportsUsed = room.soToCaoDaDung || 0;
}

function myPlayer() { return state.players.find(p => p.id === state.myId) || null; }
function isHost() { return Boolean(myPlayer()?.laChuPhong); }

function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function renderLobby() {
  const me = myPlayer();
  const host = isHost();
  startGameBtn.hidden = !host;
  startGameBtn.disabled = state.players.filter(p => !p.daRoi && !p.ngatKetNoi).length < 3;
  hostSettings.hidden = !host;
  playerCountLabel.textContent = `${state.players.filter(p => !p.daRoi).length}/${state.room?.soNguoiToiDa || '?'}`;

  playerList.innerHTML = '';
  const ordered = [...state.players].sort((a, b) => {
    if (a.laChuPhong !== b.laChuPhong) return a.laChuPhong ? -1 : 1;
    return a.ten.localeCompare(b.ten, 'vi');
  });
  for (const p of ordered) {
    const item = document.createElement('div');
    item.className = 'player-item';
    if (p.laChuPhong) item.classList.add('host');
    if (p.id === state.myId) item.classList.add('me');
    if (p.ngatKetNoi || p.daRoi) item.classList.add('offline');

    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.textContent = initial(p.ten);

    const main = document.createElement('div');
    main.className = 'player-main';
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = p.ten + (p.id === state.myId ? ' (bạn)' : '');
    const sub = document.createElement('div');
    sub.className = 'player-sub';
    sub.textContent = p.daRoi ? 'Đã rời phòng' : p.ngatKetNoi ? 'Đang mất kết nối...' : p.laChuPhong ? 'Chủ phòng' : 'Sẵn sàng';
    main.append(name, sub);

    const tags = document.createElement('div');
    tags.className = 'player-tags';
    if (p.laChuPhong) tags.innerHTML += '<span class="tag host">👑 Host</span>';
    if (p.id === state.myId) tags.innerHTML += '<span class="tag me">Bạn</span>';
    item.append(avatar, main, tags);
    playerList.appendChild(item);
  }

  if (state.players.filter(p => !p.daRoi && !p.ngatKetNoi).length < 3) {
    startGameBtn.title = 'Cần ít nhất 3 người chơi đang kết nối';
  } else {
    startGameBtn.title = '';
  }
}

function renderScores() {
  bangDiemTran.innerHTML = '';
  const sorted = [...state.players].filter(p => !p.daRoi).sort((a, b) => b.diem - a.diem);
  for (const p of sorted) {
    const chip = document.createElement('div');
    chip.className = 'score-chip';
    if (p.laNguoiVe) chip.classList.add('drawer');
    if (p.daDoanDung) chip.classList.add('solved');
    if (p.ngatKetNoi) chip.classList.add('offline');
    const name = document.createElement('span');
    name.textContent = `${p.laNguoiVe ? '✏️ ' : ''}${p.daDoanDung ? '✅ ' : ''}${p.ten}${p.id === state.myId ? ' (bạn)' : ''}`;
    const score = document.createElement('b');
    score.textContent = p.diem;
    chip.append(name, score);
    bangDiemTran.appendChild(chip);
  }
}

function renderAll() {
  renderLobby();
  renderScores();
  renderReportInfo();
  updateGuessUI();
}

// ============================================================================
// Chat — phòng chờ và trận đấu tách biệt
// ============================================================================
function chatBoxFor(kenh) { return kenh === 'lobby' ? chatBox : chatBoxTran; }

function appendChat(kenh, message) {
  const box = chatBoxFor(kenh);
  if (!box) return;
  const line = document.createElement('div');
  line.className = 'chat-line';
  if (message.loai === 'he_thong') {
    line.classList.add('sys');
    line.textContent = message.noiDungChat;
  } else {
    if (message.loai === 'noi_bo') line.classList.add('private');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${message.tenNguoiDung || 'Ai đó'}:`;
    const text = document.createElement('span');
    text.textContent = message.noiDungChat;
    line.append(who, text);
  }
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function clearChat(kenh) {
  const box = chatBoxFor(kenh);
  if (box) box.innerHTML = '';
}

function sendChat(input) {
  const text = input.value.trim();
  if (!text || input.disabled) return;
  socket.emit('tin_nhan_chat', { noiDungChat: text });
  input.value = '';
}
sendChatBtn.addEventListener('click', () => sendChat(chatInput));
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(chatInput); });
btnGuiChat.addEventListener('click', () => sendChat(inputChat));
inputChat.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(inputChat); });

// ============================================================================
// Đồng hồ & cooldown
// ============================================================================
function startTimer(ms) {
  state.timer.anchor = performance.now();
  state.timer.remaining = Math.max(0, Number(ms) || 0);
  state.timer.running = true;
  renderTimer();
}
function stopTimer() {
  state.timer.running = false;
  dongHoDemNguoc.textContent = '--:--';
  dongHoDemNguoc.classList.remove('danger');
}
function timerRemaining() {
  if (!state.timer.running) return 0;
  return Math.max(0, state.timer.remaining - (performance.now() - state.timer.anchor));
}
function renderTimer() {
  if (!state.timer.running) return;
  const ms = timerRemaining();
  const s = Math.ceil(ms / 1000);
  dongHoDemNguoc.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  dongHoDemNguoc.classList.toggle('danger', s <= 10 && (state.phase === 'DRAWING' || state.phase === 'FINAL_GUESS'));
  if (state.vote) renderVoteCountdown();
}
setInterval(renderTimer, 100);

function cooldownRemaining() {
  return Math.max(0, state.cooldownUntil - performance.now());
}
setInterval(updateGuessUI, 100);

// ============================================================================
// Ô đoán từ khoá (tách khỏi chat)
// ============================================================================
function canGuessNow() {
  return state.role === 'nguoi_doan'
    && (state.phase === 'DRAWING' || state.phase === 'FINAL_GUESS')
    && !state.solved
    && cooldownRemaining() <= 0;
}

function updateGuessUI() {
  const inGame = state.phase === 'DRAWING' || state.phase === 'FINAL_GUESS';
  const isDrawer = state.role === 'nguoi_ve';
  const cd = cooldownRemaining();
  const disabled = !inGame || isDrawer || state.solved || cd > 0;
  inputDoan.disabled = disabled;
  btnGuiDoan.disabled = disabled;

  guessStatus.classList.remove('ok', 'warn');
  if (isDrawer) {
    guessStatus.textContent = 'Bạn là người vẽ — hãy minh hoạ từ khoá thật dễ hiểu.';
  } else if (state.solved) {
    // Cũ: chỉ báo màu xanh "đã đoán đúng, có thể chat bình thường..." — đã bỏ theo yêu cầu.
    // Người chơi nhận biết qua toast "+N điểm"; ô đoán bị khoá, placeholder tự đổi.
    guessStatus.textContent = '';
  } else if (cd > 0) {
    guessStatus.classList.add('warn');
    guessStatus.textContent = `❌ Chưa đúng! Chờ ${Math.ceil(cd / 1000)} giây để đoán lại.`;
  } else if (state.phase === 'FINAL_GUESS') {
    guessStatus.textContent = '⏳ Đoán bonus — canvas đã khoá, cố lên!';
  } else if (inGame) {
    guessStatus.textContent = 'Quan sát hình vẽ và nhập đáp án.';
  } else {
    guessStatus.textContent = 'Chờ lượt chơi bắt đầu...';
  }
  inputDoan.placeholder = isDrawer ? 'Bạn đang vẽ...' : state.solved ? 'Bạn đã đoán đúng' : 'Nhập đáp án...';
}

function submitGuess() {
  const text = inputDoan.value.trim();
  if (!text || inputDoan.disabled) return;
  socket.emit('doan_tu_khoa', { noiDung: text }, (r) => {
    if (!r) return;
    if (!r.ok) {
      if (r.ma === 'COOLDOWN' && r.conLaiMs) {
        state.cooldownUntil = performance.now() + r.conLaiMs;
        updateGuessUI();
      } else {
        toast(r.thongBao || 'Không thể đoán lúc này.', 'warn');
      }
      return;
    }
    inputDoan.value = '';
    if (r.correct) {
      state.solved = true;
      updateGuessUI();
    }
  });
}
btnGuiDoan.addEventListener('click', submitGuess);
inputDoan.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });

// ============================================================================
// Bảng vẽ — cầu nối iframe ↔ Socket.IO
// ============================================================================
const hangDoiNet = [];
const congCuVe = () => (khungVe.contentWindow && khungVe.contentWindow.drawingTool) || null;

function coTheVe() {
  return state.role === 'nguoi_ve' && state.phase === 'DRAWING';
}

function noiCongCuVe() {
  const w = khungVe.contentWindow;
  if (!w || !w.drawingTool) return;
  if (!w.__daNoiSocket) {
    w.__daNoiSocket = true;
    const st = w.document.createElement('style');
    st.textContent = [
      '.topbar{display:none!important}',
      '.app-shell{padding:0!important}',
      'body{background:transparent!important}',
      'body.khach .sidebar{display:none!important}',
      'body.khach .layout{grid-template-columns:minmax(0,1fr)!important}',
      'body.khach .board-panel{box-shadow:none!important;border:0!important;background:transparent!important}',
      'body.khach .board-header,body.khach .board-footer{display:none!important}',
    ].join('');
    w.document.head.appendChild(st);

    const gui = (event, detail) => {
      if (!coTheVe()) return;
      socket.emit(event, detail);
    };
    w.addEventListener('drawing:stroke-start', (e) => gui('draw:stroke-start', e.detail));
    w.addEventListener('drawing:stroke-points', (e) => gui('draw:stroke-points', e.detail));
    w.addEventListener('drawing:stroke-end', (e) => gui('draw:stroke-end', e.detail));
    w.addEventListener('drawing:undo', (e) => gui('draw:undo', e.detail));
    w.addEventListener('drawing:redo', (e) => gui('draw:redo', e.detail));
    w.addEventListener('drawing:clear', () => gui('draw:clear'));
  }
  for (const item of hangDoiNet.splice(0)) {
    if (item.type === 'start') w.drawingTool.beginRemoteStroke(item.stroke);
    else if (item.type === 'points') w.drawingTool.appendRemotePoints(item.id, item.points);
    else if (item.type === 'end') w.drawingTool.endRemoteStroke(item.id);
    else if (item.type === 'undo') w.drawingTool.undoRemote(item.id);
    else if (item.type === 'redo') w.drawingTool.redoRemote(item.stroke);
    else if (item.type === 'clear') w.drawingTool.clear();
    else if (item.type === 'load') {
      w.drawingTool.loadStrokes(item.strokes);
      // Nét đang vẽ dở khi reconnect phải tiếp tục nhận điểm mới.
      if (item.liveId) w.drawingTool.activateRemoteStroke(item.liveId);
    }
  }
  // Iframe có thể tải xong sau khi lượt chơi bắt đầu — đồng bộ lại quyền vẽ.
  if (state.role) datQuyenVe();
}
khungVe.addEventListener('load', noiCongCuVe);
noiCongCuVe();

function datQuyenVe() {
  const duocVe = coTheVe();
  khungVe.style.pointerEvents = duocVe ? 'auto' : 'none';
  const doc = khungVe.contentDocument;
  if (doc && doc.body) doc.body.classList.toggle('khach', state.role !== 'nguoi_ve');
}

socket.on('draw:stroke-start', (stroke) => {
  const dt = congCuVe();
  if (dt) dt.beginRemoteStroke(stroke); else hangDoiNet.push({ type: 'start', stroke });
});
socket.on('draw:stroke-points', (d) => {
  const dt = congCuVe();
  if (dt) dt.appendRemotePoints(d.id, d.points); else hangDoiNet.push({ type: 'points', id: d.id, points: d.points });
});
socket.on('draw:stroke-end', (d) => {
  const dt = congCuVe();
  if (dt) dt.endRemoteStroke(d.id); else hangDoiNet.push({ type: 'end', id: d.id });
});
socket.on('draw:undo', (d) => {
  const dt = congCuVe();
  if (dt) dt.undoRemote(d.id); else hangDoiNet.push({ type: 'undo', id: d.id });
});
socket.on('draw:redo', (d) => {
  const dt = congCuVe();
  if (dt) dt.redoRemote(d.stroke); else hangDoiNet.push({ type: 'redo', stroke: d.stroke });
});
socket.on('draw:clear', () => {
  hangDoiNet.length = 0;
  const dt = congCuVe();
  if (dt) dt.clear();
});

// ============================================================================
// Sự kiện trận đấu
// ============================================================================
socket.on('cap_nhat_danh_sach_nguoi_choi', (list) => {
  state.players = Array.isArray(list) ? list : [];
  if (state.phase === 'LOBBY') renderLobby();
  renderScores();
  renderReportInfo();
  updateGuessUI();
});

socket.on('phong_cap_nhat', (room) => updateRoom(room));

socket.on('chu_phong_moi', (d) => {
  toast(`👑 ${d.ten || 'Người chơi'} là chủ phòng mới.`, 'info');
});

socket.on('bat_dau_tran', (d) => {
  if (d && d.reportLimit) state.reportLimit = d.reportLimit;
});

socket.on('chuyen_luot_ve', (d) => {
  state.phase = 'DRAWING';
  state.role = d.vaiTro;
  state.solved = false;
  state.cooldownUntil = 0;
  state.hint = d.goiY || '';
  state.vote = null;
  closeModal(voteModal);
  closeModal(reportModal);
  closeModal(tutorialModal);
  const drawer = state.players.find(p => p.laNguoiVe);
  state.drawerId = drawer ? drawer.id : null;

  showPage(manHinhTranDau);
  lopPhuLuot.hidden = true;
  hangDoiNet.length = 0;
  const dt = congCuVe(); if (dt) dt.clear();
  inputDoan.value = '';
  inputDoan.disabled = false;

  vaiTroHienTai.textContent = d.vaiTro === 'nguoi_ve'
    ? '✏️ Bạn là NGƯỜI VẼ'
    : `👀 Bạn là NGƯỜI ĐOÁN — ${d.tenNguoiVe || 'Ai đó'} đang vẽ`;
  turnLabel.textContent = `Lượt ${d.luot || ''} · ${d.doDaiTu || 0} chữ cái`;
  hienThiTuKhoa.textContent = d.vaiTro === 'nguoi_ve' ? '...' : (d.goiY || '');
  nhanDongHo.textContent = NHAN_DONG_HO.DRAWING;
  startTimer(d.conLaiMs);
  datQuyenVe();
  updateGuessUI();
  renderScores();
  renderReportInfo();
});

socket.on('tu_khoa', (d) => {
  if (state.role === 'nguoi_ve') hienThiTuKhoa.textContent = d.tuKhoa;
});

socket.on('goi_y_tu_khoa', (d) => {
  state.hint = d.goiY || state.hint;
  if (state.role === 'nguoi_doan') hienThiTuKhoa.textContent = state.hint;
});

socket.on('doan_cuoi', (d) => {
  state.phase = 'FINAL_GUESS';
  state.hint = d.goiY || state.hint;
  if (state.role === 'nguoi_doan') hienThiTuKhoa.textContent = state.hint;
  nhanDongHo.textContent = NHAN_DONG_HO.FINAL_GUESS;
  startTimer(d.conLaiMs);
  datQuyenVe();
  updateGuessUI();
  toast('⏰ Hết giờ vẽ! Canvas đã khoá — bạn có thêm 60 giây để đoán.', 'info');
});

socket.on('ket_thuc_luot', (d) => {
  state.phase = 'TURN_END';
  datQuyenVe();
  updateGuessUI();
  nhanDongHo.textContent = NHAN_DONG_HO.TURN_END;
  startTimer(d.conLaiMs);
  const gains = (d.diemLuot || [])
    .filter(g => g.delta)
    .map(g => `${g.name} ${g.delta > 0 ? '+' : ''}${g.delta}`)
    .join(' · ');
  lopPhuLuot.textContent = `${LY_DO[d.lyDo] || 'Kết thúc lượt'}\n`
    + `${d.tuKhoa ? `Từ khoá: “${d.tuKhoa}”` : 'Lượt bị huỷ'}\n`
    + `${gains || 'Không ai ghi điểm'}`
    + `${d.diemNguoiVe ? `\nNgười vẽ: +${d.diemNguoiVe} điểm` : ''}`;
  lopPhuLuot.hidden = false;
});

socket.on('doan_dung', (d) => {
  if (d.id === state.myId) {
    state.solved = true;
    toast(`🎉 Chính xác! Bạn được +${d.diem} điểm.`, 'ok');
    updateGuessUI();
  }
});

socket.on('doan_sai', (d) => {
  state.cooldownUntil = performance.now() + Math.max(0, d.conLaiMs || 0);
  updateGuessUI();
});

socket.on('doan_bi_chan', (d) => {
  if (d.lyDo === 'COOLDOWN') {
    state.cooldownUntil = performance.now() + Math.max(0, d.conLaiMs || 0);
    updateGuessUI();
  } else if (d.lyDo === 'ALREADY_SOLVED') {
    state.solved = true;
    updateGuessUI();
  } else {
    toast('Không thể đoán lúc này.', 'warn');
  }
});

socket.on('tin_nhan_tu_server', (d) => {
  if (!d) return;
  const kenh = d.kenh || (state.phase === 'LOBBY' ? 'lobby' : 'game');
  appendChat(kenh, d);
});

socket.on('xoa_lich_su_chat', (d) => {
  if (d && d.kenh) clearChat(d.kenh);
});

socket.on('dong_ho', (d) => {
  if (!d) return;
  if (d.pha !== state.phase) state.phase = d.pha;
  if (state.timer.running) startTimer(d.conLaiMs);
});

socket.on('loi_he_thong', (d) => toast(d?.thongBao || 'Có lỗi xảy ra.', 'warn'));

// Tab này vừa bị thay phiên của người chơi khác (cùng token mở ở tab/khác).
socket.on('phien_da_thay_the', (d) => {
  state.daThayThe = true;
  try { socket.disconnect(); } catch (_) { /* đã ngắt */ }
  // Giữ nguyên localStorage: token đang được tab mới sử dụng.
  goHome({ keepSession: true });
  toast(d?.thongBao || 'Phiên này đã được khôi phục ở nơi khác.', 'warn');
});

socket.on('bi_loai', (d) => {
  toast(d?.thongBao || 'Bạn đã bị loại khỏi phòng.', 'warn');
  goHome();
});

// ============================================================================
// Kết quả cuối trận
// ============================================================================
function renderResult(data) {
  if (!data) return;
  state.lastResult = data;
  const rows = data.bangDiemFinal
    ? data.bangDiemFinal.map(r => ({
      ten: r.ten, diem: r.diem, hang: r.hang, daRoi: r.daRoi, ngatKetNoi: r.ngatKetNoi, viPham: r.viPham,
    }))
    : (data.ranking || []).map(r => ({
      ten: r.name, diem: r.score, hang: r.rank, daRoi: r.left, ngatKetNoi: !r.connected, viPham: r.violations,
    }));

  // Màn hình tổng kết không cần dòng mô tả (giữ phần tử để bố cục không đổi).
  resultNote.textContent = '';

  tbodyKetQua.innerHTML = '';
  for (const r of [...rows].sort((a, b) => a.hang - b.hang)) {
    const tr = document.createElement('tr');
    if (r.hang === 1) tr.classList.add('podium-1');
    const tdRank = document.createElement('td');
    tdRank.className = 'rank';
    tdRank.textContent = r.hang;
    const tdName = document.createElement('td');
    tdName.textContent = `${r.ten}${r.daRoi ? ' (đã rời)' : r.ngatKetNoi ? ' (mất kết nối)' : ''}${r.ten === myPlayer()?.ten ? ' — bạn' : ''}`;
    const tdScore = document.createElement('td');
    tdScore.className = 'score';
    tdScore.textContent = r.diem;
    const tdViolation = document.createElement('td');
    tdViolation.textContent = r.viPham || 0;
    tr.append(tdRank, tdName, tdScore, tdViolation);
    tbodyKetQua.appendChild(tr);
  }
  showPage(manHinhKetQua);
}

socket.on('ket_thuc_game_dau', (d) => {
  state.phase = 'GAME_END';
  state.role = null;
  state.vote = null;
  closeModal(voteModal);
  closeModal(reportModal);
  closeModal(tutorialModal);
  stopTimer();
  lopPhuLuot.hidden = true;
  datQuyenVe();
  renderResult(d);
});

btnTiepTuc.addEventListener('click', () => {
  socket.emit('yeu_cau_choi_tiep', (r) => {
    if (!r || !r.ok) return toast(r ? r.thongBao : 'Không thể tiếp tục.', 'warn');
    if (!r.host) ghiChuChoiTiep.textContent = 'Đã báo ở lại — chờ chủ phòng mở lại phòng chờ...';
  });
});
btnVeDau.addEventListener('click', () => {
  socket.emit('roi_phong', () => goHome());
});
socket.on('nguoi_choi_o_lai', (d) => {
  ghiChuChoiTiep.textContent = `${d.soNguoi} người chơi muốn ở lại.`;
});
socket.on('ve_phong_cho', (room) => {
  state.phase = 'LOBBY';
  state.role = null;
  state.vote = null;
  state.solved = false;
  state.cooldownUntil = 0;
  stopTimer();
  closeModal(voteModal);
  closeModal(reportModal);
  closeModal(tutorialModal);
  lopPhuLuot.hidden = true;
  updateRoom(room);
  renderLobby();
  renderScores();
  showPage(page3);
});

// ============================================================================
// Tố cáo & bình chọn
// ============================================================================
function reportReasonText(code) {
  return reportReason.querySelector(`option[value="${code}"]`)?.textContent || code;
}

function canReportNow() {
  const me = myPlayer();
  const inGame = state.phase === 'DRAWING' || state.phase === 'FINAL_GUESS';
  if (!inGame || !me || me.daRoi) return { ok: false, reason: 'Chỉ có thể tố cáo trong lúc chơi.' };
  if (state.vote) return { ok: false, reason: 'Đang có một cuộc bình chọn khác.' };
  if (state.reportLimit && state.reportsUsed >= state.reportLimit) return { ok: false, reason: 'Phòng đã hết lượt tố cáo.' };
  if (me.daToCaoLuotNay) return { ok: false, reason: 'Bạn đã tố cáo trong lượt này.' };
  return { ok: true };
}

function renderReportInfo() {
  const info = canReportNow();
  reportBtn.disabled = !info.ok;
  const limit = state.reportLimit || state.room?.gioiHanToCao || 0;
  const used = state.reportsUsed || state.room?.soToCaoDaDung || 0;
  reportInfo.textContent = info.ok
    ? `Lượt tố cáo của phòng: ${used}/${limit}.`
    : `${info.reason}${limit ? ` (${used}/${limit})` : ''}`;
}

function openReportModal() {
  const info = canReportNow();
  if (!info.ok) return toast(info.reason, 'warn');
  const others = state.players.filter(p => p.id !== state.myId && !p.daRoi && !p.ngatKetNoi);
  if (!others.length) return toast('Không có người chơi nào để tố cáo.', 'warn');
  reportTarget.innerHTML = '';
  for (const p of others) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.ten;
    reportTarget.appendChild(opt);
  }
  const limit = state.reportLimit || state.room?.gioiHanToCao || 0;
  const used = state.reportsUsed || state.room?.soToCaoDaDung || 0;
  reportModalInfo.textContent = `Phòng còn ${Math.max(0, limit - used)}/${limit} lượt tố cáo. Mỗi người tối đa 1 lần/lượt.`;
  openModal(reportModal);
}
reportBtn.addEventListener('click', openReportModal);

submitReportBtn.addEventListener('click', () => {
  const targetId = reportTarget.value;
  const lyDo = reportReason.value;
  if (!targetId) return toast('Hãy chọn người bị tố cáo.', 'warn');
  submitReportBtn.disabled = true;
  socket.emit('tao_to_cao', { targetId, lyDo }, (r) => {
    submitReportBtn.disabled = false;
    if (!r || !r.ok) return toast(r ? r.thongBao : 'Không thể tố cáo.', 'warn');
    closeModal(reportModal);
    toast('Đã gửi tố cáo. Cả phòng sẽ bình chọn trong 20 giây.', 'info');
  });
});

function normalizeVote(v) {
  return {
    ...v,
    anchor: performance.now(),
    remaining: Number.isFinite(v.conLaiMs) ? v.conLaiMs : Math.max(0, (v.deadline || 0) - Date.now()),
  };
}

function renderVote() {
  const v = state.vote;
  if (!v) return;
  voteBody.innerHTML = `<p>Người bị tố cáo: <b>${escapeHtml(v.targetName || '')}</b></p>`
    + `<p>Lý do: <b>${escapeHtml(v.reasonText || reportReasonText(v.reason))}</b></p>`
    + `<p>Người tố cáo: <b>${escapeHtml(v.reporterName || '')}</b></p>`;
  voteYes.textContent = `Đồng ý: ${v.yes || 0}`;
  voteNo.textContent = `Không đồng ý: ${v.no || 0}`;
  const total = Math.max(1, (v.yes || 0) + (v.no || 0));
  voteYesBar.style.width = `${((v.yes || 0) / total) * 100}%`;
  voteNoBar.style.width = `${((v.no || 0) / total) * 100}%`;
  const iAmTarget = v.targetId === state.myId;
  const eligible = Array.isArray(v.eligibleIds) ? v.eligibleIds.includes(state.myId) : true;
  const voted = Boolean(v.voted);
  voteYesBtn.disabled = iAmTarget || !eligible || voted;
  voteNoBtn.disabled = iAmTarget || !eligible || voted;
  if (iAmTarget) voteNote.textContent = 'Bạn đang bị tố cáo nên không được tham gia bình chọn.';
  else if (!eligible) voteNote.textContent = 'Bạn không có quyền bỏ phiếu trong cuộc bình chọn này.';
  else if (voted) voteNote.textContent = 'Bạn đã bỏ phiếu. Không thể rút lại.';
  else voteNote.textContent = `Cần tối thiểu 2 phiếu và 2/3 số phiếu hợp lệ đồng ý. Người bị tố cáo không được bỏ phiếu.`;
  renderVoteCountdown();
}

function renderVoteCountdown() {
  const v = state.vote;
  if (!v) return;
  const ms = Math.max(0, (v.remaining || 0) - (performance.now() - (v.anchor || performance.now())));
  voteCountdown.textContent = `${Math.ceil(ms / 1000)}s`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

socket.on('to_cao_bat_dau', (v) => {
  state.vote = normalizeVote(v);
  state.reportLimit = v.reportLimit || state.reportLimit;
  state.reportsUsed = v.reportsUsed || state.reportsUsed;
  renderVote();
  openModal(voteModal);
  renderReportInfo();
});

socket.on('to_cao_cap_nhat', (v) => {
  if (!state.vote || v.id !== state.vote.id) return;
  state.vote = normalizeVote({ ...state.vote, ...v });
  renderVote();
});

socket.on('to_cao_ket_qua', (r) => {
  if (r && r.huy) {
    state.vote = null;
    closeModal(voteModal);
    renderReportInfo();
    return;
  }
  state.vote = null;
  closeModal(voteModal);
  renderReportInfo();
  if (!r) return;
  if (r.success) {
    toast(r.removed
      ? `⚖️ ${r.targetName} bị loại khỏi phòng sau lần vi phạm thứ ${r.violations}.`
      : `⚖️ Tố cáo thành công: ${r.targetName} bị trừ ${r.penalty} điểm.`, 'ok');
  } else {
    toast(`⚖️ Tố cáo ${r.targetName} không đủ phiếu — không trừ điểm.`, 'info');
  }
});

socket.on('to_cao_loi', (d) => toast(d?.thongBao || 'Không thể tố cáo.', 'warn'));

voteYesBtn.addEventListener('click', () => {
  if (!state.vote) return;
  const reportId = state.vote.id;
  socket.emit('bo_phieu_to_cao', { reportId, dongY: true }, (r) => {
    if (r && r.ok) {
      // Server có thể đã chốt phiếu và đóng modal trước khi ack về.
      if (state.vote && state.vote.id === reportId) { state.vote.voted = true; renderVote(); }
    } else {
      toast(r?.thongBao || 'Không thể bỏ phiếu.', 'warn');
    }
  });
});
voteNoBtn.addEventListener('click', () => {
  if (!state.vote) return;
  const reportId = state.vote.id;
  socket.emit('bo_phieu_to_cao', { reportId, dongY: false }, (r) => {
    if (r && r.ok) {
      if (state.vote && state.vote.id === reportId) { state.vote.voted = true; renderVote(); }
    } else {
      toast(r?.thongBao || 'Không thể bỏ phiếu.', 'warn');
    }
  });
});

// ============================================================================
// Khôi phục trạng thái
// ============================================================================
function applySnapshot(snap, room) {
  if (!snap) return;
  state.phase = snap.phase || 'LOBBY';
  state.players = snap.players || [];
  state.drawerId = snap.drawerId || null;
  state.hint = snap.hint || '';
  state.solved = Boolean(snap.me?.solved);
  state.cooldownUntil = snap.me?.cooldownUntil
    ? performance.now() + Math.max(0, snap.me.cooldownUntil - Date.now())
    : 0;
  state.report = snap.report || null;
  state.reportLimit = snap.reportLimit || 0;
  state.reportsUsed = snap.reportsUsed || 0;
  state.vote = snap.report?.vote ? normalizeVote({
    ...snap.report.vote,
    targetName: snap.report.vote.targetName
      || state.players.find(p => p.id === snap.report.vote.targetId)?.ten
      || '',
  }) : null;
  if (room) updateRoom(room);

  clearChat('lobby');
  clearChat('game');
  for (const m of snap.chats || []) appendChat(m.kenh || (state.phase === 'LOBBY' ? 'lobby' : 'game'), m);

  if (state.phase === 'LOBBY') {
    showPage(page3);
    renderLobby();
    renderScores();
    renderReportInfo();
    return;
  }
  if (state.phase === 'GAME_END') {
    stopTimer();
    renderResult(snap.lastResult);
    return;
  }

  showPage(manHinhTranDau);
  state.role = snap.drawerId === state.myId ? 'nguoi_ve' : 'nguoi_doan';
  vaiTroHienTai.textContent = state.role === 'nguoi_ve'
    ? '✏️ Bạn là NGƯỜI VẼ'
    : '👀 Bạn là NGƯỜI ĐOÁN';
  turnLabel.textContent = `Lượt ${snap.turnNo || ''}`;
  hienThiTuKhoa.textContent = state.role === 'nguoi_ve' ? (snap.word || '...') : (snap.hint || '');
  nhanDongHo.textContent = NHAN_DONG_HO[state.phase] || 'THỜI GIAN';
  const remaining = Number.isFinite(snap.conLaiMs) ? snap.conLaiMs : Math.max(0, (snap.deadline || 0) - Date.now());
  startTimer(remaining);
  datQuyenVe();
  const allStrokes = [...(snap.strokes || []), ...(snap.liveStroke ? [snap.liveStroke] : [])];
  const dt = congCuVe();
  if (dt) {
    dt.loadStrokes(allStrokes);
    if (snap.liveStroke) dt.activateRemoteStroke(snap.liveStroke.id);
  } else {
    hangDoiNet.push({ type: 'load', strokes: allStrokes, liveId: snap.liveStroke?.id ?? null });
  }
  if (state.phase === 'TURN_END' && snap.word) {
    lopPhuLuot.textContent = `Từ khoá: “${snap.word}”`;
    lopPhuLuot.hidden = false;
  }
  updateGuessUI();
  renderScores();
  renderReportInfo();
  if (state.vote) { renderVote(); openModal(voteModal); }
}

socket.on('khoi_phuc_thanh_cong', (d) => {
  if (!d) return;
  state.room = d.phong;
  applySnapshot(d.snapshot, d.phong);
});

// ============================================================================
// Kết nối
// ============================================================================
socket.on('connect', () => {
  toast('Đã kết nối máy chủ.', 'ok');
  tryResume();
});
socket.on('connect_error', (error) => {
  console.error('Không kết nối được Socket.IO:', error.message);
});
socket.on('disconnect', () => {
  state.resumeTried = false;
  if (state.phase !== 'LOBBY' || state.room) {
    toast('📡 Mất kết nối — đang giữ chỗ 30 giây để bạn quay lại...', 'warn');
  }
});

// Nếu socket đã sẵn sàng trước khi listener được gắn, thử khôi phục ngay.
if (socket.connected) tryResume();
