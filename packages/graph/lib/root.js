import { DTOFactory } from "./DTOFactory.js";

import { isAuthorized } from "@gridql/auth";

import Log4js from "log4js";

let logger = Log4js.getLogger("gridql/root");

export const context = (db, config) => {
  let dtoF = new DTOFactory(config.resolvers);
  let rt = root(db, dtoF, config);

  return {
    dtoFactory: dtoF,
    root: rt,
  };
};

export const root = (db, dtoFactory, { singletons, scalars }) => {
  let base = {};

  if (singletons !== undefined) {
    for (const s of singletons) {
      base[s.name] = singleton(db, dtoFactory, s.id, s.query);
    }
  }

  if (scalars !== undefined) {
    for (const s of scalars) {
      base[s.name] = scalar(db, dtoFactory, s.id, s.query);
    }
  }

  return base;
};

export const processQueryTemplate = (id, queryTemplate) => {
  const queryWithId = queryTemplate.replace("${id}", id);
  let json;

  try {
    json = JSON.parse(queryWithId);
  } catch (e) {
    logger.error(
      `Failed to create query:
      Query Template: ${queryTemplate}
      id: ${id}
      Updated Query: ${queryWithId}
    `,
    );
    throw e;
  }
  return json;
};

export const scalar = (db, dtoFactory, i, queryTemplate) => {
  return async function (args, context) {
    let id = args[i];
    let timestamp = getTimestamp(args);
    let time_filter = {
      $lt: new Date(timestamp),
    };

    let query = processQueryTemplate(id, queryTemplate);

    query.createdAt = time_filter;

    let results = await db
      .aggregate([
        {
          $match: query,
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

    if (context !== undefined) {
      results = results.filter((r) => isAuthorized(context.subscriber, r));
    }
    return dtoFactory.fillMany(
      results.map((r) => {
        r.payload.id = r.id;
        return r.payload;
      }),
      context === undefined ? null : context.auth_header,
      timestamp,
    );
  };
};

export function getTimestamp(args) {
  let atArg = "at";
  let at;
  if (Object.hasOwnProperty.call(args, atArg)) {
    at = args["at"];
  } else {
    at = Date.now();
  }

  return at;
}

export const singleton = (db, dtoFactory, id, queryTemplate) => {
  return async function (args, context) {
    let argValue = args[id];
    const query = processQueryTemplate(argValue, queryTemplate);

    let timestamp = getTimestamp(args);

    query.createdAt = {
      $lt: new Date(timestamp),
    };

    const results = await db.find(query).sort({ createdAt: -1 }).toArray();
    let result = results[0];

    if (result === null || result === undefined) {
      logger.debug(`Nothing found for: ${argValue}`);
      return result;
    } else {
      if (context === undefined || isAuthorized(context.subscriber, result)) {
        result.payload.id = result.id;
        return dtoFactory.fillOne(
          result.payload,
          context === undefined ? null : context.auth_header,
          timestamp,
        );
      } else {
        return null;
      }
    }
  };
};
