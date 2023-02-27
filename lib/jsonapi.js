import { basketInfo, basketOrderLines, basketDeliveryAddress, basketInvoiceAddress } from './basket';

/**
 * Constructs JSON API representation of the current basket with all
 * content included, assuming this basket exists.
 */
async function basketJsonApi( basketUri, graph ) {
  const basket = await basketInfo( basketUri, graph);
  const orderLines = await basketOrderLines( basketUri, graph );
  const deliveryAddress = await basketDeliveryAddress( basketUri, graph );
  const invoiceAddress = await basketInvoiceAddress( basketUri, graph );

  const mainResponse = {
    data: [{
      type: "baskets",
      id: basket.uuid,
      attributes: {
        "order-status": basket.orderStatus,
        "payment-status": basket.paymentStatus,
        "has-custom-delivery-place": basket.hasCustomDeliveryPlace,
        "delivery-type": basket.deliveryType,
        "changed-at": basket.changedAt
      },
      relationships: {
        "order-lines": {
          links: {}, // None available
          data: orderLines.map((ol) => ({
            type: "order-lines",
            id: ol.uuid
          }))
        },
        "delivery-address": {
          links: {}, // None available
          data: {
            type: "full-addresses",
            id: deliveryAddress ? deliveryAddress.uuid : null
          }
        },
        "invoice-address": {
          links: {}, // None available
          data: {
            type: "full-addresses",
            id: invoiceAddress ? invoiceAddress.uuid : null
          }
        },
      }
    }],
    links: {}, // None available
    meta: {}, // None available
    included: [
      // list all included resources with their details and expansion

      // orderLines
      ...orderLines.map( (ol) => (
        {
          id: ol.uuid,
          type: "order-lines",
          attributes: {
            amount: ol.amount
          },
          relationships: {
            offering: {
              links: { }, // None available
              data: {
                type: "offerings",
                id: ol.offeringUuid
              }
            }
          }
        })),
      // deliveryAddress
      ...deliveryAddress ?
        [{
          id: deliveryAddress.uuid,
          type: "full-addresses",
          attributes: {
            "first-name": deliveryAddress.firstName,
            "last-name": deliveryAddress.lastName,
            company: deliveryAddress.company,
            telephone: deliveryAddress.telephone,
            email: deliveryAddress.email
          },
          relationships: {
            "postal-address": {
              links: {}, // None available
              data: deliveryAddress.postalAddressUuid
                ? { type: "postal-addresses", id: deliveryAddress.postalAddressUuid }
                : null
            }
          }
        }]
        : [],
      ...(deliveryAddress && deliveryAddress.postalAddressUuid ?
        [{
          id: deliveryAddress.postalAddressUuid,
          type: "postal-addresses",
          attributes: {
            "locality": deliveryAddress.postalLocality,
            "postal-code": deliveryAddress.postalCode,
            "street-address": deliveryAddress.streetAddress
          }
        }]
          : []),
      // invoiceAddress
      ...invoiceAddress ?
        [{
          id: invoiceAddress.uuid,
          type: "full-addresses",
          attributes: {
            "first-name": invoiceAddress.firstName,
            "last-name": invoiceAddress.lastName,
            company: invoiceAddress.company,
            telephone: invoiceAddress.telephone,
            email: invoiceAddress.email
          },
          relationships: {
            "postal-address": {
              links: {}, // None available
              data: invoiceAddress.postalAddressUuid
                ? { type: "postal-addresses", id: invoiceAddress.postalAddressUuid }
                : null
            }
          }
        }]
        : [],
      ...(invoiceAddress && invoiceAddress.postalAddressUuid ?
        [{
          id: invoiceAddress.postalAddressUuid,
          type: "postal-addresses",
          attributes: {
            "locality": invoiceAddress.postalLocality,
            "postal-code": invoiceAddress.postalCode,
            "street-address": invoiceAddress.streetAddress
          }
        }]
          : [])
    ]
  };

  console.log({dpuuid: basket.deliveryPlaceUuid });

  if (basket.deliveryPlaceUuid) {
    mainResponse.data[0].relationships["delivery-place"] = {
      links: {}, // None available
      data: {
        type: "delivery-places",
        id: basket.deliveryPlaceUuid
      }
    };
  }

  return mainResponse;
}

export { basketJsonApi };
