
'use strict';

/**
 * Continuous Socket.IO stress test.
 *
 * Usage:
 * node benchmark.js [clients=50] [url=http://localhost:3000]
 *   --duration=900
 *   --report-interval=10
 *   --stroke-interval=250
 *   --chat-interval=5000
 */

const { io } = require('socket.io-client');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));

const CLIENTS = Number(positional[0] || 50);
const BASE_URL = (
    positional[1] || 'http://localhost:3000'
).replace(/\/$/, '');

function getOption(name, fallback) {
    const prefix = `--${name}=`;
    const arg = args.find((value) => value.startsWith(prefix));

    if (!arg) return fallback;

    const value = Number(arg.slice(prefix.length));

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Giá trị --${name} không hợp lệ.`);
    }

    return value;
}

const DURATION_SEC = getOption('duration', 60);
const REPORT_INTERVAL_SEC = getOption('report-interval', 10);
const STROKE_INTERVAL_MS = getOption('stroke-interval', 250);
const CHAT_INTERVAL_MS = getOption('chat-interval', 5000);

const ACK_TIMEOUT_MS = 10000;
const ROLE_TIMEOUT_MS = 8000;
const POINTS_PER_STROKE = 25;
const POINTS_PER_CHUNK = 5;

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

if (!Number.isInteger(CLIENTS) || CLIENTS < 3) {
    console.error('Số client phải là số nguyên >= 3.');
    process.exit(1);
}

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

function connectClient(index) {
    return new Promise((resolve, reject) => {
        const socket = io(BASE_URL, {
            transports: ['websocket'],
            reconnection: false,
            timeout: ACK_TIMEOUT_MS,
        });

        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error(`Client ${index} kết nối quá thời gian.`));
        }, ACK_TIMEOUT_MS);

        socket.once('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });

        socket.once('connect_error', (error) => {
            clearTimeout(timer);
            reject(new Error(`Client ${index}: ${error.message}`));
        });
    });
}

function percentile(values, p) {
    if (!values.length) return null;

    const sorted = [...values].sort((a, b) => a - b);

    return sorted[
        Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
    ];
}

function latencySummary(values) {
    if (!values.length) {
        return { n: 0, avg: null, p50: null, p95: null, p99: null, max: null };
    }

    return {
        n: values.length,
        avg: values.reduce((sum, value) => sum + value, 0) / values.length,
        p50: percentile(values, 0.50),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
        max: Math.max(...values),
    };
}

function formatLatency(label, values) {
    const s = latencySummary(values);

    if (!s.n) return `${label}: chưa có mẫu`;

    return (
        `${label}: n=${s.n}, avg=${s.avg.toFixed(2)} ms, ` +
        `p50=${s.p50.toFixed(2)} ms, ` +
        `p95=${s.p95.toFixed(2)} ms, ` +
        `p99=${s.p99.toFixed(2)} ms, ` +
        `max=${s.max.toFixed(2)} ms`
    );
}

async function main() {
    const sockets = [];
    const rooms = [];
    const connectLatencies = [];
    const strokeLatencies = [];
    const pendingStrokeStarts = new Map();

    const totals = {
        strokeStartsSent: 0,
        strokeStartsExpected: 0,
        strokeStartsReceived: 0,
        strokePointsSent: 0,
        strokePointsExpected: 0,
        strokePointsReceived: 0,
        strokeEndsSent: 0,
        strokeEndsExpected: 0,
        strokeEndsReceived: 0,
        chatsSent: 0,
        chatsExpected: 0,
        chatsReceived: 0,
        disconnects: 0,
        socketErrors: 0,
    };

    const windowCounts = {
        strokeStartsSent: 0,
        strokeStartsExpected: 0,
        strokeStartsReceived: 0,
        strokePointsSent: 0,
        strokePointsExpected: 0,
        strokePointsReceived: 0,
        strokeEndsSent: 0,
        strokeEndsExpected: 0,
        strokeEndsReceived: 0,
        chatsSent: 0,
        chatsExpected: 0,
        chatsReceived: 0,
        disconnects: 0,
        socketErrors: 0,
    };

    let shuttingDown = false;
    let reportingTimer;
    let deadlineTimer;

    const startedAt = performance.now();
    const deadline = startedAt + DURATION_SEC * 1000;

    function increment(name, amount = 1) {
        totals[name] += amount;
        windowCounts[name] += amount;
    }

    function printWindowReport() {
        const elapsed = (performance.now() - startedAt) / 1000;
        const connected = sockets.filter((socket) => socket.connected).length;

        const expected =
            windowCounts.strokeStartsExpected +
            windowCounts.strokePointsExpected +
            windowCounts.strokeEndsExpected +
            windowCounts.chatsExpected;

        const received =
            windowCounts.strokeStartsReceived +
            windowCounts.strokePointsReceived +
            windowCounts.strokeEndsReceived +
            windowCounts.chatsReceived;

        const delivery = expected > 0
            ? `${((received / expected) * 100).toFixed(2)}%`
            : 'chưa có mẫu';

        console.log(
            `[${elapsed.toFixed(0)}s] ` +
            `connected=${connected}/${CLIENTS} | ` +
            `stroke-start=${windowCounts.strokeStartsReceived}/` +
            `${windowCounts.strokeStartsExpected} | ` +
            `points=${windowCounts.strokePointsReceived}/` +
            `${windowCounts.strokePointsExpected} | ` +
            `end=${windowCounts.strokeEndsReceived}/` +
            `${windowCounts.strokeEndsExpected} | ` +
            `chat=${windowCounts.chatsReceived}/` +
            `${windowCounts.chatsExpected} | ` +
            `delivery=${delivery} | ` +
            `disconnects=+${windowCounts.disconnects} | ` +
            `errors=+${windowCounts.socketErrors}`
        );

        for (const key of Object.keys(windowCounts)) {
            windowCounts[key] = 0;
        }
    }

    try {
        console.log('========== CONTINUOUS STRESS TEST ==========');
        console.log(`Server: ${BASE_URL}`);
        console.log(`Clients: ${CLIENTS}`);
        console.log(`Duration: ${DURATION_SEC} seconds`);
        console.log(`Report interval: ${REPORT_INTERVAL_SEC} seconds`);
        console.log(`Stroke interval per room: ${STROKE_INTERVAL_MS} ms`);
        console.log(`Chat interval per room: ${CHAT_INTERVAL_MS} ms`);

        const health = await fetch(`${BASE_URL}/health`);

        if (!health.ok) {
            throw new Error(`/health trả HTTP ${health.status}`);
        }

        console.log(`Health check: ${JSON.stringify(await health.json())}`);

        const groupSizes = [];
        let remaining = CLIENTS;

        while (remaining > 0) {
            const size = Math.min(10, remaining);
            groupSizes.push(size);
            remaining -= size;
        }

        if (groupSizes.length > 1 && groupSizes.at(-1) < 3) {
            const move = 3 - groupSizes.at(-1);
            groupSizes[groupSizes.length - 2] -= move;
            groupSizes[groupSizes.length - 1] += move;
        }

        if (groupSizes.some((size) => size < 3 || size > 10)) {
            throw new Error('Không thể chia client thành phòng hợp lệ (3–10 người/phòng).');
        }

        console.log(
            `Rooms: ${groupSizes.length}; sizes: ${groupSizes.join(', ')}`
        );

        const connectStart = performance.now();

        const connected = await Promise.all(
            Array.from({ length: CLIENTS }, async (_, index) => {
                const t0 = performance.now();
                const socket = await connectClient(index + 1);
                connectLatencies.push(performance.now() - t0);
                sockets.push(socket);
                return socket;
            })
        );

        console.log(
            `Connected ${connected.length}/${CLIENTS} in ` +
            `${(performance.now() - connectStart).toFixed(2)} ms.`
        );

        for (const socket of sockets) {
            socket.on('draw:stroke-start', (stroke) => {
                increment('strokeStartsReceived');

                const sentAt = pendingStrokeStarts.get(stroke?.id);

                if (sentAt !== undefined) {
                    strokeLatencies.push(performance.now() - sentAt);
                }
            });

            socket.on('draw:stroke-points', () => {
                increment('strokePointsReceived');
            });

            socket.on('draw:stroke-end', () => {
                increment('strokeEndsReceived');
            });

            socket.on('tin_nhan_tu_server', (message) => {
                if (message?.loai === 'chat') {
                    increment('chatsReceived');
                }
            });

            socket.on('disconnect', () => {
                if (!shuttingDown) increment('disconnects');
            });

            socket.on('connect_error', () => {
                if (!shuttingDown) increment('socketErrors');
            });

            socket.on('error', () => {
                if (!shuttingDown) increment('socketErrors');
            });
        }

        let offset = 0;

        for (let ri = 0; ri < groupSizes.length; ri++) {
            const group = connected.slice(offset, offset + groupSizes[ri]);
            offset += groupSizes[ri];

            const created = await ack(group[0], 'tao_phong', {
                tenNguoiChon: `Stress-${ri + 1}-1`,
                thoiGianPhut: Math.max(1, Math.ceil(DURATION_SEC / 60) + 1),
                soNguoiToiDa: group.length,
            });

            const roomId = created.phong.idPhong;

            for (let pi = 1; pi < group.length; pi++) {
                await ack(group[pi], 'tham_gia_phong', {
                    idPhong: roomId,
                    tenNguoiChon: `Stress-${ri + 1}-${pi + 1}`,
                });
            }

            rooms.push({
                id: roomId,
                sockets: group,
                host: group[0],
            });

            console.log(`Room ${ri + 1}: ${roomId}, ${group.length} players.`);
        }

        const drawerPromises = rooms.map(({ sockets: group }, roomIndex) =>
            new Promise((resolve, reject) => {
                let settled = false;
                const listeners = [];

                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;

                    for (const [socket, listener] of listeners) {
                        socket.off('chuyen_luot_ve', listener);
                    }

                    reject(
                        new Error(
                            `Không nhận được vai trò người vẽ ở phòng ${roomIndex + 1}.`
                        )
                    );
                }, ROLE_TIMEOUT_MS);

                for (const socket of group) {
                    const listener = (data) => {
                        if (settled || data?.vaiTro !== 'nguoi_ve') return;

                        settled = true;
                        clearTimeout(timer);

                        for (const [s, fn] of listeners) {
                            s.off('chuyen_luot_ve', fn);
                        }

                        resolve(socket);
                    };

                    listeners.push([socket, listener]);
                    socket.on('chuyen_luot_ve', listener);
                }
            })
        );

        for (const room of rooms) {
            await ack(room.host, 'bat_dau_tran_dau');
        }

        const drawers = await Promise.all(drawerPromises);

        console.log(`Started ${rooms.length} matches.`);
        console.log('Starting continuous drawing/chat workload...');

        reportingTimer = setInterval(
            printWindowReport,
            REPORT_INTERVAL_SEC * 1000
        );

        deadlineTimer = setTimeout(() => {
            shuttingDown = true;
        }, DURATION_SEC * 1000);

        const workers = rooms.map(async (room, roomIndex) => {
            const drawer = drawers[roomIndex];
            const receivers = room.sockets.length - 1;
            let strokeSequence = 0;
            let lastChatAt = performance.now();

            while (!shuttingDown && performance.now() < deadline) {
                if (!drawer.connected) {
                    await sleep(250);
                    continue;
                }

                const now = performance.now();

                // Send a chat periodically from the drawer.
                if (now - lastChatAt >= CHAT_INTERVAL_MS) {
                    drawer.emit('tin_nhan_chat', {
                        noiDungChat: `Stress test room ${roomIndex + 1} ` +
                            `${Math.floor((now - startedAt) / 1000)}s`,
                    });

                    increment('chatsSent');
                    increment('chatsExpected', room.sockets.length);
                    lastChatAt = now;
                }

                const id = `stress-${roomIndex}-${strokeSequence++}-${Date.now()}`;

                const points = Array.from(
                    { length: POINTS_PER_STROKE },
                    (_, i) => ({
                        x: i / (POINTS_PER_STROKE - 1),
                        y: ((i + strokeSequence) % POINTS_PER_STROKE) /
                            (POINTS_PER_STROKE - 1),
                    })
                );

                pendingStrokeStarts.set(id, performance.now());

                // Keep the latency map bounded during long runs.
                if (pendingStrokeStarts.size > 50000) {
                    const oldest = pendingStrokeStarts.keys().next().value;
                    pendingStrokeStarts.delete(oldest);
                }

                drawer.emit('draw:stroke-start', {
                    id,
                    tool: 'brush',
                    color: '#1f2937',
                    size: 0.006,
                    points: [points[0]],
                });

                increment('strokeStartsSent');
                increment('strokeStartsExpected', receivers);

                for (let i = 1; i < points.length; i += POINTS_PER_CHUNK) {
                    drawer.emit('draw:stroke-points', {
                        id,
                        points: points.slice(i, i + POINTS_PER_CHUNK),
                    });

                    increment('strokePointsSent');
                    increment('strokePointsExpected', receivers);
                }

                drawer.emit('draw:stroke-end', { id });

                increment('strokeEndsSent');
                increment('strokeEndsExpected', receivers);

                await sleep(STROKE_INTERVAL_MS);
            }
        });

        await Promise.all(workers);

        // Allow buffered network events a short time to arrive.
        await sleep(2000);

        shuttingDown = true;

        if (reportingTimer) clearInterval(reportingTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);

        console.log('\n========== FINAL STRESS TEST REPORT ==========');
        console.log(
            `Elapsed: ${((performance.now() - startedAt) / 1000).toFixed(2)} seconds`
        );
        console.log(
            `Connected at end: ${sockets.filter((socket) => socket.connected).length}/${CLIENTS}`
        );
        console.log(`Rooms: ${rooms.length}`);

        console.log(
            `Stroke-start received: ${totals.strokeStartsReceived}/` +
            `${totals.strokeStartsExpected}`
        );
        console.log(
            `Stroke-points received: ${totals.strokePointsReceived}/` +
            `${totals.strokePointsExpected}`
        );
        console.log(
            `Stroke-end received: ${totals.strokeEndsReceived}/` +
            `${totals.strokeEndsExpected}`
        );
        console.log(
            `Chat received: ${totals.chatsReceived}/${totals.chatsExpected}`
        );
        console.log(`Unexpected disconnects: ${totals.disconnects}`);
        console.log(`Socket errors: ${totals.socketErrors}`);

        console.log(formatLatency('Connection latency', connectLatencies));
        console.log(formatLatency('Stroke-start latency', strokeLatencies));

        const expected =
            totals.strokeStartsExpected +
            totals.strokePointsExpected +
            totals.strokeEndsExpected +
            totals.chatsExpected;

        const received =
            totals.strokeStartsReceived +
            totals.strokePointsReceived +
            totals.strokeEndsReceived +
            totals.chatsReceived;

        const deliveryRate = expected > 0 ? (received / expected) * 100 : 0;

        console.log(`Aggregate event delivery: ${deliveryRate.toFixed(2)}%`);

        const report = {
            server: BASE_URL,
            clients: CLIENTS,
            durationSeconds: DURATION_SEC,
            reportIntervalSeconds: REPORT_INTERVAL_SEC,
            strokeIntervalMs: STROKE_INTERVAL_MS,
            chatIntervalMs: CHAT_INTERVAL_MS,
            elapsedSeconds: (performance.now() - startedAt) / 1000,
            connectedAtEnd: sockets.filter((socket) => socket.connected).length,
            roomCount: rooms.length,
            totals,
            connectionLatency: latencySummary(connectLatencies),
            strokeStartLatency: latencySummary(strokeLatencies),
            aggregateDeliveryRate: deliveryRate,
        };

        const reportPath = path.resolve(
            `stress-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`JSON report saved: ${reportPath}`);

        if (deliveryRate < 99 || totals.disconnects > 0 || totals.socketErrors > 0) {
            process.exitCode = 2;
        }
    } finally {
        shuttingDown = true;

        if (reportingTimer) clearInterval(reportingTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);

        for (const socket of sockets) {
            if (socket.connected) socket.disconnect();
        }
    }
}

main().catch((error) => {
    console.error('\nStress test failed:', error.stack || error.message);
    process.exitCode = 1;
});