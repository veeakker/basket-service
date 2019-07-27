// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, query, update, errorHandler, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, uuid as makeUuid } from 'mu';

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

async function ensureBasketExists(req) {
  const sessionId = req.get('mu-session-id');

  const basketQuery = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

    SELECT ?uuid WHERE {
      GRAPH <http://mu.semte.ch/application> {
        ${sparqlEscapeUri(sessionId)} veeakker:hasBasket ?basket.
        ?basket veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>;
          mu:uuid ?uuid.
      }
    }`;

  const response = await query(basketQuery);
  if( response.results.bindings.length > 0 ) {
    return response.results.bindings[0].uuid.value;
  } else {
    const uuid = await makeBasket( req );
    return uuid;
  }
}

async function makeBasket( req ) {
  const sessionId = req.get('mu-session-id');
  let uuid = makeUuid();

  await update(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

    INSERT DATA {
      GRAPH <http://mu.semte.ch/application> {
        ${sparqlEscapeUri(sessionId)} veeakker:hasBasket <http://veeakker.be/baskets/${uuid}>.
        <http://veeakker.be/baskets/${uuid}>
          a veeakker:Basket;
          mu:uuid ${sparqlEscapeString( uuid )};
          veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>;
          veeakker:statusChangedAt ${sparqlEscapeDateTime(new Date())}.
      }
    }`);

  return uuid;
}

app.use(errorHandler);
