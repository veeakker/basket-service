// see https://github.com/mu-semtech/mu-javascript-template for more info
import { app, errorHandler, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { basketJsonApi } from './lib/jsonapi';
import { ensureBasketExists, addOrderLine, removeOrderLine, setOrderLineComment, persistInvoiceAddress, persistDeliveryAddress, persistDeliveryMeta, basketUuidBelongsToSession, mergeBasketFromSessionToAccountGraph, registerBasketChanged } from './lib/basket';

app.get('/ensure', async function( req, res, next ) {
  try {
    const sessionId = req.get('mu-session-id');
    const { graph, basketUri, basketUuid } = await ensureBasketExists(sessionId);

    res.send(JSON.stringify(await basketJsonApi( basketUri, graph)));
  } catch (e) {
    console.log(e);
    next(e);
  }
} );

app.get('/previous/:uuid', async function( req, res, next ) {
  try {
    const sessionId = req.get('mu-session-id');
    const basketUuid = req.params["uuid"];
    const basketInfo = await basketUuidBelongsToSession( basketUuid, sessionId );
    if( !basketInfo  )
      throw "Basket does not belong to user";

    res.send(JSON.stringify(await basketJsonApi( basketInfo.uri, basketInfo.graph )));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/add-order-line', async function( req, res, next ) {
  // TODO: allow merging of same offering
  try {
    const sessionId = req.get("mu-session-id");
    const { graph, basketUri, basketUuid } = await ensureBasketExists(sessionId);
    const { offeringUuid, amount, comment } = req.body;
    await addOrderLine({sessionId, basketUuid, basketUri, graph, offeringUuid, amount, comment });
    await registerBasketChanged({ basketUri, graph });

    res.send(JSON.stringify({"succeed": true}));
  } catch(e) {
    console.log(e);
    next(e);
  }
});

app.post('/add-comment-to-order-line', async function( req, res, next ) {
  try {
    const sessionId = req.get("mu-session-id");
    const { graph } = await ensureBasketExists(sessionId);
    const { orderLineUuid, comment } = req.body;
    await setOrderLineComment({graph, orderLineUuid, comment });
    res.send(JSON.stringify({"succeed": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/delete-order-line', async function( req, res, next ) {
  try {
    const sessionId = req.get("mu-session-id");
    const { graph, basketUri, basketUuid } = await ensureBasketExists(sessionId);
    const { orderLineUuid } = req.body;
    await removeOrderLine({sessionId, basketUuid, basketUri, graph, orderLineUuid });
    await registerBasketChanged({ basketUri, graph });

    res.send(JSON.stringify({"succeed": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/persist-invoice-info', async function( req, res, next ) {
  try {
    const sessionId = req.get("mu-session-id");
    const { graph, basketUri, basketUuid } = await ensureBasketExists(sessionId);
    const { basketUuid: receivedBasketUuid, invoiceAddress, invoicePostal } = req.body;

    if( receivedBasketUuid !== basketUuid )
      throw "Basket id is not the current basket id.";

    await persistInvoiceAddress({
      graph,
      basketUuid,
      basketUri,
      invoiceAddress: invoiceAddress.attributes,
      invoicePostal: invoicePostal.attributes
    });

    await registerBasketChanged({ basketUri, graph });

    res.send(JSON.stringify({"succeed": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/persist-delivery-info', async function( req, res, next ) {
  try {
    const sessionId = req.get("mu-session-id");
    const { graph, basketUri, basketUuid } = await ensureBasketExists(sessionId);
    const { basketUuid: receivedBasketUuid, deliveryAddress, deliveryPostal,
            hasCustomDeliveryPlace, deliveryPlaceUuid, deliveryType } = req.body;

    if( receivedBasketUuid !== basketUuid )
      throw "Basket id is not the last basket id.";

    await persistDeliveryAddress({
      graph,
      basketUri,
      basketUuid,
      deliveryAddress: deliveryAddress.attributes,
      deliveryPostal: deliveryPostal.attributes
    });

    await persistDeliveryMeta({
      graph,
      basketUri,
      basketUuid,
      hasCustomDeliveryPlace,
      deliveryPlaceUuid,
      deliveryType
    });

    await registerBasketChanged({ basketUri, graph });

    res.send(JSON.stringify({"succeed": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.post('/merge-graphs', async function( req, res, next) {
  try {
    const sessionId = req.get('mu-session-id');
    await mergeBasketFromSessionToAccountGraph(sessionId);
    res.send(JSON.stringify({"succeed": true}));
  } catch(e) {
    console.log(e);
    next(e);
  }
});

app.post('/confirm/:uuid', async function( req, res, next ) {
  try {
    const sessionId = req.get('mu-session-id');
    const receivedBasketUuid = req.params["uuid"];
    const { graph, basketUri, basketUuid } = await ensureBasketExists(sessionId);

    // 1. verify basket belongs to your session
    const isOurBasket = await querySudo(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

      SELECT ?s WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          VALUES ?s { <http://example.com/yes-i-exist> }
          ?user veeakker:hasBasket ?basket.
          ?basket
            mu:uuid ${sparqlEscapeString(receivedBasketUuid)};
            veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>.
        }
      }`);
    console.log({isOurBasket});
    if( isOurBasket.results.bindings.length == 0 ) {
      throw "This is not your basket or it is not in draft state.";
    }
    // 2. set basket state to <http://veeakker.be/order-statuses/confirmed>
    await updateSudo(`
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

      DELETE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?basket
            veeakker:basketOrderStatus ?status;
            veeakker:statusChangedAt ?changedDate.
        }
      } INSERT {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?basket
            veeakker:basketOrderStatus <http://veeakker.be/order-statuses/confirmed>;
            veeakker:statusChangedAt ${sparqlEscapeDateTime(new Date())}.
        }
      } WHERE {
        GRAPH ${sparqlEscapeUri(graph)} {
          ${sparqlEscapeUri(graph)} veeakker:hasBasket ?basket.
          ?basket
            mu:uuid ${sparqlEscapeString(basketUuid)};
            veeakker:basketOrderStatus ?status.
          OPTIONAL {
            ?basket veeakker:statusChangedAt ?changedDate.
          }
        }
      }`);
    await registerBasketChanged({ basketUri, graph });
    res.send(200,JSON.stringify({"done": true}));
  } catch (e) {
    console.log(e);
    next(e);
  }
});

app.use(errorHandler);
