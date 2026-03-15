const mongoose = require("mongoose");

const driverSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  licenseNumber: { type: String, required: true, unique: true },
  carModel: { type: String, required: true },
  carColor: { type: String, required: true },
  carPlate: { type: String, required: true, unique: true },
  carYear: { type: Number },
  carClass: {
    type: String,
    enum: ["economy", "comfort", "business", "minivan"],
    default: "economy",
  },
  status: {
    type: String,
    enum: ["offline", "online", "busy"],
    default: "offline",
  },
  currentLocation: { lat: Number, lng: Number },
  rating: { type: Number, default: 5.0 },
  totalEarnings: { type: Number, default: 0 },
  completedRides: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  rideLimit: { type: Number, default: null }, // max safar soni (admin beradi)
  ridesLeft: { type: Number, default: null }, // qolgan safarlar
  feePerRide: { type: Number, default: 1500 }, // har safar uchun to'lov (so'm)
  totalFee: { type: Number, default: 0 }, // jami to'lashi kerak bo'lgan summa
  paidFee: { type: Number, default: 0 }, // to'langan summa
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Driver", driverSchema);
