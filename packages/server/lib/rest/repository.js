const { v4: uuid } = require("uuid");

class PayloadRepository {
  constructor(db, valid) {
    this.db = db;
    this.valid = valid;
  }

  create = async (payload, { id = uuid(), subscriber = null }) => {
    let doc = {
      payload,
      createdAt: new Date(),
      id,
    };

    if (this.valid(payload)) {
      doc.authorized_readers = subscriber === null ? [] : [subscriber];

      await this.db.insertOne(doc, {
        writeConcern: { w: "majority" },
      });
      return id;
    }
  };

  createMany = async (payloads, { subscriber = null }) => {
    let createdAt = new Date();
    let docs = payloads.map((payload) => ({
      payload,
      createdAt,
      id: uuid(),
      authorized_readers: subscriber === null ? [] : [subscriber],
    }));

    let v = { OK: [], BAD_REQUEST: [] };

    let good = [];

    docs.forEach((doc) => {
      if (this.valid(doc.payload)) {
        v.OK.push(doc.id);
        good.push(doc);
      } else {
        v.BAD_REQUEST.push(doc.payload);
      }
    });

    try {
      await this.db.insertMany(good);
    } catch (e) {
      console.log(e);
    }

    return v;
  };

  read = async (id, { createdAt = new Date() }) => {
    let results;
    try {
      results = await this.db
        .find({
          id: id,
          createdAt: { $lt: createdAt },
          deleted: { $exists: false },
        })
        .sort({ createdAt: -1 })
        .toArray();
    } catch (err) {
      console.log("Can't read: ", err);
    }

    //console.log("Reading: " + JSON.stringify(results));
    return results[0];
  };

  readMany = async (ids, { createdAt = new Date(), subscriber = null }) => {
    let match = {
      id: { $in: ids },
      deleted: { $exists: false },
    };

    if (subscriber !== undefined && subscriber !== null) {
      match.authorized_readers = { $in: [subscriber] };
    }

    let results = [];
    try {
      results = await this.db
        .aggregate([
          {
            $match: match,
          },
          {
            $sort: { createdAt: -1 },
          },
          {
            $group: {
              _id: "$id",
              doc: { $first: "$$ROOT" },
            },
          },
          {
            $replaceRoot: { newRoot: "$doc" },
          },
        ])
        .toArray();
    } catch (err) {
      console.log("Error listing: ", err);
    }

    return results.map((r) => r.id);
  };
  remove = async (id) => {
    await this.db.updateMany({ id }, { $set: { deleted: true } });
  };

  removeMany = async (ids) => {
    await this.db.updateMany(
      { id: { $in: ids } },
      { $set: { deleted: true } }
    );
  };

  list = async (subscriber) => {
    let match = { deleted: { $exists: false } };

    if (subscriber !== undefined && subscriber !== null) {
      match.authorized_readers = { $in: [subscriber] };
    }

    let results = [];
    try {
      results = await this.db
        .aggregate([
          {
            $match: match,
          },
          {
            $sort: { createdAt: -1 },
          },
          {
            $group: {
              _id: "$id",
              doc: { $first: "$$ROOT" },
            },
          },
          {
            $replaceRoot: { newRoot: "$doc" },
          },
        ])
        .toArray();
    } catch (err) {
      console.log("Error listing: ", err);
    }

    return results.map((r) => r.id);
  };
}

module.exports = {
  PayloadRepository,
};
