const {ObjectId} = require("mongodb");
const jwt = require("jsonwebtoken");
const express = require("express");
const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");


const getSub = (authHeader) => {
    if (authHeader === null || authHeader === undefined) {
        return null;
    }

    if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7, authHeader.length);

        const dToken = jwt.decode(token);

        return dToken["sub"];
    } else {
        console.log("Missing Bearer Token");
        return null;
    }
}

function isAuthorized(auth_header, result) {
    return auth_header === undefined //internal or a test (hasn't gone through gateway)
        || result._authorized_readers.count === 0 //everyone can read
        || result._authorized_readers.includes(getSub(auth_header)); //current sub is in the list
}

const calculateReaders = (doc, sub) => {
    const readers = new Set();

    if (sub !== null) {
        readers.add(sub);
    }

    return [...readers]
}
/**
 * @swagger
 *
 * paths /{context}:
 *  post:
 *      summary: Create a new entity
 *      responses:
 *        303:
 *          description: successful creation and redirect to new url
 *         400:
 *          description: the document doesn't match the schema for the entity
 */
const create = (db, valid, context) => async (req, res) => {
    const {_id, ...doc} = req.body;
    if (valid(doc)) {
        doc._authorized_readers = calculateReaders(doc, getSub(req.headers.authorization));

        const result = await db.insertOne(doc,{ writeConcern: { w: 'majority' } })
        if(req.headers.authorization !== undefined) {
            res.header("Authorization", req.headers.authorization)
        }
        res.redirect(303, `${context}/${result.insertedId}`);
    } else {
        res.sendStatus(400);
    }
};


const read = db => async (req, res) => {
    const result = await db.findOne({_id: new ObjectId(req.params.id)})

    if (result !== null) {

        if (isAuthorized(req.headers.authorization, result)) {
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


const update = (db) => async (req, res) => {
    const {_id, ...doc} = req.body;
    const result = await db.findOne({_id: new ObjectId(req.params.id)})
    if (result !== null) {
        if (isAuthorized(req.headers.authorization, result)) {
            await db.replaceOne({_id: new ObjectId(req.params.id)}, doc).catch(err => console.log(err));
            res.json(doc);
        } else {
            res.status(403);
            res.json({})
        }
    } else {
        res.status(404);
        res.json({})
    }
};


const remove = (db) => async (req, res) => {
    const result = await db.findOne({_id: new ObjectId(req.params.id)})
    if (result !== null) {
        if (isAuthorized(req.headers.authorization, result)) {
            await db.deleteOne({_id: new ObjectId(req.params.id)}).catch(err => console.log(err))
            res.json({"deleted": req.params.id})
        } else {
            res.status(403);
            res.json({})
        }
    } else {
        res.status(404);
        res.json({})
    }
};

const list = (db) => async (req, res) => {
    let results;

    if (req.headers.authorization === undefined) {
        results = await db.find().toArray();
    } else {
        let sub = getSub(req.headers.authorization);
        results = await db.find({_authorized_readers: sub}).toArray();
    }
    res.json(results);
}

const bulk_create = (url) => async (req, res) => {
    const init = {
        method: "POST",
        redirect: "follow",
        headers: {
            "Content-Type": "application/json"
        }
    }

    if(req.headers.authorization !== undefined) {
        init.header["Authorization"] = req.headers.authorization
    }

    let responses = await Promise.all(req.body.map((doc) => {
        init["body"] = JSON.stringify(doc)
        return fetch(url, init)
    }));

    const res_body = await extracted(responses);

    console.log(res_body)
    res.json(res_body);
}

const bulk_read = (url) => async (req, res) => {
    const init = {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    }

    if(req.headers.authorization !== undefined) {
        init.header["Authorization"] = req.headers.authorization
    }

    let ids = req.query.ids.split(",");

    let responses = await Promise.all(ids.map((id) => {
        let location = `${url}/${id}`;
        return fetch(location, init)
    }));

    const res_body = await extracted(responses);

    res.json(res_body);
}

const bulk_delete = (url) => async (req, res) => {
    const init = {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json"
        }
    }

    if(req.headers.authorization !== undefined) {
        init.header["Authorization"] = req.headers.authorization
    }

    let ids = req.query.ids.split(",");

    let responses = await Promise.all(ids.map((id) => {
        let location = `${url}/${id}`;
        return fetch(location, init)
    }));

    const res_body = await extracted(responses);

    res.json(res_body);
}


const init = (url, context, app, db, validate, schema) => {

    console.log("API Docks Might Be Available on: ", `${context}/api-docs`);

    app.use(`${context}/api-docs`, swaggerUi.serve, swaggerUi.setup(swagger(context, schema)));

    app.use(express.json());

    app.post(`${context}/bulk`, bulk_create(url));
    app.get(`${context}/bulk`, bulk_read(url));
    app.delete(`${context}/bulk`, bulk_delete(url));

    app.post(`${context}`, create(db, validate, context));

    app.get(`${context}`, list(db));

    app.get(`${context}/:id`, read(db));

    app.put(`${context}/:id`, update(db));

    app.delete(`${context}/:id`, remove(db));

    return app;
}

async function extracted(responses) {
    const res_body = {}

    for (let response of responses) {
        let collection = res_body[response.statusText] || [];

        let good = response.status >= 200 && response.status < 300 && !Object.keys(response.body).length;
        let value;

        if (good) {
            try {
                value = await response.json().catch((err) => console.log(err));
            } catch (err) {
                console.log(err);
            }
        } else {
            value = response.url;
        }

        collection.push(value);

        res_body[response.statusText] = collection;
    }
    return res_body;
}

module.exports = {
    init, getSub, calculateReaders
}

const swagger = (context, schema) => {
    return {
        "openapi":
            "3.0.0",
        "info":
            {
                "title":
                    `${context}`,
                "version":
                    "1.0.0"
            }
        ,
        "paths":
            {
                [context + "/{id}"]:
                    {
                        "get":
                            {
                                "summary":
                                    "Retrieves a document",
                                "parameters":
                                    [
                                        {
                                            "in": "path",
                                            "name": "id",
                                            "required": true,
                                            "schema": {
                                                "type": "string"
                                            },
                                            "description": "The ID of the document to retrieve."
                                        }
                                    ],
                                "responses":
                                    {
                                        "200":
                                            {
                                                "description":
                                                    "The document was successfully retrieved.",
                                                "content":
                                                    {
                                                        "application/json":
                                                            {
                                                                "schema":
                                                                    {
                                                                        "$ref":
                                                                            "#/components/schemas/State"
                                                                    }
                                                            }
                                                    }
                                            }
                                        ,
                                        "404":
                                            {
                                                "description":
                                                    "A document with the specified ID was not found."
                                            }
                                    }
                            }
                        ,
                        "put":
                            {
                                "summary":
                                    "Creates or updates a document",
                                "parameters":
                                    [
                                        {
                                            "in": "path",
                                            "name": "id",
                                            "required": true,
                                            "schema": {
                                                "type": "string"
                                            },
                                            "description": "The ID of the document to create or update."
                                        }
                                    ],
                                "requestBody":
                                    {
                                        "required":
                                            true,
                                        "content":
                                            {
                                                "application/json":
                                                    {
                                                        "schema":
                                                            {
                                                                "$ref":
                                                                    "#/components/schemas/State"
                                                            }
                                                    }
                                            }
                                    }
                                ,
                                "responses":
                                    {
                                        "200":
                                            {
                                                "description":
                                                    "The document was successfully updated."
                                            }
                                        ,
                                        "201":
                                            {
                                                "description":
                                                    "The document was successfully created.",
                                                "headers":
                                                    {
                                                        "Location":
                                                            {
                                                                "schema":
                                                                    {
                                                                        "type":
                                                                            "string"
                                                                    }
                                                                ,
                                                                "description":
                                                                    "URI of the created document."
                                                            }
                                                    }
                                            }
                                    }
                            }
                        ,
                        "delete":
                            {
                                "summary":
                                    "Deletes a document",
                                "parameters":
                                    [
                                        {
                                            "in": "path",
                                            "name": "id",
                                            "required": true,
                                            "schema": {
                                                "type": "string"
                                            },
                                            "description": "The ID of the document to delete."
                                        }
                                    ],
                                "responses":
                                    {
                                        "204":
                                            {
                                                "description":
                                                    "The document was successfully deleted."
                                            }
                                        ,
                                        "404":
                                            {
                                                "description":
                                                    "A document with the specified ID was not found."
                                            }
                                    }
                            }
                    }
                ,
                [context + "/bulk"]:
                    {
                        "get":
                            {
                                "summary":
                                    "Retrieves a list of all documents",
                                "responses":
                                    {
                                        "200":
                                            {
                                                "description":
                                                    "The documents were successfully retrieved.",
                                                "content":
                                                    {
                                                        "application/json":
                                                            {
                                                                "schema":
                                                                    {
                                                                        "type":
                                                                            "array",
                                                                        "items":
                                                                            {
                                                                                "$ref":
                                                                                    "#/components/schemas/State"
                                                                            }
                                                                    }
                                                            }
                                                    }
                                            }
                                    }
                            }
                        ,
                        "post":
                            {
                                "summary":
                                    "Creates multiple documents",
                                "requestBody":
                                    {
                                        "required":
                                            true,
                                        "content":
                                            {
                                                "application/json":
                                                    {
                                                        "schema":
                                                            {
                                                                "type":
                                                                    "array",
                                                                "items":
                                                                    {
                                                                        "$ref":
                                                                            "#/components/schemas/State"
                                                                    }
                                                            }
                                                    }
                                            }
                                    }
                                ,
                                "responses":
                                    {
                                        "200":
                                            {
                                                "description":
                                                    "The documents were successfully created.",
                                                "content":
                                                    {
                                                        "application/json":
                                                            {
                                                                "schema":
                                                                    {
                                                                        "type":
                                                                            "object",
                                                                        "properties":
                                                                            {
                                                                                "successful":
                                                                                    {
                                                                                        "type":
                                                                                            "array",
                                                                                        "items":
                                                                                            {
                                                                                                "$ref":
                                                                                                    "#/components/schemas/OperationStatus"
                                                                                            }
                                                                                    }
                                                                                ,
                                                                                "failed":
                                                                                    {
                                                                                        "type":
                                                                                            "array",
                                                                                        "items":
                                                                                            {
                                                                                                "$ref":
                                                                                                    "#/components/schemas/OperationStatus"
                                                                                            }
                                                                                    }
                                                                            }
                                                                    }
                                                            }
                                                    }
                                            }
                                    }
                            }
                        ,
                        "delete":
                            {
                                "summary":
                                    "Deletes multiple documents",
                                "responses":
                                    {
                                        "200":
                                            {
                                                "description":
                                                    "The documents were successfully deleted.",
                                                "content":
                                                    {
                                                        "application/json":
                                                            {
                                                                "schema":
                                                                    {
                                                                        "type":
                                                                            "object",
                                                                        "properties":
                                                                            {
                                                                                "successful":
                                                                                    {
                                                                                        "type":
                                                                                            "array",
                                                                                        "items":
                                                                                            {
                                                                                                "$ref":
                                                                                                    "#/components/schemas/OperationStatus"
                                                                                            }
                                                                                    }
                                                                                ,
                                                                                "failed":
                                                                                    {
                                                                                        "type":
                                                                                            "array",
                                                                                        "items":
                                                                                            {
                                                                                                "$ref":
                                                                                                    "#/components/schemas/OperationStatus"
                                                                                            }
                                                                                    }
                                                                            }
                                                                    }
                                                            }
                                                    }
                                            }
                                    }
                            }
                    }
            }
        ,
        "components":
            {
                "schemas":
                    {
                        "State": schema,
                        "OperationStatus":
                            {
                                "type":
                                    "object",
                                "properties":
                                    {
                                        "id":
                                            {
                                                "type":
                                                    "string"
                                            }
                                        ,
                                        "status":
                                            {
                                                "type":
                                                    "string"
                                            }
                                        ,
                                        "error":
                                            {
                                                "type":
                                                    "string"
                                            }
                                    }
                            }
                    }
            }
    }
}