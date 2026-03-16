const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Driver = require('../models/Driver');
const Ride = require('../models/Ride');
const { auth } = require('../middleware/auth');

// Admin tekshirish middleware
const isAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin huquqi kerak' });
  next();
};

// Barcha haydovchilar
router.get('/drivers', auth, isAdmin, async (req, res) => {
  try {
    const drivers = await Driver.find()
      .populate('user', 'name phone email rating isActive createdAt')
      .sort({ createdAt: -1 });
    res.json(drivers);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Haydovchi limitini o'zgartirish
router.put('/drivers/:id/limit', auth, isAdmin, async (req, res) => {
  try {
    const { rideLimit, ridesLeft, feePerRide } = req.body;
    const update = {};
    if (rideLimit !== undefined) update.rideLimit = rideLimit;
    if (ridesLeft !== undefined) update.ridesLeft = ridesLeft;
    if (feePerRide !== undefined) update.feePerRide = feePerRide;
    const driver = await Driver.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('user', 'name phone');
    if (!driver) return res.status(404).json({ message: 'Haydovchi topilmadi' });
    res.json(driver);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// To'landi deb belgilash
router.put('/drivers/:id/paid', auth, isAdmin, async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Topilmadi' });
    const paidAmount = driver.totalFee - driver.paidFee;
    await Driver.findByIdAndUpdate(req.params.id, {
      $inc: { paidFee: paidAmount },
    });
    res.json({ message: `${paidAmount.toLocaleString()} so'm to'landi deb belgilandi` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Haydovchini tasdiqlash / bloklash
router.put('/drivers/:id/verify', auth, isAdmin, async (req, res) => {
  try {
    const { isVerified } = req.body;
    const driver = await Driver.findByIdAndUpdate(req.params.id, { isVerified }, { new: true })
      .populate('user', 'name phone');
    res.json(driver);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Barcha foydalanuvchilar (faqat user role)
router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).sort({ createdAt: -1 }).select('-password');
    res.json(users);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Adminlar ro'yxati
router.get('/admins', auth, isAdmin, async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' })
      .sort({ createdAt: -1 })
      .select('-password')
      .populate('createdBy', 'name phone');
    res.json(admins);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Umumiy statistika
router.get('/stats', auth, isAdmin, async (req, res) => {
  try {
    const [totalUsers, totalDrivers, totalRides, activeRides] = await Promise.all([
      User.countDocuments({ role: { $in: ['user'] } }),
      Driver.countDocuments(),
      Ride.countDocuments({ status: 'completed' }),
      Ride.countDocuments({ status: { $in: ['searching', 'accepted', 'in_progress'] } }),
    ]);
    const revenue = await Ride.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$price', '$estimatedPrice'] } } } }
    ]);
    res.json({
      totalUsers, totalDrivers, totalRides, activeRides,
      totalRevenue: revenue[0]?.total || 0
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Haydovchi totalFee ni eski safarlardan qayta hisoblash
router.post('/drivers/:id/recalc', auth, isAdmin, async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Topilmadi' });

    // Bu haydovchining barcha qabul qilingan safarlarini topamiz
    const rides = await Ride.find({
      driver: driver._id,
      status: { $in: ['accepted', 'arriving', 'in_progress', 'completed'] }
    });

    const feePerRide = driver.feePerRide || 1500;
    const totalFee = rides.length * feePerRide;
    const ridesUsed = rides.length;

    await Driver.findByIdAndUpdate(driver._id, { totalFee });
    res.json({ message: `${ridesUsed} ta safar × ${feePerRide} = ${totalFee.toLocaleString()} so'm`, totalFee });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Yangi admin qo'shish
router.post('/create-admin', auth, isAdmin, async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ message: "Barcha maydonlar to'ldirilishi kerak"});
    const exists = await User.findOne({ phone });
    if (exists) {
      // Mavjud userni admin qilish
      exists.role = 'admin';
      await exists.save();
      return res.json({ message: `${exists.name} admin qilindi`, user: exists });
    }
    const user = new User({ name, phone, password, role: 'admin' });
    await user.save();
    res.status(201).json({ message: 'Admin yaratildi', user: { id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Userni admin/user qilish
router.put('/users/:id/role', auth, isAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'driver', 'admin'].includes(role)) return res.status(400).json({ message: "Noto'g'ri rol" });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true, select: '-password' });
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;

// Admin tomonidan haydovchi qo'shish
router.post('/add-driver', auth, isAdmin, async (req, res) => {
  try {
    const { name, phone, password, carModel, carColor, carPlate, carClass, licenseNumber, rideLimit, feePerRide } = req.body;
    if (!name || !phone || !password || !carModel || !carColor || !carPlate) {
      return res.status(400).json({ message: 'Ism, telefon, parol, mashina modeli, rangi va raqami kerak' });
    }

    // User mavjudmi tekshirish
    let user = await User.findOne({ phone });
    if (user) {
      if (user.role !== 'driver') {
        user.role = 'driver';
        await user.save();
      }
    } else {
      user = new User({ name, phone, password, role: 'driver' });
      await user.save();
    }

    // Driver mavjudmi tekshirish
    const existingDriver = await Driver.findOne({ user: user._id });
    if (existingDriver) {
      return res.status(400).json({ message: 'Bu foydalanuvchi allaqachon haydovchi' });
    }

    const driver = new Driver({
      user: user._id,
      licenseNumber: licenseNumber || phone,
      carModel, carColor, carPlate,
      carClass: carClass || 'economy',
      isVerified: true,
      rideLimit: rideLimit || null,
      ridesLeft: rideLimit || null,
      feePerRide: feePerRide || 1500,
    });
    await driver.save();

    res.status(201).json({ message: 'Haydovchi qo\'shildi', driver, user: { id: user._id, name: user.name, phone: user.phone } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin bormi yo'qmi tekshirish (public)
router.get('/check-setup', async (req, res) => {
  try {
    const admin = await User.findOne({ role: 'admin' });
    res.json({ hasAdmin: !!admin });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin yaratish yoki mavjud adminning parolini reset qilish
router.post('/setup', async (req, res) => {
  try {
    const { name, phone, password, secretKey } = req.body;

    // Secret key tekshirish
    const SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'taxigo-setup-2024';
    if (secretKey !== SETUP_KEY) {
      return res.status(403).json({ message: 'Xavfsizlik kaliti noto\'g\'ri' });
    }

    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');

    // Admin allaqachon bormi?
    let user = await User.findOne({ role: 'admin' });

    if (user) {
      // Mavjud adminning parolini yangilaymiz
      user.password = password; // pre-save hook hash qiladi
      if (name) user.name = name;
      await user.save();

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
      return res.json({
        message: '✅ Admin paroli yangilandi!',
        token,
        user: { id: user._id, name: user.name, phone: user.phone, role: user.role }
      });
    }

    // Yangi admin yaratish
    if (!phone || !password) {
      return res.status(400).json({ message: 'Telefon va parol kerak' });
    }

    // Telefon bilan user bormi?
    user = await User.findOne({ phone });
    if (user) {
      user.role = 'admin';
      user.password = password;
      if (name) user.name = name;
      await user.save();
    } else {
      user = new User({ name: name || 'Admin', phone, password, role: 'admin', createdBy: req.user._id });
      await user.save();
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
    res.status(201).json({
      message: '✅ Admin yaratildi!',
      token,
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role }
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Qolib ketgan safarlarni tozalash (accepted/in_progress > 2 soat)
router.post('/cleanup-rides', auth, isAdmin, async (req, res) => {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const result = await require('../models/Ride').updateMany(
      {
        status: { $in: ['accepted', 'in_progress', 'searching'] },
        requestedAt: { $lt: twoHoursAgo }
      },
      { $set: { status: 'cancelled' } }
    );
    res.json({ message: `${result.modifiedCount} ta safar tozalandi` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});