const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const User = require("../models/user");
const redis = require("../config/redis");
const { generateAccessToken, generateRefreshToken } = require("../utils/jwt");
const getDbxToken = require("../utils/getDbxToken");
const uploadToDropbox = require("../config/dropbox");

const router = express.Router();

// Register
router.post("/register", async (req, res) => {
  try {
    const { email, username, password, name, bio, profile_img_url, DOB } = req.body;

    if (!email || !username || !password) {
      return res
        .status(400)
        .json({ error: "Email, username, and password are required" });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "Email or username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const newUser = new User({
      user_id: userId,
      email,
      username,
      password_hash: hashedPassword,
      name: name || "",
      bio: bio || "",
      DOB: DOB || "",
      profile_img_url: profile_img_url || "",
      created_at: new Date(),
      updated_at: new Date(),
      followers: 0,
      following: 0,
      banner_img_url: "",
      is_verified: false,
    });

    await newUser.save();

    const accessToken = generateAccessToken(newUser);
    const refreshToken = generateRefreshToken(newUser);

    res.set(
      "Set-Cookie",
      `refreshToken=${refreshToken}; HttpOnly; Path=/; Max-Age=${
        7 * 24 * 60 * 60
      }`
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      user: newUser,
    });
  } catch (error) {
    console.error("Register error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.set(
      "Set-Cookie",
      `refreshToken=${refreshToken}; HttpOnly; Path=/; Max-Age=${
        7 * 24 * 60 * 60
      }`
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      user: user,
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get User
router.get("/user", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"]; // Use header set by api-gateway
    if (!userId) {
      return res.status(401).json({ error: "User ID required" });
    }

    const cacheKey = `user:${userId}`;
    const cachedUser = await redis.get(cacheKey);

    if (cachedUser) {
      return res.status(200).json({ user: JSON.parse(cachedUser) });
    }

    const user = await User.findOne({ user_id: userId }).select(
      "user_id username email name bio DOB profile_img_url created_at updated_at followers following banner_img_url is_verified -_id"
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    await redis.setex(cacheKey, 3600, JSON.stringify(user));
    res.status(200).json({ user });
  } catch (error) {
    console.error("Get user error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

//public
router.put("/user", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(401).json({ error: "User ID required" });
    }
    
    const {
      email,
      username,
      name,
      bio,
      profile_img_url,
      banner_img_url,
      profile_img_data,
      banner_img_data,
      followers,
      following
    } = req.body;
    
    // Validate input
    if (
      !email &&
      !username &&
      !name &&
      !bio &&
      !profile_img_url &&
      !banner_img_url &&
      !profile_img_data &&
      !banner_img_data &&
      !followers && 
      !following
    ) {
      return res
        .status(400)
        .json({ error: "At least one field must be provided for update" });
    }

    const user = await User.findOne({ user_id: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    console.log(user)

    // Update text fields
    if (email !== undefined) user.email = email;
    if (username !== undefined) user.username = username;
    if (name !== undefined) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (profile_img_url !== undefined) user.profile_img_url = profile_img_url;
    if (banner_img_url !== undefined) user.banner_img_url = banner_img_url;
    if (followers !== undefined) user.followers += followers;
    if (following !== undefined) user.following += following;
    user.updated_at = new Date();

    // Handle Dropbox image uploads
    const dbxAccessToken = await getDbxToken();
    if (!dbxAccessToken) {
      logger.error("Failed to get Dropbox access token");
      return res
        .status(500)
        .json({ error: "Failed to get Dropbox access token" });
    }

    if (profile_img_data && profile_img_data.blob && profile_img_data.name) {
      const validImageTypes = ["image/jpeg", "image/png", "image/gif"];
      if (!validImageTypes.includes(profile_img_data.type)) {
        return res.status(400).json({ error: "Invalid profile image type" });
      }
      const mediaUrl = await uploadToDropbox(
        Buffer.from(profile_img_data.blob, "base64"), // Assuming blob is base64-encoded
        profile_img_data.name,
        dbxAccessToken,
        res
      );
      if (!mediaUrl) {
        return res
          .status(500)
          .json({ error: `Failed to upload profile image to Dropbox` });
      }
      user.profile_img_url = mediaUrl;
    }

    if (banner_img_data && banner_img_data.blob && banner_img_data.name) {
      const validImageTypes = ["image/jpeg", "image/png", "image/gif"];
      if (!validImageTypes.includes(banner_img_data.type)) {
        return res.status(400).json({ error: "Invalid banner image type" });
      }

      const mediaUrl = await uploadToDropbox(
        Buffer.from(banner_img_data.blob, "base64"), // Assuming blob is base64-encoded
        banner_img_data.name,
        dbxAccessToken,
        res
      );
      if (!mediaUrl) {
        return res
          .status(500)
          .json({ error: `Failed to upload banner image to Dropbox` });
      }
      user.banner_img_url = mediaUrl;
    }

    await user.save();

    // Clear Redis cache
    const cacheKey = `user:${userId}`;
    await redis.del(cacheKey);

    // Prepare response
    const updatedUser = {
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
    };

    res.status(200).json({ user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/user/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const cacheKey = `user:${user_id}`;
    const cachedUser = await redis.get(cacheKey);

    if (cachedUser) {
      return res.status(200).json({ user: JSON.parse(cachedUser) });
    }

    const user = await User.findOne({ user_id }).select(
      "user_id username email name bio profile_img_url created_at updated_at followers following banner_img_url is_verified -_id"
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await redis.setex(cacheKey, 3600, JSON.stringify(user));
    res.status(200).json({ user });
  } catch (error) {
    console.error("Get user by ID error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
