'use strict';

/**
 * Socket.IO load / smoke benchmark for game-online-draw-guess.
 *
 * Usage:
 * node benchmark.js [clients=50] [url=http://localhost:3000]
 */

const { io } = require('socket.io-client');
const { performance } = require('node:perf_hooks');

const CLIENTS = Number(process.argv[2] || 50);
const BASE_URL = (process.argv[3] || 'http://localhost:3000').replace(/\/$/, '');

const ACK_TIMEOUT_MS = 10_000;
const ROLE_TIMEOUT_MS = 8_000;

const STROKES_PER_ROOM = 20;
const POINTS_PER_STROKE = 25;

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

if (!Number.isInteger(CLIENTS) || CLIENTS < 3) {
    console.error('Số client phải là số nguyên >= 3.');
    process.exit(1);
}

// Gửi event và chờ server xác nhận ACK.
function ack(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout khi chờ ACK: ${event}`));
        }, ACK_TIMEOUT_MS);

        const callback = (result) => {
            clearTimeout(timer);

            if (!result || result.ok !== true) {
                reject(
                    new Error(
                        `${event} thất bại: ${JSON.stringify(result)}`
                    )
                );
            } else {
                resolve(result);
            }
        };

        if (payload === undefined) {
            socket.emit(event, callback);
        } else {
            socket.emit(event, payload, callback);
        }
    });
}

// Tạo một client Socket.IO và chờ kết nối.
function connectClient(index) {
    return new Promise((resolve, reject) => {
        const socket = io(BASE_URL, {
            transports: ['websocket'],
            reconnection: false,
            timeout: ACK_TIMEOUT_MS,
        });

        const timer = setTimeout(() => {
            socket.disconnect();
            reject(
                new Error(`Client ${index} kết nối quá thời gian.`)
            );
        }, ACK_TIMEOUT_MS);

        socket.once('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });

        socket.once('connect_error', (error) => {
            clearTimeout(timer);
            reject(
                new Error(`Client ${index}: ${error.message}`)
            );
        });
    });
}

// Tính percentile.
function percentile(values, p) {
    if (!values.length) return null;

    const sorted = [...values].sort((a, b) => a - b);

    return sorted[
        Math.min(
            sorted.length - 1,
            Math.ceil(p * sorted.length) - 1
        )
    ];
}

// In kết quả độ trễ.
function printLatency(label, values) {
    if (!values.length) {
        return console.log(`${label}: không có mẫu`);
    }

    const avg =
        values.reduce((sum, n) => sum + n, 0) / values.length;

    console.log(
        `${label}: n=${values.length}, ` +
        `avg=${avg.toFixed(2)} ms, ` +
        `p50=${percentile(values, 0.5).toFixed(2)} ms, ` +
        `p95=${percentile(values, 0.95).toFixed(2)} ms, ` +
        `max=${Math.max(...values).toFixed(2)} ms`
    );
}

async function main() {
    const startedAt = performance.now();

    const sockets = [];
    const rooms = [];

    const connectLatencies = [];
    const strokeStartLatencies = [];

    const sentAt = new Map();

    let receivedStrokeStarts = 0;
    let receivedStrokePoints = 0;
    let receivedStrokeEnds = 0;
    let receivedChats = 0;

    let expectedStrokeStarts = 0;
    let expectedStrokePoints = 0;
    let expectedStrokeEnds = 0;
    let expectedChats = 0;

    try {
        console.log(`Server: ${BASE_URL}`);
        console.log(`Số client: ${CLIENTS}`);

        // 1. Kiểm tra server có hoạt động không.
        const health = await fetch(`${BASE_URL}/health`);

        if (!health.ok) {
            throw new Error(`/health trả HTTP ${health.status}`);
        }

        console.log(
            `Health check: ${JSON.stringify(await health.json())}`
        );

        // 2. Chia client thành các phòng từ 3 đến 10 người.
        const groupSizes = [];

        let remaining = CLIENTS;

        while (remaining > 0) {
            const size = Math.min(10, remaining);

            groupSizes.push(size);
            remaining -= size;
        }

        // Nếu phòng cuối có 1 hoặc 2 người,
        // chuyển bớt người từ phòng trước sang.
        if (
            groupSizes.length > 1 &&
            groupSizes.at(-1) < 3
        ) {
            const move = 3 - groupSizes.at(-1);

            groupSizes[groupSizes.length - 2] -= move;
            groupSizes[groupSizes.length - 1] += move;
        }

        if (
            groupSizes.some((n) => n < 3 || n > 10)
        ) {
            throw new Error(
                'Không thể chia client thành phòng hợp lệ (3–10 người/phòng).'
            );
        }

        console.log(
            `Số phòng: ${groupSizes.length}; ` +
            `quy mô: ${groupSizes.join(', ')}`
        );

        // 3. Kết nối tất cả client.
        const connectStart = performance.now();

        const connected = await Promise.all(
            Array.from({ length: CLIENTS }, async (_, i) => {
                const t0 = performance.now();

                const socket = await connectClient(i + 1);

                connectLatencies.push(
                    performance.now() - t0
                );

                sockets.push(socket);

                return socket;
            })
        );

        console.log(
            `Đã kết nối ${connected.length}/${CLIENTS} client ` +
            `trong ${(performance.now() - connectStart).toFixed(2)} ms.`
        );

        // 4. Đăng ký listener để đếm event nhận được.
        for (const socket of sockets) {
            socket.on('draw:stroke-start', (stroke) => {
                receivedStrokeStarts++;

                const t0 = sentAt.get(stroke?.id);

                if (t0 !== undefined) {
                    strokeStartLatencies.push(
                        performance.now() - t0
                    );
                }
            });

            socket.on('draw:stroke-points', () => {
                receivedStrokePoints++;
            });

            socket.on('draw:stroke-end', () => {
                receivedStrokeEnds++;
            });

            socket.on('tin_nhan_tu_server', (message) => {
                if (message?.loai === 'chat') {
                    receivedChats++;
                }
            });
        }

        // 5. Tạo phòng và cho các client tham gia.
        let offset = 0;

        for (
            let ri = 0;
            ri < groupSizes.length;
            ri++
        ) {
            const group = connected.slice(
                offset,
                offset + groupSizes[ri]
            );

            offset += groupSizes[ri];

            // Client đầu tiên tạo phòng.
            const created = await ack(
                group[0],
                'tao_phong',
                {
                    tenNguoiChon: `Bench-${ri + 1}-1`,
                    thoiGianPhut: 1,
                    soNguoiToiDa: group.length,
                }
            );

            const roomId = created.phong.idPhong;

            // Các client còn lại tham gia phòng.
            for (
                let pi = 1;
                pi < group.length;
                pi++
            ) {
                await ack(
                    group[pi],
                    'tham_gia_phong',
                    {
                        idPhong: roomId,
                        tenNguoiChon: `Bench-${ri + 1}-${pi + 1}`,
                    }
                );
            }

            rooms.push({
                id: roomId,
                sockets: group,
                host: group[0],
            });

            console.log(
                `Phòng ${ri + 1}: ${roomId}, ${group.length} người.`
            );
        }

        // 6. Đăng ký listener vai trò người vẽ trước khi bắt đầu.
        const drawerPromises = rooms.map(
            ({ sockets: group }, ri) =>
                new Promise((resolve, reject) => {
                    let settled = false;

                    const listeners = [];

                    const timer = setTimeout(() => {
                        if (settled) return;

                        settled = true;

                        for (const [socket, fn] of listeners) {
                            socket.off('chuyen_luot_ve', fn);
                        }

                        reject(
                            new Error(
                                `Không nhận được vai trò người vẽ ở phòng ${ri + 1}.`
                            )
                        );
                    }, ROLE_TIMEOUT_MS);

                    for (const socket of group) {
                        const fn = (data) => {
                            if (
                                settled ||
                                data?.vaiTro !== 'nguoi_ve'
                            ) {
                                return;
                            }

                            settled = true;

                            clearTimeout(timer);

                            for (
                                const [s, listener] of listeners
                            ) {
                                s.off('chuyen_luot_ve', listener);
                            }

                            resolve(socket);
                        };

                        listeners.push([socket, fn]);

                        socket.on('chuyen_luot_ve', fn);
                    }
                })
        );

        // 7. Bắt đầu trận đấu ở tất cả các phòng.
        for (const room of rooms) {
            await ack(
                room.host,
                'bat_dau_tran_dau'
            );
        }

        // Chờ xác định người vẽ ở từng phòng.
        const drawers = await Promise.all(drawerPromises);

        console.log(
            `Đã bắt đầu ${rooms.length} trận; ` +
            `mỗi phòng đã xác định được người vẽ.`
        );

        // 8. Kiểm tra truyền dữ liệu vẽ.
        for (
            let ri = 0;
            ri < rooms.length;
            ri++
        ) {
            const room = rooms[ri];
            const drawer = drawers[ri];

            // Người vẽ không nhận lại dữ liệu vẽ của chính mình.
            const receivers = room.sockets.length - 1;

            for (
                let si = 0;
                si < STROKES_PER_ROOM;
                si++
            ) {
                const id =
                    `bench-${ri}-${si}-${Date.now()}`;

                // Tạo 25 điểm tọa độ chuẩn hóa từ 0 đến 1.
                const points = Array.from(
                    { length: POINTS_PER_STROKE },
                    (_, i) => ({
                        x: i / (POINTS_PER_STROKE - 1),
                        y:
                            ((i + si) % POINTS_PER_STROKE) /
                            (POINTS_PER_STROKE - 1),
                    })
                );

                const stroke = {
                    id,
                    tool: 'brush',
                    color: '#1f2937',
                    size: 0.006,
                    points: [points[0]],
                };

                sentAt.set(id, performance.now());

                // Gửi sự kiện bắt đầu nét vẽ.
                drawer.emit(
                    'draw:stroke-start',
                    stroke
                );

                expectedStrokeStarts += receivers;

                // Gửi các điểm còn lại thành từng nhóm 5 điểm.
                for (
                    let i = 1;
                    i < points.length;
                    i += 5
                ) {
                    drawer.emit(
                        'draw:stroke-points',
                        {
                            id,
                            points: points.slice(i, i + 5),
                        }
                    );

                    expectedStrokePoints += receivers;
                }

                // Kết thúc nét vẽ.
                drawer.emit(
                    'draw:stroke-end',
                    { id }
                );

                expectedStrokeEnds += receivers;

                await sleep(15);
            }

            // 9. Kiểm tra chức năng chat.
            drawer.emit(
                'tin_nhan_chat',
                {
                    noiDungChat:
                        `Benchmark chat phòng ${ri + 1}`,
                }
            );

            // Chat được gửi đến toàn bộ thành viên,
            // bao gồm cả người gửi.
            expectedChats += room.sockets.length;
        }

        // Chờ các event được truyền và nhận.
        await sleep(1500);

        // 10. In kết quả.
        console.log('\n========== KẾT QUẢ BENCHMARK ==========');

        console.log(
            `Tổng thời gian: ` +
            `${(performance.now() - startedAt).toFixed(2)} ms`
        );

        console.log(
            `Client kết nối: ` +
            `${sockets.filter((s) => s.connected).length}/${CLIENTS}`
        );

        console.log(`Phòng được tạo: ${rooms.length}`);

        console.log(
            `Sự kiện stroke-start: ` +
            `${receivedStrokeStarts}/${expectedStrokeStarts}`
        );

        console.log(
            `Sự kiện stroke-points: ` +
            `${receivedStrokePoints}/${expectedStrokePoints}`
        );

        console.log(
            `Sự kiện stroke-end: ` +
            `${receivedStrokeEnds}/${expectedStrokeEnds}`
        );

        console.log(
            `Tin nhắn chat: ` +
            `${receivedChats}/${expectedChats}`
        );

        printLatency(
            'Kết nối',
            connectLatencies
        );

        printLatency(
            'Độ trễ stroke-start',
            strokeStartLatencies
        );

        // Tính tỷ lệ nhận event tổng hợp.
        const expected =
            expectedStrokeStarts +
            expectedStrokePoints +
            expectedStrokeEnds +
            expectedChats;

        const received =
            receivedStrokeStarts +
            receivedStrokePoints +
            receivedStrokeEnds +
            receivedChats;

        const rate =
            expected
                ? (received / expected) * 100
                : 0;

        console.log(
            `Tỷ lệ nhận sự kiện tổng hợp: ${rate.toFixed(2)}%`
        );

        console.log(
            'Độ trễ được đo cho stroke-start; ' +
            'points/end chỉ thống kê tỷ lệ nhận.'
        );

        console.log(
            'Lưu ý: đây là benchmark tải cơ bản, ' +
            'chưa phải kiểm thử 50 người thao tác liên tục trong thời gian dài.'
        );

        if (rate < 99) {
            process.exitCode = 2;
        }

    } finally {
        // Ngắt kết nối tất cả client sau khi kiểm thử.
        for (const socket of sockets) {
            if (socket.connected) {
                socket.disconnect();
            }
        }
    }
}

main().catch((error) => {
    console.error(
        '\nBenchmark thất bại:',
        error.message
    );

    process.exitCode = 1;
});
