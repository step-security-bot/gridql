const cors = require("cors");
const {ObjectId} = require("mongodb");
const jwt = require("jsonwebtoken");

const getSub = (authHeader) => {
    if(authHeader === null || authHeader === undefined){
        return null;
    }

    if (authHeader.startsWith("Bearer ")){
        const token = authHeader.substring(7, authHeader.length);

        const dToken = jwt.decode(token);

        return dToken["sub"];
    } else {
        console.log("Missing Bearer Token");
        return null;
    }
}

const calculateReaders = (doc, sub) => {
    const readers = new Set();

    if(sub !== null){
        readers.add(sub);
    }
    if("object_id" in doc){
        readers.add(doc.object_id);
    }

    return [... readers]
}

const create = (db, valid, emit, context) => async (req, res) => {
    const doc = req.body;

    doc._authorized_readers = calculateReaders(doc, getSub(req.headers.authorization));

    const result = await db.insertOne(doc)
    if (valid(doc)) {
        emit("create", result.insertedId.toString(), doc)
    }

    res.redirect(`/${context}/${result.insertedId}`);
};

const read = db => async (req, res) => {
    const result = await db.findOne({_id: ObjectId(req.params.id)})
    if (result !== null) {

        if(req.headers.authorization === undefined || result._authorized_readers.includes(getSub(req.headers.authorization))){
            res.json(result);
        } else {
            res.status(403);
            res.json({})
        }
    } else {
        res.status(404);
        res.json({})
    }
};

const update = (db, valid, emit) => async (req, res) => {
    const doc = req.body;
    let {_id, ...mongo_body} = doc
    await db.replaceOne({_id: ObjectId(req.params.id)}, mongo_body).then(() => {
        if (valid(doc)) {
            emit("updated", req.params.id, doc)
        }
        res.json(doc)
    }).catch(err => console.log(err));
};

const remove = (db, emit) => async (req, res) => {
    await db.deleteOne({_id: ObjectId(req.params.id)}).catch(err => console.log(err))

    emit("deleted", req.params.id, {})
    res.json({"deleted": req.params.id})
};


const init = (context, app, db, validate, emit) => {
    app.use(cors());

    app.post(`/${context}`, create(db, validate, emit, context));

    app.get(`/${context}/:id`, read(db));

    app.put(`/${context}/:id`, update(db, validate, emit));

    app.delete(`/${context}/:id`, remove(db, emit));

    return app;
}

module.exports = {
    init, getSub, calculateReaders
}