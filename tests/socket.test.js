'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSocket } = require('../src/socket-server');

function makeSocket(id = 's1') {
  const handlers = new Map();
  const joined = [];
  const left = [];
  const emitted = [];
  return {
    id,
    nsp: { sockets: new Map() },
    handlers,
    joined,
    left,
    emitted,
    on(event, fn) { handlers.set(event, fn); },
    join(room) { joined.push(room); },
    leave(room) { left.push(room); },
    emit(event, payload) { emitted.push({ event, payload }); },
  };
}

const room = { id: '123456' };

function makeManager(overrides = {}) {
  return {
    playerOf: () => null,
    roomOfPlayer: () => null,
    createRoom: () => ({ ok: true, room, playerId: 'p_create', token: 'p_create' }),
    joinRoom: () => ({ ok: true, room, playerId: 'p_join', token: 'p_join' }),
    resumeSession: () => ({
      ok: true, room, playerId: 'p_resume', token: 'p_resume',
      snapshot: { phase: 'DRAWING' }, replacedSocketIds: [],
    }),
    leaveRoom: () => ({ ok: true }),
    ...overrides,
  };
}

test('creating, joining and resuming all join the personal player room', () => {
  const manager = makeManager();
  const socket = makeSocket();
  registerSocket(socket, manager);

  socket.handlers.get('tao_phong')(
    { tenNguoiChon: 'Alice', thoiGianPhut: 1, soNguoiToiDa: 6 },
    () => {},
  );
  socket.handlers.get('tham_gia_phong')(
    { idPhong: '123456', tenNguoiChon: 'Bob' },
    () => {},
  );
  socket.handlers.get('khoi_phuc_phien')({ token: 'p_resume' }, () => {});

  assert.deepEqual(socket.joined, [
    room.id, 'p_create',
    room.id, 'p_join',
    room.id, 'p_resume',
  ]);
});

test('replacing a session notifies the old socket before disconnecting it', () => {
  // Tab cũ phải nhận được sự kiện phien_da_thay_the để không tự resume lại
  // và tạo vòng lặp hai tab tranh nhau phiên.
  const oldSocket = { id: 'old', emitted: [], leave() {}, disconnect() {}, emit(event, payload) { this.emitted.push({ event, payload }); } };
  const manager = makeManager({
    resumeSession: () => ({
      ok: true, room, playerId: 'p_resume', token: 'p_resume',
      snapshot: { phase: 'DRAWING' }, replacedSocketIds: ['old'],
    }),
  });
  const socket = makeSocket();
  socket.nsp.sockets.set('old', oldSocket);
  registerSocket(socket, manager);

  socket.handlers.get('khoi_phuc_phien')({ token: 'p_resume' }, () => {});
  assert.deepEqual(oldSocket.emitted, [
    { event: 'phien_da_thay_the', payload: { thongBao: 'Phiên của bạn vừa được khôi phục ở nơi khác. Tab này sẽ trở về trang chủ.' } },
  ]);
});

test('resume snapshot is translated into the client view model (no undefined names)', () => {
  const manager = makeManager({
    resumeSession: () => ({
      ok: true, room, playerId: 'p_resume', token: 'p_resume',
      snapshot: {
        phase: 'LOBBY',
        players: [{
          id: 'p_resume', name: 'Alice', score: 5, connected: true, left: false,
          isHost: true, isDrawer: false, solved: false, hasDrawn: false, violations: 0, reportedThisTurn: false,
        }],
        chats: [],
      },
      replacedSocketIds: [],
    }),
  });
  const socket = makeSocket();
  registerSocket(socket, manager);

  let ackData = null;
  socket.handlers.get('khoi_phuc_phien')({ token: 'p_resume' }, (data) => { ackData = data; });

  assert.equal(ackData.ok, true);
  const p = ackData.snapshot.players[0];
  assert.equal(p.ten, 'Alice');
  assert.equal(p.diem, 5);
  assert.equal(p.laChuPhong, true);
  assert.equal(p.name, undefined, 'raw English fields must not leak to the client');
  // Sự kiện khoi_phuc_thanh_cong cũng phải dùng cùng view model.
  const resumedEvent = socket.emitted.find(e => e.event === 'khoi_phuc_thanh_cong');
  assert.equal(resumedEvent.payload.snapshot.players[0].ten, 'Alice');
});

test('leaving a room also leaves the personal player room', () => {
  const socket = makeSocket();
  const manager = makeManager({
    playerOf: () => 'p_leave',
    roomOfPlayer: () => room,
  });
  registerSocket(socket, manager);

  let ackData = null;
  socket.handlers.get('roi_phong')((data) => { ackData = data; });

  assert.deepEqual(socket.left, [room.id, 'p_leave']);
  assert.equal(ackData.ok, true);
});
