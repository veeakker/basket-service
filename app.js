// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, query, update, errorHandler, sparqlEscapeUri, sparqlEscapeString, uuid as makeUuid } from 'mu';

app.get('/ensure', async function( req, res ) {
  // query the database for a basket attached to the current session
  const uuid = await ensureBasketExists(req);

  res.send(JSON.stringify({
    data: {
      type: "baskets",
      id: uuid
    }
  }));
} );

async function ensureBasketExists(req) {
  const sessionId = req.get('mu-session-id');

  const response = await query(`PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    SELECT ?uuid WHERE {
      GRAPH <http://mu.semte.ch/application> {
        ${sparqlEscapeUri(sessionId)} veeakker:hasBasket/mu:uuid ?uuid
      }
    }`);

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

  await update(`PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    INSERT DATA {
      GRAPH <http://mu.semte.ch/application> {
        ${sparqlEscapeUri(sessionId)} veeakker:hasBasket <http://veeakker.be/baskets/${uuid}>.
        <http://veeakker.be/baskets/${uuid}>
          a veeakker:Basket;
          mu:uuid ${sparqlEscapeString( uuid )}.
      }
    }`);

  return uuid;
}

app.use(errorHandler);
