import { sparqlEscapeUri } from 'mu';
import { updateSudo, querySudo } from '@lblod/mu-auth-sudo';
import PREFIXES from './prefixes';

/**
 * Get the graph for the user's account or null.
 */
async function getUserAccountGraph(sessionId) {
  const searchGraph = await querySudo(`

  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  PREFIX session: <http://mu.semte.ch/vocabularies/session/>

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
async function ensureBasketGraph(sessionId) {
  // Ensures a graph exists to store the current user's or session's
  // graph.
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

export { ensureBasketGraph };
