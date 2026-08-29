const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

const rooms = {}; 
const WORLD_SIZE = 2500;
const SEEDS = {}; 

io.on('connection', (socket) => {
    
    // 🌟 닉네임 누락 방지를 위해 객체(data) 전체를 받아서 안전하게 추출합니다.
    socket.on('joinRoom', (data) => {
        const code = data.code;
        const isHost = data.isHost;
        const nickname = data.nickname || "농부"; // 닉네임이 없으면 기본값 설정

        const roomClients = io.sockets.adapter.rooms.get(code);
        const numClients = roomClients ? roomClients.size : 0;

        if (numClients >= 3) {
            socket.emit('errorMsg', '방이 꽉 찼습니다! (최대 3명)');
            return;
        }

        socket.join(code);
        socket.roomCode = code;
        socket.myId = socket.id;

        if (!rooms[code]) {
            rooms[code] = { players: {}, isStarted: false };
            SEEDS[code] = {};
        }

        const spawnX = Math.random() * 2100 + 200;
        const spawnY = Math.random() * 2100 + 200;

        rooms[code].players[socket.id] = {
            id: socket.id,
            nickname: nickname, // 🌟 1회용 닉네임 저장
            x: spawnX, y: spawnY, 
            targetX: spawnX, targetY: spawnY, 
            speed: 5,
            color: isHost ? '#3498db' : '#e74c3c',
            inputs: { up: false, down: false, left: false, right: false },
            isKeyboard: false,
            hp: 100, maxHp: 100,
            attackPower: 10,
            kills: 0,
            lastPlantedTime: 0 
        };

        socket.emit('joined', { id: socket.id, code: code, isHost: isHost });
        io.to(code).emit('roomUpdated', numClients + 1);
    });

    socket.on('startGame', () => {
        const code = socket.roomCode;
        if (code && rooms[code]) {
            rooms[code].isStarted = true; 
            io.to(code).emit('gameStarted'); 
        }
    });

    socket.on('plantSeed', () => {
        const code = socket.roomCode;
        if (code && rooms[code] && rooms[code].isStarted) {
            const p = rooms[code].players[socket.id];
            if (!p) return;

            const now = Date.now();
            if (now - p.lastPlantedTime < 7000) return; 
            p.lastPlantedTime = now;

            const seedId = Math.random().toString(36.25);
            SEEDS[code][seedId] = {
                x: p.x, y: p.y,
                grown: false,
                ownerId: socket.id
            };

            setTimeout(() => {
                if (SEEDS[code] && SEEDS[code][seedId]) {
                    SEEDS[code][seedId].grown = true;
                }
            }, 5000);
        }
    });

    socket.on('attack', () => {
        const code = socket.roomCode;
        if (code && rooms[code] && rooms[code].isStarted) {
            const attacker = rooms[code].players[socket.id];
            if (!attacker) return;

            io.to(code).emit('playerSwung', { x: attacker.x, y: attacker.y });

            for (let targetId in rooms[code].players) {
                if (targetId !== socket.id) {
                    let target = rooms[code].players[targetId];
                    let dx = target.x - attacker.x;
                    let dy = target.y - attacker.y;
                    let distance = Math.sqrt(dx * dx + dy * dy);
                    
                    if (distance < 80) { 
                        target.hp -= attacker.attackPower; 
                        
                        io.to(code).emit('playerHit', { x: target.x, y: target.y });
                        
                        if (target.hp <= 0) {
                            target.hp = target.maxHp;
                            target.x = Math.random() * 2100 + 200;
                            target.y = Math.random() * 2100 + 200;
                            target.targetX = target.x;
                            target.targetY = target.y;

                            attacker.kills += 1;

                            if (attacker.kills >= 3) {
                                rooms[code].isStarted = false; 
                                io.to(code).emit('gameOver', { winnerId: socket.id, winnerName: attacker.nickname }); 
                            }
                        }
                    }
                }
            }
        }
    });

    socket.on('move', (target) => {
        const code = socket.roomCode;
        if (code && rooms[code] && rooms[code].players[socket.id]) {
            rooms[code].players[socket.id].targetX = target.x;
            rooms[code].players[socket.id].targetY = target.y;
            rooms[code].players[socket.id].isKeyboard = false;
        }
    });

    socket.on('keyInput', (inputs) => {
        const code = socket.roomCode;
        if (code && rooms[code] && rooms[code].players[socket.id]) {
            rooms[code].players[socket.id].inputs = inputs;
            rooms[code].players[socket.id].isKeyboard = true;
        }
    });

    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (code && rooms[code]) {
            delete rooms[code].players[socket.id];
            
            const roomClients = io.sockets.adapter.rooms.get(code);
            const numClients = roomClients ? roomClients.size : 0;
            io.to(code).emit('roomUpdated', numClients);

            if (Object.keys(rooms[code].players).length === 0) {
                delete rooms[code];
                delete SEEDS[code];
            }
        }
    });
});

setInterval(() => {
    for (let code in rooms) {
        if (!rooms[code].isStarted) continue;

        let players = rooms[code].players;
        
        if (SEEDS[code]) {
            for (let seedId in SEEDS[code]) {
                let seed = SEEDS[code][seedId];
                if (seed.grown) {
                    for (let id in players) {
                        let p = players[id];
                        let dx = p.x - seed.x;
                        let dy = p.y - seed.y;
                        let distance = Math.sqrt(dx * dx + dy * dy);
                        
                        if (distance < 40) {
                            p.attackPower += 1; 
                            delete SEEDS[code][seedId]; 
                            io.to(code).emit('seedHarvested', { x: seed.x, y: seed.y });
                            break;
                        }
                    }
                }
            }
        }

        for (let id in players) {
            let p = players[id];
            if (p.isKeyboard) {
                let dx = 0; let dy = 0;
                if (p.inputs.up) dy -= 1;
                if (p.inputs.down) dy += 1;
                if (p.inputs.left) dx -= 1;
                if (p.inputs.right) dx += 1;
                
                if (dx !== 0 && dy !== 0) {
                    const length = Math.sqrt(dx * dx + dy * dy);
                    dx /= length; dy /= length;
                }
                
                p.x += dx * p.speed;
                p.y += dy * p.speed;
                p.x = Math.max(0, Math.min(p.x, WORLD_SIZE));
                p.y = Math.max(0, Math.min(p.y, WORLD_SIZE));
                p.targetX = p.x; p.targetY = p.y;
            } else {
                const dx = p.targetX - p.x;
                const dy = p.targetY - p.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > p.speed) {
                    p.x += (dx / distance) * p.speed;
                    p.y += (dy / distance) * p.speed;
                }
            }
        }
        
        io.to(code).emit('stateUpdate', { players: players, seeds: SEEDS[code] });
    }
}, 1000 / 60);

http.listen(3000, () => { console.log('서버가 성공적으로 열렸습니다!'); });