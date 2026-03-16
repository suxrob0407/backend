const express = require('express');
const Ride = require('../models/Ride');
const Driver = require('../models/Driver');
const { auth } = require('../middleware/auth');
const router = express.Router();
// /suxrob
const calcDist = (p1, p2) => {
  const R = 6371, dLat = (p2.lat - p1.lat) * Math.PI / 180, dLon = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calcPrice = (dist, cls, hasDestination = true) => {
  if (!hasDestination || dist === 0) {
    // Destination yo'q — 3000 so'm boshlang'ich, 1500 so'm/km
    return dist > 0 ? Math.round(3000 + dist * 1500) : 3000;
  }
  const base = { economy: 8000, comfort: 12000, business: 20000, minivan: 15000 };
  const per  = { economy: 1200, comfort: 1800,  business: 3000,  minivan: 2000  };
  return Math.round((base[cls] || 8000) + dist * (per[cls] || 1200));
};

router.post('/', auth, async (req, res) => {
  try {
    console.log('🆕 Yangi safar:', JSON.stringify(req.body));
    console.log('👤 User:', req.user?._id, req.user?.name);
    const { pickup, destination, carClass, paymentMethod, estimatedPrice: clientPrice, distance: clientDist, duration: clientDuration } = req.body;

    // Agar frontend dan narx/masofa kelsa — ishlatamiz, aks holda o'zimiz hisoblaymiz
    let distance = 0, estimatedPrice = 0, duration = 0;
    if (clientDist && clientDist > 0 && clientDist < 1000) {
      // Frontend dan kelgan to'g'ri qiymat
      distance = Math.round(clientDist * 10) / 10;
      estimatedPrice = clientPrice || calcPrice(distance, carClass);
      duration = clientDuration || Math.round(distance * 2.5);
    } else if (destination?.lat && pickup?.lat) {
      // Backend hisoblaydi
      distance = Math.round(calcDist(pickup, destination) * 10) / 10;
      estimatedPrice = calcPrice(distance, carClass);
      duration = Math.round(distance * 2.5);
    }

    const hasDestination = !!(destination?.lat);
    if (!hasDestination) {
      // Destination yo'q — 3000 + 1500/km
      estimatedPrice = calcPrice(distance, carClass, false);
    }
    const ride = new Ride({ passenger: req.user._id, pickup, destination: hasDestination ? destination : null, carClass: carClass || 'economy', paymentMethod: paymentMethod || 'cash', estimatedPrice, distance, duration });
    await ride.save();
    await ride.populate('passenger', 'name phone rating');

    // Yaqin haydovchilarni topib yuborish (2km → 4km → 6km → barchasi)
    const notifyDrivers = async () => {
      if (!req.io) return;

      const Ride = require('../models/Ride');

      const getDist = (a, b) => {
        if (!a?.lat || !b?.lat) return 999;
        const R = 6371;
        const dLat = (a.lat - b.lat) * Math.PI / 180;
        const dLon = (a.lng - b.lng) * Math.PI / 180;
        const x = Math.sin(dLat/2)**2 + Math.cos(b.lat*Math.PI/180)*Math.cos(a.lat*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
      };

      // Online + limit bor haydovchilarni olish
      const getAvailableDrivers = async () => {
        const allDrivers = await Driver.find({
          status: 'online',
          $or: [{ ridesLeft: { $gt: 0 } }, { ridesLeft: null }]
        }).select('currentLocation user _id');

        return allDrivers
          .map(d => {
            const userId = d.user?.toString();
            const driverId = d._id?.toString();
            const socketId = req.driverSockets?.[userId] || req.driverSockets?.[driverId];
            const dist = pickup?.lat ? getDist(pickup, d.currentLocation) : 0;
            return { _id: driverId, userId, socketId, dist };
          })
          .filter(d => d.socketId)
          .sort((a, b) => a.dist - b.dist);
      };

      let queue = await getAvailableDrivers();
      console.log(`👥 Queue [ride:${ride._id}]: ${queue.length} haydovchi`);

      if (queue.length === 0) {
        console.log('⚠️ Online haydovchi yo\'q — 30 sek kutiladi...');
        await new Promise(r => setTimeout(r, 30000));
        const stillSearching = await Ride.findById(ride._id).select('status');
        if (!stillSearching || stillSearching.status !== 'searching') return;
        queue = await getAvailableDrivers();
        if (queue.length === 0) { console.log('❌ Haydovchi topilmadi'); return; }
      }

      const triedDrivers = new Set(); // Bu ride uchun urinilgan haydovchilar

      for (const driver of queue) {
        if (triedDrivers.has(driver.userId)) continue;

        // Ride hali ham searching?
        const rideNow = await Ride.findById(ride._id).select('status');
        if (!rideNow || rideNow.status !== 'searching') {
          console.log(`✅ [ride:${ride._id}] allaqachon qabul qilindi`);
          return;
        }

        // Haydovchi haqiqatan band? — faqat so'nggi 2 soat ichidagi aktiv safarni tekshir
        const driverDoc = await Driver.findOne({ user: driver.userId });
        if (driverDoc) {
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const driverBusy = await Ride.findOne({
            driver: driverDoc._id,
            status: { $in: ['accepted', 'in_progress'] },
            requestedAt: { $gte: twoHoursAgo }
          });
          if (driverBusy) {
            console.log(`⏭ ${driver.userId} band (aktiv safar: ${driverBusy._id}) → keyingisi`);
            continue;
          }
        }

        triedDrivers.add(driver.userId);
        console.log(`📡 [ride:${ride._id}] → ${driver.userId} (${driver.dist.toFixed(1)}km)`);
        req.io.to(driver.socketId).emit('ride:incoming', ride);

        // Rad yoki qabul — kutamiz
        let accepted = false;
        let rejected = false;

        const onRejected = ({ driverId }) => {
          if (driverId === driver.userId || driverId === driver._id) rejected = true;
        };
        req.io.on(`ride:rejected:${ride._id}`, onRejected);

        // Max 5 minut, rad etsa darhol
        for (let i = 0; i < 200; i++) {
          await new Promise(r => setTimeout(r, 1500));
          if (rejected) { console.log(`❌ ${driver.userId} rad etdi`); break; }
          const check = await Ride.findById(ride._id).select('status');
          if (!check || check.status !== 'searching') { accepted = true; break; }
        }

        req.io.off(`ride:rejected:${ride._id}`, onRejected);

        if (accepted) { console.log(`✅ [ride:${ride._id}] qabul qilindi`); return; }

        // Popup yopilsin
        req.io.to(driver.socketId).emit('ride:expired', { rideId: ride._id });

        // Yangi haydovchilar listini olamiz (yangi online bo'lganlar ham)
        const fresh = await getAvailableDrivers();
        for (const fd of fresh) {
          if (!triedDrivers.has(fd.userId) && !queue.find(q => q.userId === fd.userId)) {
            queue.push(fd);
          }
        }
      }

      console.log(`❌ [ride:${ride._id}] hech kim qabul qilmadi`);
    };
    // Background da ishlaydi — response kutmaymiz
    notifyDrivers().catch(err => console.error('Notify error:', err));

    res.status(201).json(ride);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/my', auth, async (req, res) => {
  try {
    const rides = await Ride.find({ passenger: req.user._id }).populate('driver').sort({ requestedAt: -1 }).limit(30);
    res.json(rides);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/available', auth, async (req, res) => {
  // Available rides faqat socket orqali yuboriladi - bu endpoint bo'sh qaytaradi
  res.json([]);
});

router.get('/driver', auth, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Haydovchi topilmadi' });
    const rides = await Ride.find({ driver: driver._id }).populate('passenger', 'name phone rating').sort({ requestedAt: -1 }).limit(30);
    res.json(rides);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id/accept', auth, async (req, res) => {
  console.log('🤝 Qabul qilish:', req.params.id, '| User:', req.user?._id);
  try {
    const driver = await Driver.findOne({ user: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Haydovchi topilmadi' });
    // Limit tekshirish - null bo'lsa limit yo'q, <= 0 bo'lsa bloklangan
    if (driver.ridesLeft !== null && driver.ridesLeft !== undefined && driver.ridesLeft <= 0) {
      return res.status(403).json({ message: "Limitingiz tugagan. Admin bilan bog'laning." });
    }

    // ETA hisoblash
    const rideData = await Ride.findById(req.params.id);
    let eta = 5;
    if (driver.currentLocation?.lat && rideData?.pickup?.lat) {
      const R = 6371;
      const dLat = (rideData.pickup.lat - driver.currentLocation.lat) * Math.PI / 180;
      const dLon = (rideData.pickup.lng - driver.currentLocation.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(driver.currentLocation.lat*Math.PI/180)*Math.cos(rideData.pickup.lat*Math.PI/180)*Math.sin(dLon/2)**2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      eta = Math.max(1, Math.round(dist * 3));
    }

    // ridesLeft kamaysin (faqat limit belgilangan bo'lsa)
    const feePerRide = driver.feePerRide || 1500;
    const limitUpdate = { $inc: { totalFee: feePerRide } };
    if (driver.ridesLeft !== null && driver.ridesLeft !== undefined) {
      limitUpdate.$inc.ridesLeft = -1;
    }
    await Driver.findByIdAndUpdate(driver._id, limitUpdate);

    const ride = await Ride.findOneAndUpdate({ _id: req.params.id, status: 'searching' }, { driver: driver._id, status: 'accepted', acceptedAt: new Date(), eta }, { new: true }).populate('passenger', 'name phone');
    if (!ride) return res.status(404).json({ message: 'Safar topilmadi yoki band' });
    await Driver.findByIdAndUpdate(driver._id, { status: 'busy' });
    res.json(ride);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status, reason, price } = req.body;
    const updates = { status };
    if (status === 'in_progress') updates.startedAt = new Date();
    if (status === 'completed') {
      updates.completedAt = new Date();
      if (price) updates.price = price;
    }
    if (status === 'cancelled') { updates.cancelledAt = new Date(); updates.cancelReason = reason; }
    const ride = await Ride.findByIdAndUpdate(req.params.id, updates, { new: true }).populate('passenger', 'name phone').populate('driver');
    if (status === 'completed') {
      const User = require('../models/User');
      if (ride?.passenger) {
        await User.findByIdAndUpdate(ride.passenger._id || ride.passenger, { $inc: { totalRides: 1 } });
      }
      if (ride?.driver) {
        await Driver.findByIdAndUpdate(ride.driver._id || ride.driver, { $inc: { completedRides: 1 } });
      }
    }
    if (['completed', 'cancelled'].includes(status) && ride?.driver) {
      await Driver.findByIdAndUpdate(ride.driver._id || ride.driver, { status: 'online' });
    }
    res.json(ride);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/:id/rate', auth, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Topilmadi' });
    const isPassenger = ride.passenger.toString() === req.user._id.toString();
    await Ride.findByIdAndUpdate(req.params.id, isPassenger ? { driverRating: rating, comment } : { passengerRating: rating });
    res.json({ message: 'Baholandi' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id).populate('passenger', 'name phone rating').populate({ path: 'driver', select: 'carModel carColor carPlate carClass currentLocation rating', populate: { path: 'user', select: 'name phone rating' } });
    if (!ride) return res.status(404).json({ message: 'Topilmadi' });
    res.json(ride);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;