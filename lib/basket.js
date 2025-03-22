import { ensureBasketGraph, getSessionGraph, getUserAccountGraph } from './user-graph';
import { uuid as makeUuid, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, sparqlEscapeInt, sparqlEscapeBool } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import PREFIXES from './prefixes';

/**
 * Ensures the session has a basket, returning its uuid.
 */
async function ensureBasketExists(sessionId) {
  const graph = await ensureBasketGraph(sessionId);
  const basketInfo = await lastBasketInGraph(graph);

  if (basketInfo) {
    return { graph, basketUri: basketInfo.uri, basketUuid: basketInfo.uuid };
  } else {
    const { uri, uuid } = await makeBasket(sessionId, graph);
    return { graph, basketUri: uri, basketUuid: uuid };
  }
}

/**
 * Yields the uri and uuid of the last basket in the graph.
 */
async function lastBasketInGraph(graph) {
  const basketQuery = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>

    SELECT ?uuid ?basket ?changedAt WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(graph)} veeakker:hasBasket ?basket.
        ?basket veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>;
          mu:uuid ?uuid.
        OPTIONAL { ?basket veeakker:statusChangedAt ?changedAt. }
      }
    } ORDER BY DESC( ?changedAt ) LIMIT 1`;

  const response = await querySudo(basketQuery);

  if ( response.results.bindings.length > 0 ) {
    return {
      uuid: response.results.bindings[0].uuid.value,
      uri: response.results.bindings[0].basket.value
    };
  } else {
    return null;
  }
}

/**
 * Validate if the basket with UUID uuid belongs to session sessionId.
 *
 * Yields the graph in which the basketUuid is stored if it is found.
 */
async function basketUuidBelongsToSession( basketUuid, sessionId ) {
  // There are two graphs where this basket may be at.  It may be at a
  // graph belonging to the session itself, or it may belong to a basket
  // belonging to the user of the session.

  const response = await querySudo(`${PREFIXES}
    SELECT ?graph ?basket WHERE {
      {
        GRAPH ?graph {
          ?graph veeakker:graphBelongsToSession ${sparqlEscapeUri(sessionId)}.
          ?basket
            mu:uuid ${sparqlEscapeString(basketUuid)};
            a veeakker:Basket.
        }
      } UNION {
        GRAPH ?graph {
          ?graph veeakker:graphBelongsToUser/foaf:account/^session:account ${sparqlEscapeUri(sessionId)}.
          ?basket
            mu:uuid ${sparqlEscapeString(basketUuid)};
            a veeakker:Basket.
        }
      }
    }`);

  if ( response.results.bindings.length > 0 ) {
    const bindings = response.results.bindings[0];
    return { graph: bindings.graph.value, uri: bindings.basket.value };
  } else {
    return null;
  }
}

async function makeBasket(sessionId, graph) {
  let basketUuid = makeUuid();
  let basketUri = `http://veeakker.be/baskets/${basketUuid}`;

  let deliveryUuid = makeUuid();
  let deliveryUri = `http://veeakker.be/full-addresses/${deliveryUuid}`;
  let invoiceUuid = makeUuid();
  let invoiceUri = `http://veeakker.be/full-addresses/${invoiceUuid}`;
  let deliveryPostalUuid = makeUuid();
  let deliveryPostalUri = `http://veeakker.be/postal-addresses/${deliveryPostalUuid}`;
  let invoicePostalUuid = makeUuid();
  let invoicePostalUri = `http://veeakker.be/postal-addresses/${invoicePostalUuid}`;

  await updateSudo(`
    ${PREFIXES}

    INSERT DATA {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(graph)} veeakker:hasBasket ${sparqlEscapeUri(basketUri)}.
        ${sparqlEscapeUri(basketUri)}
          a veeakker:Basket;
          mu:uuid ${sparqlEscapeString(basketUuid)};
          veeakker:orderedBy ${sparqlEscapeUri(graph)};
          veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>;
          veeakker:statusChangedAt ${sparqlEscapeDateTime(new Date())};
          veeakker:deliveryAddress ${sparqlEscapeUri(deliveryUri)};
          veeakker:deliveryType ${sparqlEscapeString("http://veeakker.be/delivery-methods/shop")};
          veeakker:invoiceAddress ${sparqlEscapeUri(invoiceUri)}.
        ${sparqlEscapeUri(deliveryUri)}
          mu:uuid ${sparqlEscapeString(deliveryUuid)};
          a veeakker:Address;
          schema:hasAddress ${sparqlEscapeUri(deliveryPostalUri)}.
        ${sparqlEscapeUri(deliveryPostalUri)}
          mu:uuid ${sparqlEscapeString(deliveryPostalUuid)};
          a schema:PostalAddress.
        ${sparqlEscapeUri(invoiceUri)}
          mu:uuid ${sparqlEscapeString(invoiceUuid)};
          a veeakker:Address;
          schema:hasAddress ${sparqlEscapeUri(invoicePostalUri)}.
        ${sparqlEscapeUri(invoicePostalUri)}
          mu:uuid ${sparqlEscapeString(invoicePostalUuid)};
          a schema:PostalAddress.
      }
    }`);

  return { uri: basketUri, uuid: basketUuid };
}

async function basketInfo( basketUri, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?basketUuid ?paymentStatus ?orderStatus ?changedAt ?hasCustomDeliveryPlace ?deliveryPlaceUuid ?deliveryType WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(basketUri)} mu:uuid ?basketUuid.
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:paymentStatus ?paymentStatus. }
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:basketOrderStatus ?orderStatus. }
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:statusChangedAt ?changedAt. }
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:deliveryType ?deliveryType. }
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:hasCustomDeliveryPlace ?hasCustomDeliveryPlace. }
        OPTIONAL {
          ${sparqlEscapeUri(basketUri)} veeakker:deliveryPlace ?deliveryPlaceUri.
          GRAPH <http://mu.semte.ch/graphs/public> { ?deliveryPlaceUri mu:uuid ?deliveryPlaceUuid. }
        }
      }
    }`);

  if ( query.results.bindings[0] ) {
    const bindings = query.results.bindings[0];
    const customDeliveryPlaceBinding = bindings.hasCustomDeliveryPlace && bindings.hasCustomDeliveryPlace.value;
    return {
      uuid: bindings.basketUuid?.value,
      paymentStatus: (bindings.paymentStatus && bindings.paymentStatus.value) || null,
      orderStatus: (bindings.orderStatus && bindings.orderStatus.value) || null,
      changedAt: (bindings.changedAt && bindings.changedAt.value) || null,
      hasCustomDeliveryPlace: customDeliveryPlaceBinding == "1" || customDeliveryPlaceBinding == true || false,
      deliveryType: (bindings.deliveryType && bindings.deliveryType.value ) || null,
      deliveryPlaceUuid: (bindings.deliveryPlaceUuid && bindings.deliveryPlaceUuid.value) || null
    };
  } else {
    throw `Could not find basket ${basketUri} in graph ${graph}`;
  }
}

async function basketOrderLines( basketUri, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?orderLineUuid ?orderLineAmount ?orderLineOfferingUuid ?orderLineComment WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)} veeakker:orderLine ?orderLine.
        ?orderLine
          mu:uuid ?orderLineUuid;          
          veeakker:amount ?orderLineAmount.
        OPTIONAL {
          ?orderLine veeakker:hasOffering ?offering.
        }
        OPTIONAL {
          ?orderLine veeakker:customerComment ?orderLineComment.
        }
      }
      GRAPH <http://mu.semte.ch/graphs/public> {
        ?offering mu:uuid ?orderLineOfferingUuid.
      }
    }`);

  return query.results.bindings.map( (bindings) => {
    console.log(bindings);
    return {
      uuid: bindings.orderLineUuid ? bindings.orderLineUuid.value : null,
      amount: bindings.orderLineAmount ? bindings.orderLineAmount.value : null,
      offeringUuid: bindings.orderLineOfferingUuid ? bindings.orderLineOfferingUuid.value : null,
      comment: bindings.orderLineComment ? bindings.orderLineComment.value : null
    };
  } );
}

async function basketDeliveryAddress( basketUri, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?uuid ?firstName ?lastName ?company ?telephone ?email ?postalAddressUuid ?postalLocality ?postalCode ?streetAddress WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)} veeakker:deliveryAddress ?address.
        ?address mu:uuid ?uuid.
        OPTIONAL { ?address foaf:firstName ?firstName. }
        OPTIONAL { ?address foaf:lastName ?lastName. }
        OPTIONAL { ?address ext:companyInfo ?company. }
        OPTIONAL { ?address foaf:phone ?telephone. }
        OPTIONAL { ?address schema:email ?email. }
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
      firstName: (bindings.firstName && bindings.firstName.value),
      lastName: (bindings.lastName && bindings.lastName.value),
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


async function basketInvoiceAddress( basketUri, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?uuid ?firstName ?lastName ?company ?telephone ?email ?postalAddressUuid ?postalLocality ?postalCode ?streetAddress WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)} veeakker:invoiceAddress ?address.
        ?address mu:uuid ?uuid.
        OPTIONAL { ?address foaf:firstName ?firstName. }
        OPTIONAL { ?address foaf:lastName ?lastName. }
        OPTIONAL { ?address ext:companyInfo ?company. }
        OPTIONAL { ?address foaf:phone ?telephone. }
        OPTIONAL { ?address schema:email ?email. }
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
      firstName: (bindings.firstName && bindings.firstName.value),
      lastName: (bindings.lastName && bindings.lastName.value),
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

async function persistInvoiceAddress({graph, basketUuid, basketUri, invoiceAddress, invoicePostal}) {
  const queryString = `${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ?invoiceAddress
          foaf:firstName ?firstName;
          foaf:lastName ?lastName;
          ext:companyInfo ?companyInfo;
          schema:email ?email;
          foaf:phone ?telephone.
        ?postal
          schema:addressLocality ?postalLocality;
          schema:postalCode ?postalCode;
          schema:streetAddress ?streetAddress.
      }
    } INSERT {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${invoiceAddress["first-name"] ? `?invoiceAddress foaf:firstName ${sparqlEscapeString(invoiceAddress["first-name"])}.` : ""}
        ${invoiceAddress["last-name"] ? `?invoiceAddress foaf:lastName ${sparqlEscapeString(invoiceAddress["last-name"])}.` : ""}
        ${invoiceAddress.company ? `?invoiceAddress ext:companyInfo ${sparqlEscapeString(invoiceAddress.company)}.` : ""}
        ${invoiceAddress.telephone ? `?invoiceAddress foaf:phone ${sparqlEscapeString(invoiceAddress.telephone)}.` : ""}
        ${invoiceAddress.email ? `?invoiceAddress schema:email ${sparqlEscapeString(invoiceAddress.email)}.` : ""}
        ${invoicePostal.locality ? `?postal schema:addressLocality ${sparqlEscapeString(invoicePostal.locality)}.` : ""}
        ${invoicePostal["postal-code"] ? `?postal schema:postalCode ${sparqlEscapeString(invoicePostal["postal-code"])}.` : ""}
        ${invoicePostal["street-address"] ? `?postal schema:streetAddress ${sparqlEscapeString(invoicePostal["street-address"])}.` : ""}
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)}
          veeakker:invoiceAddress ?invoiceAddress.
        OPTIONAL { ?invoiceAddress foaf:firstName ?firstName. }
        OPTIONAL { ?invoiceAddress foaf:lastName ?lastName. }
        OPTIONAL { ?invoiceAddress ext:companyInfo ?companyInfo. }
        OPTIONAL { ?invoiceAddress foaf:phone ?telephone. }
        OPTIONAL { ?invoiceAddress schema:email ?email. }
        OPTIONAL {
          ?invoiceAddress schema:hasAddress ?postal.
          OPTIONAL { ?postal schema:addressLocality ?postalLocality }
          OPTIONAL { ?postal schema:postalCode ?postalCode }
          OPTIONAL { ?postal schema:streetAddress ?streetAddress }
        }
      }
    }`;
  console.log({queryString});
  await updateSudo(queryString);
}

async function persistDeliveryAddress({graph, basketUuid, basketUri, deliveryAddress, deliveryPostal}) {
  const queryString = `${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ?deliveryAddress
          foaf:firstName ?firstName;
          foaf:lastName ?lastName;
          ext:companyInfo ?companyInfo;
          schema:email ?email;
          foaf:phone ?telephone.
        ?postal
          schema:addressLocality ?postalLocality;
          schema:postalCode ?postalCode;
          schema:streetAddress ?streetAddress.
      }
    } INSERT {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${deliveryAddress["first-name"] ? `?deliveryAddress foaf:firstName ${sparqlEscapeString(deliveryAddress["first-name"])}.` : ""}
        ${deliveryAddress["last-name"] ? `?deliveryAddress foaf:lastName ${sparqlEscapeString(deliveryAddress["last-name"])}.` : ""}
        ${deliveryAddress.company ? `?deliveryAddress ext:companyInfo ${sparqlEscapeString(deliveryAddress.company)}.` : ""}
        ${deliveryAddress.telephone ? `?deliveryAddress foaf:phone ${sparqlEscapeString(deliveryAddress.telephone)}.` : ""}
        ${deliveryAddress.email ? `?deliveryAddress schema:email ${sparqlEscapeString(deliveryAddress.email)}.` : ""}
        ${deliveryPostal.locality ? `?postal schema:addressLocality ${sparqlEscapeString(deliveryPostal.locality)}.` : ""}
        ${deliveryPostal["postal-code"] ? `?postal schema:postalCode ${sparqlEscapeString(deliveryPostal["postal-code"])}.` : ""}
        ${deliveryPostal["street-address"] ? `?postal schema:streetAddress ${sparqlEscapeString(deliveryPostal["street-address"])}.` : ""}
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)} veeakker:deliveryAddress ?deliveryAddress.
        OPTIONAL { ?deliveryAddress foaf:firstName ?firstName. }
        OPTIONAL { ?deliveryAddress foaf:lastName ?lastName. }
        OPTIONAL { ?deliveryAddress ext:companyInfo ?companyInfo. }
        OPTIONAL { ?deliveryAddress foaf:phone ?telephone. }
        OPTIONAL { ?deliveryAddress schema:email ?email. }
        OPTIONAL {
          ?deliveryAddress schema:hasAddress ?postal.
          OPTIONAL { ?postal schema:addressLocality ?postalLocality }
          OPTIONAL { ?postal schema:postalCode ?postalCode }
          OPTIONAL { ?postal schema:streetAddress ?streetAddress }
        }
      }
    }`;
  console.log({queryString});
  await updateSudo(queryString);
}

async function persistDeliveryMeta({ graph, basketUuid, basketUri, hasCustomDeliveryPlace, deliveryPlaceUuid, deliveryType }) {
  console.log({deliveryPlaceUuid});

  const queryString = `${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)}
          veeakker:hasCustomDeliveryPlace ?hasCustomDeliveryPlace;
          veeakker:deliveryType ?deliveryType;
          veeakker:deliveryPlace ?deliveryPlace.
      }
    } INSERT {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)} veeakker:hasCustomDeliveryPlace ${sparqlEscapeBool(hasCustomDeliveryPlace)}.
        ${ deliveryType ? `${sparqlEscapeUri(basketUri)} veeakker:deliveryType ${sparqlEscapeString(deliveryType)}.` : "" }
        ${sparqlEscapeUri(basketUri)} veeakker:deliveryPlace ?newDeliveryPlace.
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ${sparqlEscapeUri(basketUri)} mu:uuid ${sparqlEscapeString(basketUuid)}.
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:hasCustomDeliveryPlace ?hasCustomDeliveryPlace. }
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:deliveryType ?deliveryType. }
        OPTIONAL { ${sparqlEscapeUri(basketUri)} veeakker:deliveryPlace ?deliveryPlace. }
        ${ deliveryPlaceUuid ? `OPTIONAL { GRAPH <http://mu.semte.ch/graphs/public> { ?newDeliveryPlace mu:uuid ${sparqlEscapeString(deliveryPlaceUuid)}. } }` : "" }
      }
   }`;

  console.log({persistmeta: queryString});
  await updateSudo(queryString);
}


async function addOrderLine( { sessionId, basketUuid, basketUri, graph, offeringUuid, amount, comment } ) {
  const orderLineUuid = makeUuid();
  const orderLineUri = `http://veeakker.be/order-lines/${orderLineUuid}`;

  await updateSudo(`${PREFIXES}
    INSERT {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(basketUri)} veeakker:orderLine ${sparqlEscapeUri(orderLineUri)}.
        ${sparqlEscapeUri(orderLineUri)}
          mu:uuid ${sparqlEscapeString(orderLineUuid)};
          a veeakker:OrderLine;
          veeakker:amount ${sparqlEscapeInt(amount)};
          ${comment ? "veeakker:customerComment ${sparqlEscapeString(comment)};" : ""}
          veeakker:hasOffering ?offering.
      }
    } WHERE {
      GRAPH <http://mu.semte.ch/graphs/public> {
        ?offering mu:uuid ${sparqlEscapeString(offeringUuid)}.
      }
    }`);  
}

async function removeOrderLine( { sessionId, basketUuid, basketUri, graph, orderLineUuid } ) {
  await updateSudo(`${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?orderLine
          mu:uuid ${sparqlEscapeString(orderLineUuid)};
          a veeakker:OrderLine;
          veeakker:amount ?amount.
        ?orderLine veeakker:hasOffering ?offering.
        ?orderLine veeakker:customerComment ?comment.
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?orderLine
          mu:uuid ${sparqlEscapeString(orderLineUuid)};
          a veeakker:OrderLine;
          veeakker:amount ?amount.
        OPTIONAL { ?orderLine veeakker:hasOffering ?offering. }
        OPTIONAL { ?orderLine veeakker:customerComment ?comment. }
      }
    }`);
}

async function setOrderLineComment( { graph, orderLineUuid, comment } ) {
  await updateSudo(`${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?orderLine veeakker:customerComment ?oldComment.
      }
    } INSERT {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?orderLine veeakker:customerComment ${sparqlEscapeString( comment )}.
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ?orderLine mu:uuid ${sparqlEscapeString(orderLineUuid)}.
        OPTIONAL {
          ?orderLine veeakker:customerComment ?oldComment.
        }
      }
    }
  `);
}

async function registerBasketChanged( { basketUri, graph } ) {
  await updateSudo(`${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(basketUri)} veeakker:changedAt ?lastChange.
      }
    } INSERT {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(basketUri)} veeakker:changedAt ${sparqlEscapeDateTime(new Date())}.
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        ${sparqlEscapeUri(basketUri)} veeakker:changedAt ?lastChange.
      }
    }`);
}

/**
 * Merges baskets together.
 */
/**
 * Merges the basket lines for the session graph and the user graph.
 */
async function mergeBasketFromSessionToAccountGraph(sessionId) {
  // 1. get the source graph
  const sessionGraph = await getSessionGraph(sessionId);
  // 2. get the target graph
  const userGraph = await getUserAccountGraph(sessionId);
  // 3. get the source basket
  const sourceBasket = (await lastBasketInGraph(sessionGraph))?.uri;
  // 4. get the target basket
  const targetBasket = (await lastBasketInGraph(userGraph))?.uri;
  // 5. copy data from one graph to the other graph
  if( sourceBasket && targetBasket ) {
    await updateSudo(`${PREFIXES}
    INSERT {
      GRAPH ${sparqlEscapeUri(userGraph)} {
        ${sparqlEscapeUri(targetBasket)}
          veeakker:orderLine ?orderLine.
        ?orderLine ?orderLineP ?orderLineO.
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(sessionGraph)} {
        ${sparqlEscapeUri(sourceBasket)}
          veeakker:orderLine ?orderLine.
        ?orderLine ?orderLineP ?orderLineO.
      }
    }
  `);
    // 6. delete old triples from source graph
    await updateSudo(`${PREFIXES}
    DELETE {
      GRAPH ${sparqlEscapeUri(sessionGraph)} {
        ?basket ?basketP ?basketO.
        ?orderLine ?orderLineP ?orderLineO.
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(sessionGraph)} {
        VALUES (?basket) { (${sparqlEscapeUri(sourceBasket)}) }
        {
          ?basket veeakker:orderLine ?orderLine.
          ?basket ?basketP ?basketO.
        } UNION {
          ?basket veeakker:orderLine ?orderLine.
          ?orderLine ?orderLineP ?orderLineO.
        }
      }
    }`);
  }
}


export { ensureBasketExists, basketUuidBelongsToSession, basketInfo, mergeBasketFromSessionToAccountGraph,
         basketOrderLines, basketDeliveryAddress, basketInvoiceAddress,
         addOrderLine, removeOrderLine, setOrderLineComment,
         persistInvoiceAddress, persistDeliveryAddress, persistDeliveryMeta,
         registerBasketChanged };
