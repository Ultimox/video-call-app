const socket = io();

const joinScreen = document.getElementById("joinScreen");
const callScreen = document.getElementById("callScreen");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const localPlaceholder = document.getElementById("localPlaceholder");
const waitingMessage = document.getElementById("waitingMessage");
const waitingRoomId = document.getElementById("waitingRoomId");
const connectionStatus = document.getElementById("connectionStatus");
const roomDisplay = document.getElementById("roomDisplay");
const callTimer = document.getElementById("callTimer");
const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const screenBtn = document.getElementById("screenBtn");
const copyBtn = document.getElementById("copyBtn");
const endBtn = document.getElementById("endBtn");
const screenShareContainer = document.getElementById("screenShareContainer");
const screenVideo = document.getElementById("screenVideo");

let localStream = null;
let peerConnection = null;
let currentRoom = null;
let micEnabled = true;
let cameraEnabled = true;
let screenSharing = false;
let screenStream = null;
let callSeconds = 0;
let timerInterval = null;

const rtcConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

joinBtn.addEventListener("click", joinRoom);

roomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinRoom();
});

async function joinRoom() {
    const roomId = roomInput.value.trim();

    if (!roomId) {
        joinError.textContent = "Please enter a room ID.";
        return;
    }

    joinError.textContent = "";
    joinBtn.disabled = true;
    joinBtn.textContent = "Requesting camera...";

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        localVideo.srcObject = localStream;
        currentRoom = roomId;

        socket.emit("join-room", roomId);
    } catch (error) {
        console.error(error);
        joinError.textContent =
            "Camera/microphone permission is required.";
        joinBtn.disabled = false;
        joinBtn.textContent = "Join Video Call";
    }
}

socket.on("room-joined", ({ roomId, users }) => {
    joinScreen.classList.add("hidden");
    callScreen.classList.remove("hidden");

    roomDisplay.textContent = `Room: ${roomId}`;
    waitingRoomId.textContent = roomId;

    if (users === 1) {
        connectionStatus.textContent =
            "Waiting for participant...";
        waitingMessage.classList.remove("hidden");
    } else {
        connectionStatus.textContent = "Connecting...";
        waitingMessage.classList.add("hidden");
    }

    updateLocalCameraUI();
});

socket.on("room-full", (message) => {
    stopLocalMedia();
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Video Call";
    joinError.textContent = message;
});

socket.on("start-call", async () => {
    waitingMessage.classList.add("hidden");
    connectionStatus.textContent = "Connecting...";

    await createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("offer", {
        roomId: currentRoom,
        offer: offer
    });
});

async function createPeerConnection() {
    if (peerConnection) return peerConnection;

    peerConnection = new RTCPeerConnection(rtcConfiguration);

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }

        remotePlaceholder.classList.add("hidden");
        waitingMessage.classList.add("hidden");
        connectionStatus.textContent = "Connected";
        startTimer();
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", {
                roomId: currentRoom,
                candidate: event.candidate
            });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;

        if (state === "connected") {
            connectionStatus.textContent = "Connected";
            waitingMessage.classList.add("hidden");
            startTimer();
        }

        if (state === "disconnected" || state === "failed") {
            connectionStatus.textContent = "Connection lost";
        }

        if (state === "closed") {
            connectionStatus.textContent = "Call ended";
        }
    };

    return peerConnection;
}

socket.on("offer", async ({ offer }) => {
    await createPeerConnection();

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
    );

    const answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer);

    socket.emit("answer", {
        roomId: currentRoom,
        answer: answer
    });
});

socket.on("answer", async ({ answer }) => {
    if (!peerConnection) return;

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
    );
});

socket.on("ice-candidate", async ({ candidate }) => {
    try {
        if (peerConnection && candidate) {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        }
    } catch (error) {
        console.error("ICE candidate error:", error);
    }
});

micBtn.addEventListener("click", toggleMicrophone);

function toggleMicrophone() {
    if (!localStream) return;

    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    micEnabled = !micEnabled;

    audioTracks.forEach((track) => {
        track.enabled = micEnabled;
    });

    updateMicrophoneUI();
}

function updateMicrophoneUI() {
    if (micEnabled) {
        micBtn.innerHTML = "🎙️<span>Mute</span>";
        micBtn.classList.remove("disabled");
    } else {
        micBtn.innerHTML = "🔇<span>Unmute</span>";
        micBtn.classList.add("disabled");
    }
}

cameraBtn.addEventListener("click", toggleCamera);

function toggleCamera() {
    if (!localStream) return;

    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;

    cameraEnabled = !cameraEnabled;

    videoTracks.forEach((track) => {
        track.enabled = cameraEnabled;
    });

    updateLocalCameraUI();
}

function updateLocalCameraUI() {
    if (cameraEnabled) {
        cameraBtn.innerHTML = "📹<span>Camera</span>";
        cameraBtn.classList.remove("disabled");
        localPlaceholder.style.display = "none";
    } else {
        cameraBtn.innerHTML = "📷<span>Camera</span>";
        cameraBtn.classList.add("disabled");
        localPlaceholder.style.display = "flex";
    }
}

screenBtn.addEventListener("click", toggleScreenShare);

async function toggleScreenShare() {
    if (!peerConnection) {
        alert("Connect to another participant first.");
        return;
    }

    if (screenSharing) {
        await stopScreenSharing();
        return;
    }

    try {
        screenStream =
            await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

        const screenTrack =
            screenStream.getVideoTracks()[0];

        const sender =
            peerConnection
                .getSenders()
                .find(
                    (s) =>
                        s.track &&
                        s.track.kind === "video"
                );

        if (sender) {
            await sender.replaceTrack(screenTrack);
        }

        screenVideo.srcObject = screenStream;
        screenShareContainer.classList.remove("hidden");
        screenSharing = true;

        screenBtn.innerHTML =
            "⏹️<span>Stop Share</span>";

        screenBtn.classList.add("active");

        screenTrack.addEventListener(
            "ended",
            async () => {
                await stopScreenSharing();
            }
        );
    } catch (error) {
        console.error("Screen sharing error:", error);
    }
}

async function stopScreenSharing() {
    if (!screenSharing) return;

    const cameraTrack =
        localStream.getVideoTracks()[0];

    const sender =
        peerConnection?.getSenders().find(
            (s) =>
                s.track &&
                s.track.kind === "video"
        );

    if (sender && cameraTrack) {
        await sender.replaceTrack(cameraTrack);
    }

    if (screenStream) {
        screenStream.getTracks().forEach(
            (track) => track.stop()
        );
    }

    screenStream = null;
    screenVideo.srcObject = null;
    screenShareContainer.classList.add("hidden");
    screenSharing = false;

    screenBtn.innerHTML =
        "🖥️<span>Share</span>";

    screenBtn.classList.remove("active");
}

copyBtn.addEventListener("click", async () => {
    if (!currentRoom) return;

    try {
        await navigator.clipboard.writeText(currentRoom);

        copyBtn.innerHTML =
            "✓<span>Copied</span>";

        setTimeout(() => {
            copyBtn.innerHTML =
                "🔗<span>Copy</span>";
        }, 1500);
    } catch (error) {
        console.error(error);
    }
});

socket.on("user-left", () => {
    connectionStatus.textContent = "Participant left";
    remoteVideo.srcObject = null;
    remotePlaceholder.classList.remove("hidden");
    waitingMessage.classList.remove("hidden");

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    stopTimer();
});

endBtn.addEventListener("click", endCall);

function endCall() {
    socket.emit("leave-room");

    if (screenSharing) {
        stopScreenSharing();
    }

    stopLocalMedia();

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remoteVideo.srcObject = null;

    callScreen.classList.add("hidden");
    joinScreen.classList.remove("hidden");

    roomInput.value = "";
    joinError.textContent = "";

    joinBtn.disabled = false;
    joinBtn.textContent = "Join Video Call";

    currentRoom = null;

    stopTimer();
}

function stopLocalMedia() {
    if (!localStream) return;

    localStream.getTracks().forEach(
        (track) => track.stop()
    );

    localStream = null;
    localVideo.srcObject = null;
}

function startTimer() {
    if (timerInterval) return;

    callSeconds = 0;

    timerInterval = setInterval(() => {
        callSeconds++;

        const minutes =
            Math.floor(callSeconds / 60);

        const seconds =
            callSeconds % 60;

        callTimer.textContent =
            String(minutes).padStart(2, "0") +
            ":" +
            String(seconds).padStart(2, "0");
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    callSeconds = 0;
    callTimer.textContent = "00:00";
}

socket.on("error-message", (message) => {
    joinError.textContent = message;
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Video Call";
});
