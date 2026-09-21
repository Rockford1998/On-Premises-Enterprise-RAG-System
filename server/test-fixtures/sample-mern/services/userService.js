const User = require("../models/User");

/** Return every user. */
async function findAll() {
  return User.find();
}

/** Save a new user to the database. */
async function createUser(data) {
  return User.create(data);
}

async function getUserById(id) {
  return User.findById(id);
}

module.exports = { findAll, createUser, getUserById };
