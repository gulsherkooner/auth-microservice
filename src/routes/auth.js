const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/user');
const redis = require('../config/redis');
const {
  generateAccessToken,
  generateRefreshToken,
} = require('../utils/jwt');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, name, bio, profile_img_url } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const newUser = new User({
      user_id: userId,
      email,
      username,
      password_hash: hashedPassword,
      name: name || '',
      bio: bio || '',
      profile_img_url: profile_img_url || '',
      created_at: new Date(),
      updated_at: new Date(),
      followers: 0,
      following: 0,
      banner_img_url: '',
      is_verified: false,
    });

    await newUser.save();

    res.status(201).json({ user_id: userId, email });
  } catch (error) {
    console.error('Register error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.set('Set-Cookie', `refreshToken=${refreshToken}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}`);

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        user_id: user.user_id,
        email: user.email,
        username: user.username,
        name: user.name,
        bio: user.bio,
        profile_img_url: user.profile_img_url,
        created_at: user.created_at,
        updated_at: user.updated_at,
        followers: user.followers,
        following: user.following,
        banner_img_url: user.banner_img_url,
        is_verified: user.is_verified,
      },
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get User
router.get('/user', async (req, res) => {
  try {
    const userId = req.headers['x-user-id']; // Use header set by api-gateway
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const cacheKey = `user:${userId}`;
    const cachedUser = await redis.get(cacheKey);

    if (cachedUser) {
      return res.status(200).json({ user: JSON.parse(cachedUser) });
    }

    const user = await User.findOne({ user_id: userId }).select(
      'user_id username email name bio profile_img_url created_at updated_at -_id'
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await redis.setex(cacheKey, 3600, JSON.stringify(user));
    res.status(200).json({ user });
  } catch (error) {
    console.error('Get user error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/user/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;

    const cacheKey = `user:${user_id}`;
    const cachedUser = await redis.get(cacheKey);

    if (cachedUser) {
      return res.status(200).json({ user: JSON.parse(cachedUser) });
    }

    const user = await User.findOne({ user_id }).select(
      'user_id username email name bio profile_img_url created_at updated_at'
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await redis.setex(cacheKey, 3600, JSON.stringify(user));
    res.status(200).json({ user });
  } catch (error) {
    console.error('Get user by ID error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;