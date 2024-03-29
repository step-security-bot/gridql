import { Kafka, logLevel } from "kafkajs";

import { MongoDBContainer } from "@testcontainers/mongodb";

import { KafkaContainer } from "@testcontainers/kafka";

import { start } from "../index.js";

import { init } from "../lib/config.js";

import assert from "assert";

import fs from "fs";

import { TestConsumer } from "@gridql/kafka-consumer";

import { after, before, describe, it } from "mocha";
import { fileURLToPath } from "url";
import { dirname } from "path";

let kafka;
let kafkaContainer;
let mongoContainer;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("MongoDB change listener", () => {
  it("should publish a message when a document is inserted", async () => {
    const builders = await init(__dirname + "/config/create.conf");
    let { topic, collection } = builders[0];
    await start(builders);

    let col = collection.s.namespace.collection;

    let tc = new TestConsumer(kafka, { groupId: "test-group-1" });
    await tc.init(topic);
    await tc.run();

    const result = await collection.insertOne({ name: "Test" });
    let actual_id = (result.insertedId = result.insertedId.toString());

    let actual = await tc.current();

    assert.equal(actual.id, actual_id);
    assert.equal(actual.source, col);
    assert.equal(actual.document.name, "Test");
    assert.equal(actual.operation, "CREATE");
  }).timeout(10000);

  it("should publish a message when a document is updated", async () => {
    const builders = await init(__dirname + "/config/update.conf");

    await start(builders);

    const { topic, collection } = builders[0];
    let tc = new TestConsumer(kafka, { groupId: "test-group-2" });
    await tc.init(topic);
    await tc.run();

    const result = await collection.insertOne({ name: "Test" });
    let actual_id = result.insertedId.toString();

    await collection.updateOne(
      { _id: result.insertedId },
      { $set: { name: "Updated Test" } },
    );

    let actual = await tc.current();

    assert.equal(actual.id, actual_id);
    assert.equal(actual.operation, "UPDATE");
  }).timeout(10000);

  it("should publish a message when a document is deleted", async () => {
    const builders = await init(__dirname + "/config/delete.conf");

    await start(builders);

    const { topic, collection } = builders[0];

    let tc = new TestConsumer(kafka, { groupId: "test-group-3" });

    await tc.init(topic);
    await tc.run();

    const result = await collection.insertOne({ name: "Test" });
    let actual_id = result.insertedId.toString();

    await collection.deleteOne({ _id: result.insertedId });

    let actual = await tc.current();

    assert.equal(actual.id, actual_id);
    assert.equal(actual.operation, "DELETE");
  }).timeout(10000);
});

before(async function () {
  this.timeout(360000);

  let [mc, kc] = await Promise.all([
    new MongoDBContainer("mongo:6.0.6")
      .withExposedPorts(27071)
      .start()
      .catch((err) => console.log(err)),
    new KafkaContainer()
      .withExposedPorts(9093)
      .withEnvironment({ KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true" })
      .withEnvironment({ KAFKA_DELETE_TOPIC_ENABLE: "true" })
      .start()
      .catch((reason) =>
        console.log("Kafka container failed to start: ", reason),
      ),
  ]);

  mongoContainer = mc;
  kafkaContainer = kc;

  const uri = mongoContainer.getConnectionString();

  console.log("mongodb uri: ", uri);

  console.log(
    `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}`,
  );

  let config = `
        {builders: [
            {"mongo": {
                "uri": "${mongoContainer.getConnectionString()}",
                "db": "test",
                "collection": \${topic},
                "options": {
                  "directConnection": true
                }
            },
            "kafka": {
                "brokers": ["${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}"],
                "host": "${kafkaContainer.getHost()}",
                "clientId": "mongo-event-builder-test",
                "topic": \${topic},
                "id": "_id"
            }}
        ]}`;

  kafka = new Kafka({
    logLevel: logLevel.INFO,
    brokers: [
      `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}`,
    ],
    clientId: "mongo-event-builder-test",
  });

  fs.writeFileSync(__dirname + "/config/base.conf", config);
});

after(async () => {
  console.log("-----CLEANING UP------");
  await kafkaContainer.stop();
  await mongoContainer.stop();
});
