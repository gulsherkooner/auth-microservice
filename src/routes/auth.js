const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const User = require("../models/user");
const redis = require("../config/redis");
const { generateAccessToken, generateRefreshToken } = require("../utils/jwt");
const getDbxToken = require("../utils/getDbxToken");
const uploadToDropbox = require("../config/dropbox");
const logger = require("../config/logger");
const { Op } = require("sequelize");

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
      content_creator: false,
      dating: false,
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
        "content_creator",
        "dating",
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
        "content_creator",
        "dating",
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

// Update User Flags (dating and content_creator)
router.put("/user/flags", async (req, res) => {
  logger.info("Starting PUT /user/flags request");
  
  // Check if request was aborted
  if (req.aborted) {
    logger.warn("Request was aborted before processing");
    return;
  }

  try {
    const userId = req.headers["x-user-id"];
    logger.info(`Received user ID: ${userId}`);
    
    // Add periodic abort checks during long operations
    if (req.aborted) {
      logger.warn("Request aborted during user ID validation");
      return;
    }

    if (!userId) {
      logger.warn("No user ID provided in headers");
      return res.status(401).json({ error: "User ID required" });
    }

    const { dating, content_creator } = req.body;
    logger.info(`Request body - dating: ${dating}, content_creator: ${content_creator}`);

    // Validate input - at least one field must be provided
    if (dating === undefined && content_creator === undefined) {
      logger.warn("No valid fields provided for update");
      return res.status(400).json({ 
        error: "At least one field (dating or content_creator) must be provided" 
      });
    }

    // Validate boolean values
    if (dating !== undefined && typeof dating !== 'boolean') {
      logger.warn(`Invalid dating value type: ${typeof dating}, value: ${dating}`);
      return res.status(400).json({ error: "Dating field must be a boolean value" });
    }

    if (content_creator !== undefined && typeof content_creator !== 'boolean') {
      logger.warn(`Invalid content_creator value type: ${typeof content_creator}, value: ${content_creator}`);
      return res.status(400).json({ error: "Content_creator field must be a boolean value" });
    }

    logger.info(`Searching for user with ID: ${userId}`);
    const user = await User.findOne({ where: { user_id: userId } });
    
    if (!user) {
      logger.warn(`User not found with ID: ${userId}`);
      return res.status(404).json({ error: "User not found" });
    }

    logger.info(`User found: ${user.username}, preparing update data`);

    // Prepare update data
    const updateData = {
      updated_at: new Date()
    };

    if (dating !== undefined) updateData.dating = dating;
    if (content_creator !== undefined) updateData.content_creator = content_creator;

    logger.info(`Update data prepared:`, updateData);

    // Update user
    await user.update(updateData);
    logger.info("User flags updated successfully in database");

    // Clear Redis cache
    const cacheKey = `user:${userId}`;
    try {
      await redis.del(cacheKey);
      logger.info(`Redis cache cleared for key: ${cacheKey}`);
    } catch (cacheError) {
      logger.warn(`Redis cache clear error: ${cacheError.message}`);
    }

    // Get updated user data
    logger.info("Fetching updated user data");
    const updatedUser = await User.findOne({
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
        "content_creator",
        "dating",
      ],
    });

    logger.info(`Updated user data retrieved for: ${updatedUser.username}`);
    logger.info(`Final flags - dating: ${updatedUser.dating}, content_creator: ${updatedUser.content_creator}`);

    res.status(200).json({ 
      message: "User flags updated successfully",
      user: updatedUser 
    });
    
    logger.info("PUT /user/flags request completed successfully");
  } catch (error) {
    // Check if error is due to request abortion
    if (error.code === 'ECONNABORTED' || error.message.includes('aborted')) {
      logger.warn("Request was aborted during processing");
      return;
    }
    
    logger.error(`Update user flags error: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Search Users
router.get("/search/users", async (req, res) => {
  try {
    // Add detailed logging
    const {
      q: searchString,
      page = 1,
      limit = 20,
    } = req.query;
    
    if (!searchString || searchString.trim() === "") {
      return res.status(400).json({ 
        error: "Search query is required",
        debug: {
          received_q: searchString,
          query_params: req.query
        }
      });
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    const isSearchAll = searchString.trim() === "~";

    let whereClause = {};
    
    if (!isSearchAll) {
      whereClause = {
        [Op.or]: [
          { username: { [Op.iLike]: `%${searchString}%` } },
          { name: { [Op.iLike]: `%${searchString}%` } },
          { email: { [Op.iLike]: `%${searchString}%` } }
        ]
      };
    }

    const total = await User.count({ where: whereClause });
    const users = await User.findAll({
      where: whereClause,
      attributes: [
        "user_id",
        "username", 
        "name",
        "bio",
        "profile_img_url",
        "followers",
        "following",
        "is_verified",
        "created_at"
      ],
      order: [['followers', 'DESC']], // Order by popularity
      limit: limitNum,
      offset: offset
    });

    res.json({
      users,
      total,
      totalPages: Math.ceil(total / limitNum),
      page: pageNum,
      limit: limitNum
    });
  } catch (error) {
    logger.error(`User search error: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;