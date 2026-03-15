const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema({
  passenger: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
  pickup: { address: String, lat: Number, lng: Number },
  destination: { address: String, lat: Number, lng: Number },
  status: {
    type: String,
    enum: [
      "searching",
      "accepted",
      "arriving",
      "in_progress",
      "completed",
      "cancelled",
    ],
    default: "searching",
  },
  carClass: {
    type: String,
    enum: ["economy", "comfort", "business", "minivan"],
    default: "economy",
  },
  price: Number,
  estimatedPrice: Number,
  distance: Number,
  duration: Number,
  paymentMethod: { type: String, enum: ["cash", "card"], default: "cash" },
  isPaid: { type: Boolean, default: false },
  driverRating: { type: Number, min: 1, max: 5 },
  passengerRating: { type: Number, min: 1, max: 5 },
  comment: String,
  requestedAt: { type: Date, default: Date.now },
  acceptedAt: Date,
  startedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  cancelReason: String,
  eta: { type: Number, default: null }, // daqiqada kelish vaqti
});

module.exports = mongoose.model("Ride", rideSchema);
