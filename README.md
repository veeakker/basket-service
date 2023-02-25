# basket-service

This service yields the basket for a user who visits the site.

Consider this service to be a stepping stone towards different sorts of
information being attached to the logged in user through patterns which
are common in frontend technologies.  This specific repository will
evolve more towards supprting shopping baskets rather than towards the
generic applications.

## How is the data stored

Baskets are stored in their own graph based on the current user.  This
service maintains the relevant graph with respect to the orders.
Information regarding the logged in user is not maintained in this
service, but merging the content from the current session to the logged
in user can be.
