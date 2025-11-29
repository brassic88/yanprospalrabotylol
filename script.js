// --- БАЛАНС ---
const CONFIG = {
    walkSpeed: 38.0,
    sprintSpeed: 95.0, // Очень быстро
    monsterSpeed: 40.0, // Медленно
    adrenalineDuration: 3.0, // Медленная трата (хватит надолго)
    spawnDistance: 35, // Монстр появляется ближе, чтобы его было видно
    fogDensity: 0.03,
    chaseDuration: 15000 // 15 секунд
};

const state = {
    notes: 0, totalNotes: 10, isGameOver: false,
    monsterState: 'idle', sprint: false, stamina: 100,
    battery: 100, flashlightOn: true, volume: 0.5,
    panicMode: false, invertedMode: false,
    adrenaline: 0, maxAdrenaline: 100,
    timeLeft: 600, maxTime: 600
};

let scene, camera, renderer, controls;
let flashLight, ambientSound;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let notes = [], monster;
let particles;
let chaseTimer = null;
let heartBeatTimer = null;

// Elements
const staminaBar = document.getElementById('stamina-bar');
const batteryBar = document.getElementById('battery-bar');
const adrenalineWrapper = document.getElementById('adrenaline-wrapper');
const adrenalineBar = document.getElementById('adrenaline-bar');
const timeBar = document.getElementById('time-bar');
const msgEl = document.getElementById('note-msg');
const cpMsgEl = document.getElementById('checkpoint-msg');
const flashEl = document.getElementById('flash');
const bloodEl = document.getElementById('blood-overlay');
const staticEl = document.getElementById('static-overlay');

// Audio
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);
masterGain.gain.value = 0.5;

document.getElementById('volume-slider').addEventListener('input', (e) => {
    state.volume = e.target.value / 100;
    masterGain.gain.value = state.volume;
});

document.getElementById('start-btn').addEventListener('click', () => {
    if (!scene) initGame();
    state.timeLeft = 600;
    controls.lock();
    document.getElementById('instructions').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!ambientSound) ambientSound = playSound('drone');
});

document.getElementById('respawn-btn').addEventListener('click', respawnPlayer);

function playSound(type) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(masterGain);
    const now = audioCtx.currentTime;

    if (type === 'pickup') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    } else if (type === 'scream') {
        const bufferSize = audioCtx.sampleRate * 2.0;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
        const noise = audioCtx.createBufferSource(); noise.buffer = buffer;
        const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2000;
        noise.connect(filter); filter.connect(gain);
        gain.gain.setValueAtTime(1.0, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 2.0);
        noise.start(now);

        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(50, now + 1.0);
        gain.gain.setValueAtTime(0.5, now);
        osc.start(now); osc.stop(now + 1.0);
    } else if (type === 'whisper') {
        const bufferSize = audioCtx.sampleRate * 1.0;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = audioCtx.createBufferSource(); noise.buffer = buffer;
        const filter = audioCtx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 400;
        noise.connect(filter); filter.connect(gain);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.8, now + 0.5);
        gain.gain.linearRampToValueAtTime(0, now + 1.0);
        noise.start(now);
    } else if (type === 'drone') {
        osc.type = 'sine'; osc.frequency.value = 60; gain.gain.value = 0.05;
        osc.start(now); return { osc, gain };
    } else if (type === 'heartbeat') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(50, now);
        osc.frequency.exponentialRampToValueAtTime(1, now + 0.1);
        gain.gain.setValueAtTime(0.8, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'flicker') {
        osc.type = 'square'; osc.frequency.setValueAtTime(50, now);
        gain.gain.setValueAtTime(0.1, now); osc.start(now); osc.stop(now + 0.05);
    }
}

// --- INIT ---
function initGame() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020202);
    scene.fog = new THREE.FogExp2(0x020202, CONFIG.fogDensity);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    flashLight = new THREE.SpotLight(0xffffff, 1.2, 50, Math.PI / 4, 0.5, 1);
    flashLight.position.set(0, 0, 0);
    flashLight.target.position.set(0, 0, -1);
    camera.add(flashLight);
    camera.add(flashLight.target);
    scene.add(camera);

    const moonLight = new THREE.DirectionalLight(0x222244, 0.3);
    moonLight.position.set(50, 100, 50);
    scene.add(moonLight);

    // FLAT FLOOR
    const floorGeo = new THREE.PlaneGeometry(300, 300);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // TREES
    for (let i = 0; i < 300; i++) {
        const x = (Math.random() - 0.5) * 200;
        const z = (Math.random() - 0.5) * 200;
        if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;

        const treeGroup = new THREE.Group();
        treeGroup.position.set(x, 0, z);

        const trunkH = 2 + Math.random() * 2;
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.4, trunkH, 6),
            new THREE.MeshStandardMaterial({ color: 0x050505 })
        );
        trunk.position.y = trunkH / 2;
        treeGroup.add(trunk);

        const cones = Math.floor(Math.random() * 2) + 2;
        for(let j=0; j<cones; j++) {
            const coneH = 2 + Math.random();
            const coneW = 1.5 - (j * 0.3);
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(coneW, coneH, 7),
                new THREE.MeshStandardMaterial({ color: 0x070907 })
            );
            cone.position.y = trunkH + (j * 1.5);
            treeGroup.add(cone);
        }

        treeGroup.rotation.y = Math.random() * Math.PI;
        treeGroup.rotation.z = (Math.random() - 0.5) * 0.1;
        treeGroup.rotation.x = (Math.random() - 0.5) * 0.1;
        scene.add(treeGroup);
    }

    // PARTICLES
    const particlesGeo = new THREE.BufferGeometry();
    const particlesCount = 1000;
    const posArray = new Float32Array(particlesCount * 3);
    for(let i=0; i<particlesCount * 3; i++) posArray[i] = (Math.random() - 0.5) * 100;
    particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particlesMat = new THREE.PointsMaterial({ size: 0.1, color: 0xaaaaaa, transparent: true, opacity: 0.5 });
    particles = new THREE.Points(particlesGeo, particlesMat);
    camera.add(particles);

    // NOTES
    const noteGeo = new THREE.PlaneGeometry(0.4, 0.5);
    const noteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    for (let i = 0; i < state.totalNotes; i++) {
        let nx, nz;
        let safe = false;
        while(!safe) {
            nx = (Math.random() - 0.5) * 180;
            nz = (Math.random() - 0.5) * 180;
            if (Math.sqrt(nx*nx + nz*nz) > 15) safe = true;
        }

        const note = new THREE.Mesh(noteGeo, noteMat);
        note.position.set(nx, 1.5, nz);
        note.rotation.y = Math.random() * Math.PI * 2;

        const noteLight = new THREE.PointLight(0x00ffff, 1, 10);
        noteLight.position.z = 0.2;
        note.add(noteLight);

        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 4), new THREE.MeshStandardMaterial({color:0x333333}));
        stick.position.y = -0.75;
        note.add(stick);

        scene.add(note);
        notes.push(note);
    }

    // MONSTER
    const monsterGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.1, 2.6, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    body.position.y = 1.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshBasicMaterial({color: 0x000000}));
    head.position.y = 2.6;

    // ГЛАЗА (СВЕТЯЩИЕСЯ)
    const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    const eyes2 = eyes.clone();
    eyes.position.set(-0.15, 2.6, 0.35);
    eyes2.position.set(0.15, 2.6, 0.35);

    // Свет от глаз монстра, чтобы видеть его в темноте
    const eyeLight = new THREE.PointLight(0xff0000, 1, 5);
    eyeLight.position.set(0, 2.6, 0.5);
    monsterGroup.add(eyeLight);

    monsterGroup.add(body); monsterGroup.add(head); monsterGroup.add(eyes); monsterGroup.add(eyes2);
    monster = monsterGroup;
    monster.position.set(0, -100, 0);
    scene.add(monster);

    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x020202);
    document.body.appendChild(renderer.domElement);

    controls = new THREE.PointerLockControls(camera, document.body);
    scene.add(controls.getObject());

    document.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'ArrowUp': case 'KeyW': moveForward = true; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
            case 'ArrowDown': case 'KeyS': moveBackward = true; break;
            case 'ArrowRight': case 'KeyD': moveRight = true; break;
            case 'ShiftLeft': state.sprint = true; break;
            case 'KeyF': state.flashlightOn = !state.flashlightOn; playSound('flicker'); break;
        }
    });
    document.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'ArrowUp': case 'KeyW': moveForward = false; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
            case 'ArrowDown': case 'KeyS': moveBackward = false; break;
            case 'ArrowRight': case 'KeyD': moveRight = false; break;
            case 'ShiftLeft': state.sprint = false; break;
        }
    });
    document.addEventListener('mousedown', () => {
        if (controls.isLocked) {
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
            const intersects = raycaster.intersectObjects(notes);
            if (intersects.length > 0) {
                const obj = intersects[0].object;
                if (obj.position.distanceTo(camera.position) < 8) collectNote(obj);
            }
        }
    });
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function collectNote(noteObj) {
    scene.remove(noteObj);
    notes = notes.filter(n => n !== noteObj);
    state.notes++;
    document.getElementById('notes-counter').innerText = `${state.notes} / 10`;
    playSound('pickup');

    if (state.notes % 2 === 0) {
        cpMsgEl.style.display = 'block';
        setTimeout(() => cpMsgEl.style.display = 'none', 2000);
    }
    handleRandomEvents(state.notes);
}

// --- СЛУЧАЙНЫЕ СОБЫТИЯ ---
function handleRandomEvents(count) {
    // Сюжет
    if (count === 7) {
        startChaseEvent();
        return;
    }
    if (count === 10) {
        if (state.timeLeft > 0) {
            winGame();
        } else {
            gameOver();
        }
        return;
    }

    // Пул событий
    const events = [
        triggerFaceJumpscare,
        triggerBloodMode,
        () => { showMessage("Свет нестабилен.", 3000); flickerFlashlight(5); },
        () => { showMessage("Головокружение...", 4000); state.panicMode = true; setTimeout(() => state.panicMode = false, 8000); },
        () => {
            showMessage("Они шепчут...", 4000);
            playSound('whisper');
            staticEl.style.opacity = 0.5;
            setTimeout(() => staticEl.style.opacity = 0, 1000);
        },
        () => {
            showMessage("Глаза привыкают к тьме?", 4000);
            scene.fog.color.setHex(0xffffff);
            scene.background.setHex(0xaaaaaa);
            setTimeout(() => {
                scene.fog.color.setHex(0x020202);
                scene.background.setHex(0x020202);
            }, 5000);
        }
    ];

    const randomEvent = events[Math.floor(Math.random() * events.length)];
    randomEvent();
}

function triggerFaceJumpscare() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    monster.position.copy(camera.position).add(dir.multiplyScalar(1.5));
    monster.position.y = 1.3;
    monster.lookAt(camera.position);
    playSound('scream');
    flashEl.style.opacity = 1;
    setTimeout(() => {
        monster.position.set(0, -100, 0);
        flashEl.style.opacity = 0;
    }, 800);
}

function triggerBloodMode() {
    showMessage("КРОВЬ", 4000, "red");
    bloodEl.style.display = 'block';
    scene.fog.color.setHex(0x550000);
    playSound('scream');
    setTimeout(() => {
        bloodEl.style.display = 'none';
        scene.fog.color.setHex(0x020202);
    }, 5000);
}

function startChaseEvent() {
    teleportMonsterBehindPlayer(CONFIG.spawnDistance);
    state.adrenaline = 100;
    adrenalineWrapper.style.display = 'block';
    showMessage("БЕГИ! (15 сек)", 5000, "#00ffff");
    if (ambientSound) ambientSound.gain.gain.value = 0.2;
    startHeartbeat();

    // Delay before monster starts chasing
    setTimeout(() => {
        if (!state.isGameOver) state.monsterState = 'chasing';
    }, 3000); // 3 seconds delay

    if (chaseTimer) clearTimeout(chaseTimer);
    chaseTimer = setTimeout(() => {
        if (!state.isGameOver && state.notes < 10) endChaseEvent();
    }, CONFIG.chaseDuration);
}

function endChaseEvent() {
    state.monsterState = 'hidden';
    monster.position.y = -100;
    showMessage("Тишина...", 4000, "#00ff00");
    stopHeartbeat();
    if (ambientSound) ambientSound.gain.gain.value = 0.05;
    setTimeout(() => { adrenalineWrapper.style.display = 'none'; state.adrenaline = 0; }, 2000);
}

function respawnPlayer() {
    state.isGameOver = false;
    document.getElementById('death-screen').style.display = 'none';
    controls.lock();
    camera.position.set(0, 1.7, 0);
    monster.position.y = -100;
    state.monsterState = 'hidden';
    state.stamina = 100;
    state.battery = 100;
    state.panicMode = false;
    state.timeLeft = 600;
    scene.fog.color.setHex(0x020202);

    if (chaseTimer) clearTimeout(chaseTimer);
    stopHeartbeat();
    bloodEl.style.display = 'none';
    adrenalineWrapper.style.display = 'none';
    state.adrenaline = 0;
    if (ambientSound) ambientSound.gain.gain.value = 0.05;
    showMessage("ВОЗРОЖДЕНИЕ", 3000, "#00ff00");
}

function showMessage(text, time, color = "#ffcccc") {
    msgEl.innerText = text; msgEl.style.color = color; msgEl.style.display = 'block';
    setTimeout(() => { msgEl.style.display = 'none'; }, time);
}

function flickerFlashlight(times) {
    let count = 0;
    const interval = setInterval(() => {
        flashLight.intensity = Math.random() > 0.5 ? 0 : 1.2; playSound('flicker');
        count++; if (count > times * 2) { clearInterval(interval); flashLight.intensity = 1.2; }
    }, 100);
}

function startHeartbeat() {
    if (heartBeatTimer) return;
    heartBeatTimer = setInterval(() => {
        if (state.isGameOver || state.notes >= 10) stopHeartbeat();
        playSound('heartbeat');
    }, 500);
}
function stopHeartbeat() { clearInterval(heartBeatTimer); heartBeatTimer = null; }

function teleportMonsterBehindPlayer(dist) {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const behind = dir.clone().multiplyScalar(-dist);
    monster.position.copy(camera.position).add(behind);
    monster.position.y = 1.3;
    monster.lookAt(camera.position);
}

function gameOver() {
    state.isGameOver = true; controls.unlock();
    document.getElementById('death-screen').style.display = 'flex'; playSound('scream');
}
function winGame() {
    state.isGameOver = true; controls.unlock();
    document.getElementById('win-screen').style.display = 'flex';
}

function animate() {
    requestAnimationFrame(animate);
    if (controls && controls.isLocked && !state.isGameOver) {
        const time = performance.now();
        const delta = (time - prevTime) / 1000;
        prevTime = time;

        // Update time
        state.timeLeft -= delta;
        if (state.timeLeft <= 0) {
            state.timeLeft = 0;
            if (state.notes < 10) gameOver();
        }
        timeBar.style.width = (state.timeLeft / state.maxTime * 100) + '%';

        notes.forEach(note => {
            const scale = 1 + Math.sin(time * 0.003) * 0.1;
            note.scale.set(scale, scale, scale);
        });

        if (state.panicMode) { camera.fov = 75 + Math.sin(time * 0.01) * 10; camera.updateProjectionMatrix(); }

        if (state.adrenaline > 0) {
            state.adrenaline -= CONFIG.adrenalineDuration * delta;
            if (state.adrenaline < 0) state.adrenaline = 0;
            adrenalineBar.style.width = (state.adrenaline / state.maxAdrenaline * 100) + '%';
            state.stamina = 100;
        }

        if (state.flashlightOn) {
            state.battery -= 2 * delta; flashLight.intensity = 1.2;
            if (state.battery <= 0) { state.battery = 0; flashLight.intensity = 0; }
        } else {
            state.battery += 5 * delta; flashLight.intensity = 0;
            if (state.battery > 100) state.battery = 100;
        }
        batteryBar.style.width = state.battery + '%';
        batteryBar.style.background = state.battery < 20 ? 'red' : '#ffcc00';

        if (state.adrenaline <= 0) {
            if (state.sprint && (moveForward || moveBackward || moveLeft || moveRight)) {
                state.stamina -= 20 * delta;
                if (state.stamina < 0) { state.stamina = 0; state.sprint = false; }
            } else {
                state.stamina += 10 * delta;
                if (state.stamina > 100) state.stamina = 100;
            }
        }
        staminaBar.style.width = state.stamina + '%';

        let speed = CONFIG.walkSpeed;
        if (state.sprint && (state.stamina > 0 || state.adrenaline > 0)) speed = CONFIG.sprintSpeed;

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();
        if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;
        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Physics (Player)
        camera.position.y = 1.7;

        if (camera.position.x < -100) camera.position.x = -100;
        if (camera.position.x > 100) camera.position.x = 100;
        if (camera.position.z < -100) camera.position.z = -100;
        if (camera.position.z > 100) camera.position.z = 100;

        // Monster Logic
        const dist = monster.position.distanceTo(camera.position);
        if (state.monsterState === 'chasing') {
            monster.lookAt(camera.position);
            const dir = new THREE.Vector3().subVectors(camera.position, monster.position).normalize();
            monster.position.x += dir.x * CONFIG.monsterSpeed * delta;
            monster.position.z += dir.z * CONFIG.monsterSpeed * delta;
            monster.position.y = 1.3;

            if (dist < 2.0) gameOver();
        }
    } else {
        prevTime = performance.now();
    }
    if (renderer) renderer.render(scene, camera);
}