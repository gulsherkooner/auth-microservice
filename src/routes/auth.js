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

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "Email or username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const newUser = await User.create({
      user_id: userId,
      email,
      username,
      password_hash: hashedPassword,
      name: name || "",
      bio: bio || "",
      dob: DOB || "",
      profile_img_url: profile_img_url || "",
      created_at: new Date(),
      updated_at: new Date(),
      followers: 0,
      following: 0,
      banner_img_url: "",
      is_verified: false,
    });

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

    const user = await User.findOne({ where: { email } });
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
      user,
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get User
router.get("/user", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(401).json({ error: "User ID required" });
    }

    const cacheKey = `user:${userId}`;
    
    // Try to get from cache first
    try {
      const cachedUser = await redis.get(cacheKey);
      if (cachedUser) {
        return res.status(200).json({ user: JSON.parse(cachedUser) });
      }
    } catch (cacheError) {
      console.warn("Redis cache read error:", cacheError.message);
      // Continue without cache if Redis fails
    }

    const user = await User.findOne({
      where: { user_id: userId },
      attributes: [
        "user_id",
        "username",
        "email",
        "name",
        "bio",
        "profile_img_url",
        "created_at",
        "updated_at",
        "followers",
        "following",
        "banner_img_url",
        "is_verified",
      ],
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Try to cache the result, but don't fail if it doesn't work
    try {
      await redis.setex(cacheKey, 3600, JSON.stringify(user));
    } catch (cacheError) {
      console.warn("Redis cache write error:", cacheError.message);
      // Continue without caching if Redis fails
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error("Get user error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update User
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
      following,
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
      followers === undefined &&
      following === undefined
    ) {
      return res
        .status(400)
        .json({ error: "At least one field must be provided for update" });
    }

    const user = await User.findOne({ where: { user_id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Prepare update data
    const updateData = {};
    if (email !== undefined) updateData.email = email;
    if (username !== undefined) updateData.username = username;
    if (name !== undefined) updateData.name = name;
    if (bio !== undefined) updateData.bio = bio;
    if (profile_img_url !== undefined) updateData.profile_img_url = profile_img_url;
    if (banner_img_url !== undefined) updateData.banner_img_url = banner_img_url;
    if (followers !== undefined) updateData.followers = user.followers + followers;
    if (following !== undefined) updateData.following = user.following + following;
    updateData.updated_at = new Date();

    // Handle Dropbox image uploads
    const dbxAccessToken = await getDbxToken();
    if (!dbxAccessToken) {
      console.error("Failed to get Dropbox access token");
      return res
        .status(500)
        .json({ error: "Failed to get Dropbox access token" });
    }

    if (profile_img_data && profile_img_data.blob && profile_img_data.name) {
      const validImageTypes = ["image/jpeg", "image/png", "image/gif", "image/ico"];
      if (!validImageTypes.includes(profile_img_data.type)) {
        return res.status(400).json({ error: "Invalid profile image type" });
      }
      const mediaUrl = await uploadToDropbox(
        Buffer.from(profile_img_data.blob, "base64"),
        profile_img_data.name,
        dbxAccessToken,
        res
      );
      if (!mediaUrl) {
        return res
          .status(500)
          .json({ error: "Failed to upload profile image to Dropbox" });
      }
      updateData.profile_img_url = mediaUrl;
    }

    if (banner_img_data && banner_img_data.blob && banner_img_data.name) {
      const validImageTypes = ["image/jpeg", "image/png", "image/gif"];
      if (!validImageTypes.includes(banner_img_data.type)) {
        return res.status(400).json({ error: "Invalid banner image type" });
      }
      const mediaUrl = await uploadToDropbox(
        Buffer.from(banner_img_data.blob, "base64"),
        banner_img_data.name,
        dbxAccessToken,
        res
      );
      if (!mediaUrl) {
        return res
          .status(500)
          .json({ error: "Failed to upload banner image to Dropbox" });
      }
      updateData.banner_img_url = mediaUrl;
    }

    // Update user
    await user.update(updateData);

    // Clear Redis cache
    const cacheKey = `user:${userId}`;
    await redis.del(cacheKey);

    // Prepare response
    const updatedUser = await User.findOne({
      where: { user_id: userId },
      attributes: [
        "user_id",
        "email",
        "username",
        "name",
        "bio",
        "profile_img_url",
        "created_at",
        "updated_at",
        "followers",
        "following",
        "banner_img_url",
        "is_verified",
      ],
    });

    res.status(200).json({ user: updatedUser });
  } catch (error) {
    console.error("Update user error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get User by ID
router.get("/user/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const cacheKey = `user:${user_id}`;
    
    // Try to get from cache first
    try {
      const cachedUser = await redis.get(cacheKey);
      if (cachedUser) {
        return res.status(200).json({ user: JSON.parse(cachedUser) });
      }
    } catch (cacheError) {
      console.warn("Redis cache read error:", cacheError.message);
      // Continue without cache if Redis fails
    }

    const user = await User.findOne({
      where: { user_id },
      attributes: [
        "user_id",
        "username",
        "email",
        "name",
        "bio",
        "profile_img_url",
        "created_at",
        "updated_at",
        "followers",
        "following",
        "banner_img_url",
        "is_verified",
      ],
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Try to cache the result, but don't fail if it doesn't work
    try {
      await redis.setex(cacheKey, 3600, JSON.stringify(user));
    } catch (cacheError) {
      console.warn("Redis cache write error:", cacheError.message);
      // Continue without caching if Redis fails
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error("Get user by ID error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/change-password", async (req, res) => {
  console.log("Received");
  try {
    const userId = req.headers["x-user-id"];
    const { currentPassword, newPassword } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User ID required" });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both current and new password are required" });
    }

    const user = await User.findOne({ user_id: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect current password" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password_hash = hashedNewPassword;
    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Change password error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;