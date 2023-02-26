// see https://github.com/mu-semtech/mu-javascript-template for more info
import { app, query, update, errorHandler, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, uuid as makeUuid } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { basketJsonApi } from './lib/jsonapi';
import { ensureBasketGraph } from './lib/user-graph';
import { ensureBasketExists, addOrderLine, removeOrderLine, persistInvoiceAddress, persistDeliveryAddress, persistDeliveryMeta, basketUuidBelongsToSession } from './lib/basket';

app.get('/ensure', async function( req, res, next ) {
  // query the database for a basket attached to the current session
  // TODO:should return the basket and all the order lines
  try {
    const sessionId = req.get('mu-session-id');
    const uuid = await ensureBasketExists(sessionId);

    res.send(JSON.stringify(await basketJsonApi(uuid, sessionId)));
  } catch (e) {
    console.log(e);
    next(e);
  }
} );

app.get('/previous/:uuid', async function( req, res, next ) {
  try {
    const sessionId = req.get('mu-session-id');
    const basketUuid = req.params["uuid"];
    if( ! basketUuidBelongsToSession( basketUuid, sessionId ) )
      throw "Basket does not belong to user";

    res.send(JSON.stringify(await basketJsonApi(basketUuid, sessionId)));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/add-order-line', async function( req, res, next ) {
  // TODO: allow merging of same offering
  try {
    const sessionId = req.get("mu-session-id");
    const uuid = await ensureBasketExists(sessionId);
    const { offeringUuid, amount } = req.body;
    await addOrderLine({sessionId, basketUuid: uuid, offeringUuid, amount });

    res.send(JSON.stringify({"succeed": true}));
  } catch(e) {
    console.log(e);
    next(e);
  }
});

app.post('/delete-order-line', async function( req, res, next ) {
  try {
    const sessionId = req.get("mu-session-id");
    const uuid = await ensureBasketExists(sessionId);
    const { orderLineUuid } = req.body;
    await removeOrderLine({sessionId, basketUuid: uuid, orderLineUuid });

    res.send(JSON.stringify({"succeed": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/persist-invoice-info', async function( req, res, next ) {
  try {
    const sessionId = req.get("mu-session-id");
    const uuid = await ensureBasketExists(sessionId);
    const { basketUuid, invoiceAddress, invoicePostal } = req.body;

    if( uuid !== basketUuid )
      throw "Basket id is not the last basket id.";

    await persistInvoiceAddress({
      graph: sessionId,
      basketUuid: uuid,
      invoiceAddress: invoiceAddress.attributes,
      invoicePostal: invoicePostal.attributes
    });

    res.send(JSON.stringify({"succeed": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/persist-delivery-info', async function( req, res, next ) {
  try {
    const sessionId = req.get("mu-session-id");
    const uuid = await ensureBasketExists(sessionId);
    const { basketUuid, deliveryAddress, deliveryPostal,
            hasCustomDeliveryPlace, deliveryPlaceUuid, deliveryType } = req.body;

    if( uuid !== basketUuid )
      throw "Basket id is not the last basket id.";

    await persistDeliveryAddress({
      graph: sessionId,
      basketUuid: uuid,
      deliveryAddress: deliveryAddress.attributes,
      deliveryPostal: deliveryPostal.attributes
    });

    await persistDeliveryMeta({
      graph: sessionId,
      basketUuid: uuid,
      hasCustomDeliveryPlace,
      deliveryPlaceUuid,
      deliveryType
    });

    res.send(JSON.stringify({"succeed": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/merge-graphs', async function( req, res, next) {
  // TODO: Merge the session graph and the graph for the logged in user.
});

app.post('/order-lines', async function( req, res, next) {
  // TODO: Should overwrite all order-lines with the content from this call's
  // body.
});

app.post('/confirm/:uuid', async function( req, res, next ) {
  try {
    const sessionId = req.get('mu-session-id');
    const basketUuid = req.params["uuid"];
    const graph = await ensureBasketGraph(sessionId);
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

app.use(errorHandler);
