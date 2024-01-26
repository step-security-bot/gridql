const parser = require("@pushcorn/hocon-parser");
const {buildDb} = require("@gridql/mongo-connector");
const {context} = require("./graph/root");
const fs = require("fs");
const {buildSchema} = require("graphql/index");
const {valid} = require("@gridql/payload-validator");

const process_graphlettes = async (config) => {
    return await Promise.all(
        config["graphlettes"].map(async ({mongo, dtoConfig, schema, path}) => {
            let db = await buildDb(mongo);

            let {root} = context(db, dtoConfig);

            let sch = fs.readFileSync(schema).toString();
            const graphSchema = buildSchema(sch);

            return {path, graph: {schema: graphSchema, root}};
        })
    );
};

const process_restlettes = async (config) => {
    return await Promise.all(
        config["restlettes"].map(async ({mongo, schema, path}) => {
            let db = await buildDb(mongo);

            let sch = JSON.parse(fs.readFileSync(schema).toString());

            return {path, schema: sch, validator: valid(sch), db};
        })
    );
};
const parse = async (configFile) => {
    const config = await parser
        .parse({url: configFile})
        .catch((e) => console.log("Error parse config: ", e));

    console.log("Config file: ", JSON.stringify(config, null, 2));

    const url = config["url"];
    const port = config["port"];

    let graphlettes = [];

    let restlettes = [];

    try {
        if (config["graphlettes"] !== undefined) {
            graphlettes = await process_graphlettes(config);
        }
    } catch (err) {
        console.log(err);
    }

    try {
        if (config["restlettes"] !== undefined) {
            restlettes = await process_restlettes(config);
        }
    } catch (err) {
        console.log(err);
    }

    return {url, port, graphlettes, restlettes};
};

module.exports = {
    parse, process_graphlettes, process_restlettes
}