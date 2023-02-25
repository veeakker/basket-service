import { ensureBasketGraph } from './user-graph';
import { uuid as makeUuid, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeInt } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import PREFIXES from './prefixes';

/**
 * Ensures the session has a basket, returning its uuid.
 */
async function ensureBasketExists(sessionId) {
  const graph = await ensureBasketGraph(sessionId);

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

async function basketInfo( basketUuid, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?paymentStatus ?orderStatus ?changedAt ?hasCustomDeliveryPlace ?deliveryPlaceUuid WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?s mu:uuid ${sparqlEscapeString(basketUuid)}.
        OPTIONAL { ?s veeakker:paymentStatus ?paymentStatus. }
        OPTIONAL { ?s veeakker:orderStatus ?orderStatus. }
        OPTIONAL { ?s veeakker:statusChangedAt ?changedAt. }
        OPTIONAL { ?s veeakker:hasCustomDeliveryPlace ?hasCustomDeliveryPlace. }
        OPTIONAL {
          ?s veeakker:deliveryPlace ?deliveryPlaceUri.
          GRAPH <http://mu.semte.ch/graphs/public> { ?deliveryPlace mu:uuid ?deliveryPlaceUuid. }
        }
      }
    }`);

  if ( query.results.bindings[0] ) {
    const bindings = query.results.bindings[0];
    const customDeliveryPlaceBinding = bindings.hasCustomDeliveryPlace && bindings.hasCustomDeliveryPlace.value;
    return {
      uuid: basketUuid,
      paymentStatus: (bindings.paymentStatus && bindings.paymentStatus.value) || null,
      orderStatus: (bindings.orderStatus && bindings.orderStatus.value) || null,
      changedAt: (bindings.changedAt && bindings.changedAt.value) || null,
      hasCustomDeliveryPlace: customDeliveryPlaceBinding || null,
      deliveryPlaceUuid: (bindings.deliveryPlaceUuid && bindings.deliveryPlaceUuid.value) || null
    };
  } else {
    throw `Could not find basket ${basketUuid} in graph ${graph}`;
  }
}

async function basketOrderLines( basketUuid, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?orderLineUuid ?orderLineAmount ?orderLineOfferingUuid WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ?s mu:uuid ${sparqlEscapeString(basketUuid)}.
        ?s veeakker:orderLine ?orderLine.
        ?orderLine
          mu:uuid ?orderLineUuid;          
          veeakker:amount ?orderLineAmount.
        OPTIONAL {
          ?orderLine veeakker:hasOffering ?offering.
        }
      }
      GRAPH <http://mu.semte.ch/graphs/public> {
        ?offering mu:uuid ?orderLineOfferingUuid.
      }
    }`);

  return query.results.bindings.map( (bindings) => ({
    uuid: bindings.orderLineUuid ? bindings.orderLineUuid.value : null,
    amount: bindings.orderLineAmount ? bindings.orderLineAmount.value : null,
    offeringUuid: bindings.orderLineOfferingUuid ? bindings.orderLineOfferingUuid.value : null
  }));
}

async function basketDeliveryAddress( basketUuid, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?uuid ?name ?company ?telephone ?email ?postalAddressUuid ?postalLocality ?postalCode ?postalStreetAddress WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ?basket
          mu:uuid ${sparqlEscapeString(basketUuid)};
          veeakker:deliveryAddress ?address.
        ?address mu:uuid ?uuid.
        OPTIONAL { ?address foaf:name ?name. }
        OPTIONAL { ?address ext:companyInfo ?company. }
        OPTIONAL { ?address foaf:phone ?telephone. }
        OPTIONAL { ?email schema:email ?email. }
        OPTIONAL {
          ?address schema:hasAddress ?postal.
          ?postal mu:uuid ?postalAddressUuid.
          OPTIONAL { ?postal schema:addressLocality ?postalLocality }
          OPTIONAL { ?postal schema:postalCode ?postalCode }
          OPTIONAL { ?postal schema:streetAddress ?streetAddress }
        }
      }
    }`);
  
  if ( query.results.bindings.length > 0 ) {
    const bindings = query.results.bindings[0];

    return {
      uuid: bindings.uuid.value,
      name: (bindings.name && bindings.name.value),
      company: (bindings.company && bindings.company.value),
      telephone: (bindings.telephone && bindings.telephone.value),
      email: (bindings.email && bindings.email.value),
      postalAddressUuid: (bindings.postalAddressUuid && bindings.postalAddressUuid.value),
      postalLocality: (bindings.postalLocality && bindings.postalLocality.value),
      postalCode: (bindings.postalCode && bindings.postalCode.value),
      streetAddress: (bindings.streetAddress && bindings.streetAddress.value)
    };
  } else {
    return null;
  }
}

async function basketInvoiceAddress( basketUuid, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?uuid ?name ?company ?telephone ?email ?postalAddressUuid ?postalLocality ?postalCode ?postalStreetAddress WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ?basket
          mu:uuid ${sparqlEscapeString(basketUuid)};
          veeakker:invoiceAddress ?address.
        ?address mu:uuid ?uuid.
        OPTIONAL { ?address foaf:name ?name. }
        OPTIONAL { ?address ext:companyInfo ?company. }
        OPTIONAL { ?address foaf:phone ?telephone. }
        OPTIONAL { ?email schema:email ?email. }
        OPTIONAL {
          ?address schema:hasAddress ?postal.
          ?postal mu:uuid ?postalAddressUuid.
          OPTIONAL { ?postal schema:addressLocality ?postalLocality }
          OPTIONAL { ?postal schema:postalCode ?postalCode }
          OPTIONAL { ?postal schema:streetAddress ?streetAddress }
        }
      }
    }`);
  
  if ( query.results.bindings.length > 0 ) {
    const bindings = query.results.bindings[0];

    return {
      uuid: (bindings.uuid && bindings.uuivalue),
      name: (bindings.name && bindings.name.value),
      company: (bindings.company && bindings.company.value),
      telephone: (bindings.telephone && bindings.telephone.value),
      email: (bindings.email && bindings.email.value),
      postalAddressUuid: (bindings.postalAddressUuid && bindings.postalAddressUuid.value),
      postalLocality: (bindings.postalLocality && bindings.postalLocality.value),
      postalCode: (bindings.postalCode && bindings.postalCode.value),
      streetAddress: (bindings.streetAddress && bindings.streetAddress.value)
    };
  } else {
    return null;
  }
}

async function addOrderLine( { sessionId, basketUuid, offeringUuid, amount } ) {
  const graph = sessionId;
  const orderLineUuid = makeUuid();
  const orderLineUri = `http://veeakker.be/order-lines/${orderLineUuid}`;

  await updateSudo(`${PREFIXES}
    INSERT {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?basket veeakker:orderLine ${sparqlEscapeUri(orderLineUri)}.
        ${sparqlEscapeUri(orderLineUri)}
          mu:uuid ${sparqlEscapeString(orderLineUuid)};
          a veeakker:OrderLine;
          veeakker:amount ${sparqlEscapeInt(amount)};
          veeakker:hasOffering ?offering.
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?basket mu:uuid ${sparqlEscapeString(basketUuid)}.
      }
      GRAPH <http://mu.semte.ch/graphs/public> {
        ?offering mu:uuid ${sparqlEscapeString(offeringUuid)}.
      }
    }`);  
}

async function removeOrderLine( { sessionId, basketUuid, orderLineUuid } ) {
  const graph = sessionId;

  await updateSudo(`${PREFIXES}
    DELETE WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?orderLine
          mu:uuid ${sparqlEscapeString(orderLineUuid)};
          a veeakker:OrderLine;
          veeakker:amount ?amount;
          veeakker:hasOffering ?offering.
      }
    }`);
}

export { ensureBasketExists, basketInfo, basketOrderLines, basketDeliveryAddress, basketInvoiceAddress };
export { addOrderLine, removeOrderLine };
