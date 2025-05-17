const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  name: { type: String }, // Changed from display_name
  bio: { type: String },
  DOB: {type: String},
  profile_img_url: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  followers: {type:Number, default: 0},
  following: {type:Number, default: 0},
  banner_img_url: { type: String },
  is_verified: { type: Boolean, default: false },
});

const User = mongoose.model('users', userSchema);

module.exports = User;