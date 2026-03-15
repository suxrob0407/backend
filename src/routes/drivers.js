const express = require("express");
const Driver = require("../models/Driver");
const { auth } = require("../middleware/auth");
const router = express.Router();

router.post("/register", auth, async (req, res) => {
  try {
    if (await Driver.findOne({ user: req.user._id }))
      return res.status(400).json({ message: "Allaqachon ro'yxatdan o'tgansiz" });
    const driver = new Driver({ user: req.user._id, ...req.body });
    await driver.save();
    await driver.populate("user", "name phone");
    res.status(201).json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/me", auth, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id }).populate("user", "name phone rating");
    if (!driver) return res.status(404).json({ message: "Topilmadi" });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/status", auth, async (req, res) => {
  try {
    const driver = await Driver.findOneAndUpdate(
      { user: req.user._id },
      { status: req.body.status },
      { new: true },
    );
    if (!driver) return res.status(404).json({ message: "Topilmadi" });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/location", auth, async (req, res) => {
  try {
    const driver = await Driver.findOneAndUpdate(
      { user: req.user._id },
      { currentLocation: { lat: req.body.lat, lng: req.body.lng } },
      { new: true },
    );
    res.json(driver);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/online", async (req, res) => {
  try {
    const drivers = await Driver.find({ status: { $in: ["online", "busy"] } })
      .populate("user", "name rating")
      .select("carModel carColor carPlate carClass currentLocation status rating");
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Yaqin online haydovchilarni topish
router.get("/nearby", auth, async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query;
    if (!lat || !lng) return res.json([]);

    const drivers = await Driver.find({ status: "online" })
      .populate("user", "name")
      .select("currentLocation carModel carColor carPlate carClass user");

    const nearby = drivers.filter((d) => {
      if (!d.currentLocation?.lat) return false;
      const R = 6371;
      const dLat = ((parseFloat(lat) - d.currentLocation.lat) * Math.PI) / 180;
      const dLon = ((parseFloat(lng) - d.currentLocation.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((d.currentLocation.lat * Math.PI) / 180) *
          Math.cos((parseFloat(lat) * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return dist <= parseFloat(radius);
    });

    res.json(nearby);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ module.exports eng oxirida!
module.exports = router;
