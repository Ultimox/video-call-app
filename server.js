const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (roomId) => {
        roomId = String(roomId).trim();

        if (!roomId) {
            socket.emit("error-message", "Room ID is required.");
            return;
        }

        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
        }

        const room = rooms.get(roomId);

        if (room.size >= 2) {
            socket.emit("room-full", "This room already has two participants.");
            return;
        }

        room.add(socket.id);
        socket.join(roomId);
        socket.data.roomId = roomId;

        socket.emit("room-joined", {
            roomId: roomId,
            users: room.size
        });

        if (room.size === 2) {
            const users = [...room];
            io.to(users[1]).emit("start-call");
        }
    });

    socket.on("offer", ({ roomId, offer }) => {
        socket.to(roomId).emit("offer", { offer });
    });

    socket.on("answer", ({ roomId, answer }) => {
        socket.to(roomId).emit("answer", { answer });
    });

    socket.on("ice-candidate", ({ roomId, candidate }) => {
        socket.to(roomId).emit("ice-candidate", { candidate });
    });

    socket.on("leave-room", () => {
        removeUserFromRoom(socket);
    });

    socket.on("disconnect", () => {
        removeUserFromRoom(socket);
    });
});

function removeUserFromRoom(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.delete(socket.id);
    socket.to(roomId).emit("user-left");

    if (room.size === 0) {
        rooms.delete(roomId);
    }

    socket.data.roomId = null;
}


server.listen(PORT, "0.0.0.0", () => {
    console.log(`Video call server running on port ${PORT}`);
});
