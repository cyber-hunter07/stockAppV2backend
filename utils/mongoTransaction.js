const mongoose = require("mongoose");

// Use atomic transactions when MongoDB is a replica set (including Atlas). Local
// standalone MongoDB supports sessions but not transactions; run the validated
// work in a session there so ordinary stock workflows still function.
async function withMongoTransaction(work) {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const session = await mongoose.startSession();
  try {
    if (hello.setName) return await session.withTransaction(() => work(session));
    return await work(session);
  } finally {
    await session.endSession();
  }
}

module.exports = { withMongoTransaction };
