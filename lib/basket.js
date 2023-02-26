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
        ${sparqlEscapeUri(graph)} veeakker:hasBasket ?basket.
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
        ${sparqlEscapeUri(sessionId)} veeakker:hasBasket ${sparqlEscapeUri(basketUri)}.
        ${sparqlEscapeUri(basketUri)}
          a veeakker:Basket;
          mu:uuid ${sparqlEscapeString(basketUuid)};
          veeakker:basketOrderStatus <http://veeakker.be/order-statuses/draft>;
          veeakker:statusChangedAt ${sparqlEscapeDateTime(new Date())};
          veeakker:deliveryAddress ${sparqlEscapeUri(deliveryUri)};
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

  return basketUuid;
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
    SELECT ?uuid ?firstName ?lastName ?company ?telephone ?email ?postalAddressUuid ?postalLocality ?postalCode ?streetAddress WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ?basket
          mu:uuid ${sparqlEscapeString(basketUuid)};
          veeakker:deliveryAddress ?address.
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


async function basketInvoiceAddress( basketUuid, graph ) {
  const query = await querySudo(`${PREFIXES}
    SELECT ?uuid ?firstName ?lastName ?company ?telephone ?email ?postalAddressUuid ?postalLocality ?postalCode ?streetAddress WHERE {
      GRAPH ${sparqlEscapeUri( graph )} {
        ?basket
          mu:uuid ${sparqlEscapeString(basketUuid)};
          veeakker:invoiceAddress ?address.
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

async function persistInvoiceAddress({graph, basketUuid, invoiceAddress, invoicePostal}) {
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
        ?basket
          mu:uuid ${sparqlEscapeString(basketUuid)};
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

async function persistDeliveryAddress({graph, basketUuid, deliveryAddress, deliveryPostal}) {
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
        ?basket
          mu:uuid ${sparqlEscapeString(basketUuid)};
          veeakker:deliveryAddress ?deliveryAddress.
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

export { ensureBasketExists, basketInfo, basketOrderLines, basketDeliveryAddress, basketInvoiceAddress,
         addOrderLine, removeOrderLine, persistInvoiceAddress, persistDeliveryAddress };
