const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Token topilmadi' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) return res.status(401).json({ message: 'Foydalanuvchi topilmadi' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Token yaroqsiz' });
  }
};

module.exports = { auth };
