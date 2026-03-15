const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const router = express.Router();

const genToken = (id) =>
  jwt.sign({ userId: id }, process.env.JWT_SECRET || "secret", {
    expiresIn: "30d",
  });

router.post("/register", async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    if (await User.findOne({ phone }))
      return res
        .status(400)
        .json({ message: "Bu raqam allaqachon ro'yxatdan o'tgan" });
    const user = new User({ name, phone, password, role: role || "user" });
    await user.save();
    res
      .status(201)
      .json({
        token: genToken(user._id),
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          rating: user.rating,
        },
      });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user || !(await user.comparePassword(password)))
      return res.status(400).json({ message: "Telefon yoki parol noto'g'ri" });
    res.json({
      token: genToken(user._id),
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        rating: user.rating,
        totalRides: user.totalRides,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json({ ...user.toObject(), id: user._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/me", auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name: req.body.name, email: req.body.email },
      { new: true, select: "-password" },
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
