const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};
const WORLD_SIZE = 2500;

io.on('connection', (socket) => {
    console.log(`사용자 접속: ${socket.id}`);

    socket.on('joinRoom', ({ code, isHost, nickname }) => {
        if (socket.roomCode) {
            leaveRoom(socket);
        }

        if (!rooms[code]) {
            if (!isHost) {
                socket.emit('errorMsg', '존재하지 않는 방입니다.');
                return;
            }
            rooms[code] = {
                code: code,
                hostId: socket.id,
                started: false,
                players: {},
                seeds: {},
                rocks: Array.from({ length: 15 }, () => ({
                    x: Math.floor(Math.random() * 2100) + 200,
                    y: Math.floor(Math.random() * 2100) + 200,
                    radius: 40
                }))
            };
        }

        const room = rooms[code];
        const playerCount = Object.keys(room.players).length;

        if (playerCount >= 3) {
            socket.emit('errorMsg', '방이 꽉 찼습니다. (최대 3명)');
            return;
        }

        if (room.started) {
            socket.emit('errorMsg', '이미 시작된 게임입니다.');
            return;
        }

        socket.roomCode = code;
        socket.join(code);

        const colors = ['#e74c3c', '#3498db', '#9b59b6'];
        const color = colors[playerCount % colors.length];

        room.players[socket.id] = {
            id: socket.id,
            nickname: nickname || '농부',
            x: Math.floor(Math.random() * 1500) + 500,
            y: Math.floor(Math.random() * 1500) + 500,
            color: color,
            hp: 100,
            maxHp: 100,
            kills: 0,
            attackPower: 10, // 기본 공격력 10
            applesLeft: 2,   // 사과 기본 2개
            holdingScythe: true, // 기본 낫 장착 상태
            keys: { up: false, down: false, left: false, right: false },
            targetX: null,
            targetY: null
        };

        if (isHost && !room.hostId) {
            room.hostId = socket.id;
        }

        socket.emit('joined', { id: socket.id, code: code, isHost: room.hostId === socket.id });
        io.to(code).emit('roomUpdated', Object.keys(room.players).length);
    });

    socket.on('startGame', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];

        if (room.hostId === socket.id && !room.started) {
            room.started = true;
            io.to(code).emit('gameStarted');
        }
    });

    socket.on('keyInput', (keys) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const player = rooms[code].players[socket.id];
        if (player) {
            player.keys = keys;
            if (keys.up || keys.down || keys.left || keys.right) {
                player.targetX = null;
                player.targetY = null;
            }
        }
    });

    socket.on('move', (data) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const player = rooms[code].players[socket.id];
        if (player) {
            player.targetX = data.x;
            player.targetY = data.y;
        }
    });

    socket.on('selectItem', (itemIndex) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const player = rooms[code].players[socket.id];
        if (player) {
            player.holdingScythe = (itemIndex === 0);
        }
    });

    socket.on('attack', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        const attacker = room.players[socket.id];
        if (!attacker) return;

        io.to(code).emit('playerSwung', { x: attacker.x, y: attacker.y });

        for (let id in room.players) {
            if (id === socket.id) continue;
            const target = room.players[id];
            const dist = Math.hypot(attacker.x - target.x, attacker.y - target.y);

            if (dist < 60) {
                target.hp -= attacker.attackPower;
                io.to(code).emit('playerHit', { x: target.x, y: target.y });

                if (target.hp <= 0) {
                    target.hp = target.maxHp;
                    target.x = Math.floor(Math.random() * 1500) + 500;
                    target.y = Math.floor(Math.random() * 1500) + 500;
                    target.attackPower = 10; // 죽었을 때 기본 공격력 10으로 초기화
                    attacker.kills++;
                    attacker.attackPower += 0;

                    if (attacker.kills >= 3) {
                        io.to(code).emit('gameOver', { winnerId: attacker.id, winnerName: attacker.nickname });
                        room.started = false;
                    }
                }
            }
        }
    });

    let seedIdCounter = 0;
    socket.on('plantSeed', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        const player = room.players[socket.id];
        if (!player) return;

        const sId = seedIdCounter++;
        room.seeds[sId] = {
            id: sId,
            x: player.x,
            y: player.y,
            grown: false,
            growTime: Date.now() + 5000
        };
    });

    socket.on('eatApple', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const player = rooms[code].players[socket.id];
        if (!player) return;

        if (player.applesLeft === undefined) player.applesLeft = 2;

        if (player.applesLeft > 0) {
            player.applesLeft--;
            player.hp = Math.min(player.maxHp, player.hp + 30);
        }
    });

    socket.on('disconnect', () => {
        leaveRoom(socket);
        console.log(`사용자 접속 해제: ${socket.id}`);
    });

    function leaveRoom(sock) {
        const code = sock.roomCode;
        if (code && rooms[code]) {
            const room = rooms[code];
            delete room.players[sock.id];
            sock.leave(code);

            const remainingPlayers = Object.keys(room.players);
            if (remainingPlayers.length === 0) {
                delete rooms[code];
            } else {
                if (room.hostId === sock.id) {
                    room.hostId = remainingPlayers[0];
                }
                io.to(code).emit('roomUpdated', remainingPlayers.length);
            }
            sock.roomCode = null;
        }
    }
});

setInterval(() => {
    for (let code in rooms) {
        const room = rooms[code];
        if (!room.started) continue;

        const now = Date.now();
        for (let sId in room.seeds) {
            let seed = room.seeds[sId];
            if (!seed.grown && now >= seed.growTime) {
                seed.grown = true;
            }
        }

        for (let id in room.players) {
            let p = room.players[id];
            const speed = 9;

            let dx = 0, dy = 0;
            if (p.keys.up) dy -= 1;
            if (p.keys.down) dy += 1;
            if (p.keys.left) dx -= 1;
            if (p.keys.right) dx += 1;

            let moveX = 0, moveY = 0;
            if (dx !== 0 || dy !== 0) {
                const length = Math.hypot(dx, dy);
                moveX = (dx / length) * speed;
                moveY = (dy / length) * speed;
                p.targetX = null;
                p.targetY = null;
            } else if (p.targetX !== null && p.targetY !== null) {
                const distX = p.targetX - p.x;
                const distY = p.targetY - p.y;
                const distance = Math.hypot(distX, distY);

                if (distance > speed) {
                    moveX = (distX / distance) * speed;
                    moveY = (distY / distance) * speed;
                } else {
                    moveX = distX;
                    moveY = distY;
                    p.targetX = null;
                    p.targetY = null;
                }
            }

            let testX = p.x + moveX;
            let collideX = false;
            for (let rock of room.rocks) {
                if (Math.hypot(testX - rock.x, p.y - rock.y) < 25 + rock.radius) {
                    collideX = true;
                    break;
                }
            }
            if (!collideX) p.x = testX;
            else p.targetX = null;

            let testY = p.y + moveY;
            let collideY = false;
            for (let rock of room.rocks) {
                if (Math.hypot(p.x - rock.x, testY - rock.y) < 25 + rock.radius) {
                    collideY = true;
                    break;
                }
            }
            if (!collideY) p.y = testY;
            else p.targetY = null;

            p.x = Math.max(25, Math.min(WORLD_SIZE - 25, p.x));
            p.y = Math.max(25, Math.min(WORLD_SIZE - 25, p.y));

            for (let sId in room.seeds) {
                let seed = room.seeds[sId];
                if (seed.grown) {
                    const dist = Math.hypot(p.x - seed.x, p.y - seed.y);
                    if (dist < 35) {
                        p.attackPower += 1;
                        p.hp = Math.min(p.maxHp, p.hp + 15);
                        delete room.seeds[sId];
                        io.to(code).emit('seedHarvested', { x: seed.x, y: seed.y });
                    }
                }
            }
        }

        io.to(code).emit('stateUpdate', {
            players: room.players,
            seeds: room.seeds,
            rocks: room.rocks
        });
    }
}, 1000 / 20);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
