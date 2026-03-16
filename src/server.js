const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const rideRoutes = require("./routes/rides");
const driverRoutes = require("./routes/drivers");
const adminRoutes = require("./routes/admin");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
});

// ✅ CORS - barcha originlarga ruxsat
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

// Online haydovchilar socket map - middleware dan oldin e'lon qilinishi shart!
const driverSockets = {};
const passengerSockets = {};

// io ni barcha routelarga uzatish
app.use((req, res, next) => {
  req.io = io;
  req.driverSockets = driverSockets;
  next();
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("✅ MongoDB ulandi");
    try {
      const Ride = require("./models/Ride");
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = await Ride.updateMany(
        {
          status: { $in: ["accepted", "in_progress"] },
          requestedAt: { $lt: oneHourAgo },
        },
        { $set: { status: "cancelled" } },
      );
      if (result.modifiedCount > 0)
        console.log(`🧹 ${result.modifiedCount} ta eski safar tozalandi`);
    } catch {}
  })
  .catch((err) => console.error("❌ MongoDB xatosi:", err));

app.use("/api/auth", authRoutes);
app.use("/api/rides", rideRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/admin", adminRoutes);
app.get("/", (req, res) => res.json({ message: "🚖 TaxiGo API ishlamoqda" }));

io.on("connection", (socket) => {
  if (!io.rejectedRides) io.rejectedRides = {};

  socket.on("ride:rejected", ({ rideId }) => {
    const driverId = Object.keys(driverSockets).find(
      (k) => driverSockets[k] === socket.id,
    );
    if (!driverId) return;
    if (!io.rejectedRides[rideId]) io.rejectedRides[rideId] = new Set();
    io.rejectedRides[rideId].add(driverId);
    console.log(`❌ Haydovchi ${driverId} ride ${rideId} ni rad etdi`);
    socket.to("server").emit(`ride:rejected:${rideId}`, { driverId });
    io.emit(`ride:rejected:${rideId}`, { driverId });
  });

  socket.on("driver:register", async (driverId) => {
    driverSockets[driverId] = socket.id;
    socket.join(`driver:${driverId}`);
    console.log(
      `🚗 Haydovchi ulandi: ${driverId} | Jami haydovchilar: ${Object.keys(driverSockets).length}`,
    );
    try {
      const Driver = require("./models/Driver");
      const Ride = require("./models/Ride");
      const driver = await Driver.findOne({ user: driverId });
      if (!driver || driver.status !== "online") return;
      if (driver.rideLimit !== null && driver.ridesLeft <= 0) return;
      const activeBusy = await Ride.findOne({
        driver: driver._id,
        status: { $in: ["accepted", "in_progress"] },
      });
      if (activeBusy) {
        console.log(`⏭ Haydovchi ${driverId} band — ride yuborilmadi`);
        return;
      }
      const pendingRide = await Ride.findOne({ status: "searching" })
        .populate("passenger", "name phone rating")
        .sort({ requestedAt: -1 });
      if (pendingRide) {
        console.log(
          `📡 Haydovchi ${driverId} ulanish bilanoq ride yuboriladi: ${pendingRide._id}`,
        );
        setTimeout(() => {
          socket.emit("ride:incoming", pendingRide);
        }, 200);
      }
    } catch (err) {
      console.error("Driver register error:", err.message);
    }
  });

  socket.on("passenger:register", (userId) => {
    passengerSockets[userId] = socket.id;
    socket.join(`passenger:${userId}`);
    console.log(`👤 Yo'lovchi ulandi: ${userId}`);
  });

  socket.on("ride:new", (rideData) => {
    console.log("🆕 Yangi safar:", rideData._id);
    Object.values(driverSockets).forEach((sid) => {
      io.to(sid).emit("ride:incoming", rideData);
    });
  });

  socket.on("ride:accepted", ({ rideId, passengerId, driverInfo }) => {
    if (passengerSockets[passengerId]) {
      io.to(passengerSockets[passengerId]).emit("ride:accepted", {
        rideId,
        driverInfo,
      });
    }
  });

  socket.on("ride:statusUpdate", ({ rideId, status, passengerId }) => {
    if (passengerSockets[passengerId]) {
      io.to(passengerSockets[passengerId]).emit(`ride:status:${rideId}`, {
        status,
      });
    }
  });

  socket.on("driver:location", ({ rideId, passengerId, lat, lng }) => {
    if (passengerSockets[passengerId]) {
      io.to(passengerSockets[passengerId]).emit("driver:location", {
        rideId,
        lat,
        lng,
      });
    }
  });

  socket.on("disconnect", () => {
    Object.keys(driverSockets).forEach((id) => {
      if (driverSockets[id] === socket.id) delete driverSockets[id];
    });
    Object.keys(passengerSockets).forEach((id) => {
      if (passengerSockets[id] === socket.id) delete passengerSockets[id];
    });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server ${PORT}-portda ishlamoqda`));
