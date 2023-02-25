// see https://github.com/mu-semtech/mu-javascript-template for more info
import { app, query, update, errorHandler, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, uuid as makeUuid } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';

app.get('/ensure', async function( req, res, next ) {
  // query the database for a basket attached to the current session
  try {
    const uuid = await ensureBasketExists(req);

    res.send(JSON.stringify({
      data: {
        type: "baskets",
        id: uuid
      }
    }));
  } catch (e) {
    console.log(e);
    next(e);
  }
} );

app.post('/confirm/:uuid', async function( req, res, next ) {
  try {
    const sessionId = req.get('mu-session-id');
    const basketUuid = req.params["uuid"];
    const graph = ensureBasketGraph(sessionId);
    // 1. verify basket belongs to your session
    const isOurBasket = await querySudo(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

      SELECT ?s WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          VALUES ?s { <http://example.com/yes-i-exist> }
          ${sparqlEscapeUri(sessionId)} veeakker:hasBasket ?basket.
          ?basket
            mu:uuid ${sparqlEscapeString(basketUuid)};
            veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>.
        }
      }`);
    console.log({isOurBasket});
    if( isOurBasket.results.bindings.length == 0 ) {
      throw "This is not yoru basket or it is not in draft state.";
    }
    // 2. set basket state to <http://veeakker.be/order-statuses/confirmed>
    await updateSudo(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

      DELETE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?basket veeakker:basketOrderStatus ?status.
        }
      } INSERT {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?basket veeakker:basketOrderStatus <http://veeakker.be/order-statuses/confirmed>.
        }
      } WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ${sparqlEscapeUri(sessionId)} veeakker:hasBasket ?basket.
          ?basket
            mu:uuid ${sparqlEscapeString(basketUuid)};
            veeakker:basketOrderStatus ?status.
        }
      }`);
    res.send(200,JSON.stringify({"done": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

/**
 * Get the graph for the user's account or null.
 */
async function getUserAccountGraph(sessionId) {
  const searchGraph = await querySudo(`${PREFIXES}
    SELECT ?graph WHERE {
      GRAPH ?graph {
        ?graph veeakker:graphBelongsToUser/foaf:account/^session:account ${sparqlEscapeUri(sessionId)}.
      }
    }`);

  if( searchGraph.results.bindings.length > 0 )
    return searchGraph.results.bindings[0].graph.value;
  else
    return null;
}

/**
 * Get the graph for the user's session or null.
 */
async function getSessionGraph(sessionId) {
  const searchGraph = await querySudo(`${PREFIXES}
    SELECT ?graph WHERE {
      GRAPH ?graph {
        ?graph veeakker:graphBelongsToSession ${sparqlEscapeUri(sessionId)}.
      }
    }`);

  if( searchGraph.results.bindings.length > 0 )
    return searchGraph.results.bindings[0].graph.value;
  else
    return null;
}

/**
 * Ensures a graph exists for the baskte and yields that graph.
 */
async function ensureBasketGraph(req) {
  // Ensures a graph exists to store the current user's or session's
  // graph.
  const sessionId = req.get('mu-session-id');

  const currentGraph =
        (await getUserAccountGraph(sessionId))
        || (await getSessionGraph(sessionId));

  if (currentGraph ) {
    return currentGraph;
  } else {
    // TODO: ensure our login service creates the graph for the user on login

    // create the graph for the session
    await updateSudo(`${PREFIXES}
      INSERT DATA {
        GRAPH ${sparqlEscapeUri(sessionId)} {
          ${sparqlEscapeUri(sessionId)} veeakker:graphBelongsToSession ${sparqlEscapeUri(sessionId)}.
        }
      }`);

    return sessionId;
  }
}

/**
 * Ensures the session has a basket, returning its uuid.
 */
async function ensureBasketExists(req) {
  const sessionId = req.get('mu-session-id');
  const graph = await ensureBasketGraph(req);

  const basketQuery = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

    SELECT ?uuid WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(sessionId)} veeakker:hasBasket ?basket.
        ?basket veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>;
          mu:uuid ?uuid.
      }
    }`;

  const response = await querySudo(basketQuery);
  if (response.results.bindings.length > 0) {
    return response.results.bindings[0].uuid.value;
  } else {
    const uuid = await makeBasket(sessionId, graph);
    return uuid;
  }
}

async function makeBasket(sessionId, graph) {
  let uuid = makeUuid();
  await updateSudo(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

    INSERT DATA {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(sessionId)} veeakker:hasBasket <http://veeakker.be/baskets/${uuid}>.
        <http://veeakker.be/baskets/${uuid}>
          a veeakker:Basket;
          mu:uuid ${sparqlEscapeString(uuid)};
          veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>;
          veeakker:statusChangedAt ${sparqlEscapeDateTime(new Date())}.
      }
    }`);

  return uuid;
}

app.use(errorHandler);
