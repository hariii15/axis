import { Client } from "@opensearch-project/opensearch";
export class OpenSearchAdapter {
    name = "opensearch";
    client;
    ownsClient;
    indexPrefix;
    constructor(config) {
        this.indexPrefix = config.indexPrefix ?? "";
        if (config.client !== undefined) {
            this.client = config.client;
            this.ownsClient = false;
            return;
        }
        this.ownsClient = true;
        const node = config.url;
        const auth = config.username && config.password
            ? { username: config.username, password: config.password }
            : undefined;
        const ssl = config.ssl
            ? {
                rejectUnauthorized: config.ssl.rejectUnauthorized ?? true,
                ca: config.ssl.ca,
            }
            : undefined;
        const clientOptions = { node };
        if (auth !== undefined)
            clientOptions.auth = auth;
        if (ssl !== undefined)
            clientOptions.ssl = ssl;
        this.client = new Client(clientOptions);
    }
    getFullIndexName(index) {
        return `${this.indexPrefix}${index}`;
    }
    async search(params) {
        const index = this.getFullIndexName(params.index);
        const body = {
            query: this.convertQuery(params.query),
            size: params.size ?? 10,
            from: params.from ?? 0,
            track_total_hits: params.trackTotalHits ?? true,
        };
        if (params.sort && params.sort.length > 0) {
            body.sort = params.sort;
        }
        if (params.aggs !== undefined) {
            body.aggs = params.aggs;
        }
        if (params._source !== undefined && params._source.length > 0) {
            body._source = params._source;
        }
        const response = await this.client.search({
            index,
            body,
        });
        return this.convertSearchResponse(unwrapBody(response));
    }
    async index(params) {
        const index = this.getFullIndexName(params.index);
        const response = await this.client.index({
            index,
            id: params.id,
            body: params.document,
            refresh: params.refresh ?? false,
        });
        const indexResponse = unwrapBody(response);
        return {
            _index: indexResponse._index,
            _id: indexResponse._id,
            _version: indexResponse._version,
            result: indexResponse.result,
        };
    }
    async deleteIndex(index) {
        const fullIndex = this.getFullIndexName(index);
        await this.client.indices.delete({ index: fullIndex });
    }
    async healthCheck() {
        try {
            const response = await this.client.cluster.health();
            const healthResponse = unwrapBody(response);
            return healthResponse.status !== "red";
        }
        catch {
            return false;
        }
    }
    async close() {
        if (this.ownsClient) {
            await this.client.close();
        }
    }
    convertQuery(query) {
        if (query.bool) {
            const bool = {};
            if (query.bool.must?.length)
                bool.must = query.bool.must.map((q) => this.convertQuery(q));
            if (query.bool.should?.length)
                bool.should = query.bool.should.map((q) => this.convertQuery(q));
            if (query.bool.filter?.length)
                bool.filter = query.bool.filter.map((q) => this.convertQuery(q));
            if (query.bool.mustNot?.length)
                bool.must_not = query.bool.mustNot.map((q) => this.convertQuery(q));
            // Preserve bool-level params (notably minimum_should_match, which
            // makes fulltext `should` clauses narrow instead of only scoring).
            if (query.bool.minimum_should_match !== undefined) {
                bool.minimum_should_match = query.bool.minimum_should_match;
            }
            return { bool };
        }
        if (query.match) {
            const match = {};
            for (const [field, matchQuery] of Object.entries(query.match)) {
                if (typeof matchQuery === "string") {
                    match[field] = { query: matchQuery };
                }
                else {
                    match[field] = {
                        query: matchQuery.query,
                        ...(matchQuery.operator !== undefined && { operator: matchQuery.operator }),
                        ...(matchQuery.fuzziness !== undefined && { fuzziness: matchQuery.fuzziness }),
                    };
                }
            }
            return { match };
        }
        if (query.matchAll) {
            return { match_all: {} };
        }
        if (query.knn) {
            const knn = query.knn;
            if (typeof knn["field"] === "string" && Array.isArray(knn["vector"])) {
                // Single-clause form: expand to the map form.
                const clause = query.knn;
                return {
                    knn: {
                        [clause.field]: {
                            vector: clause.vector,
                            k: clause.k,
                            ...(clause.numCandidates !== undefined && { num_candidates: clause.numCandidates }),
                            ...(clause.filter !== undefined && { filter: this.convertQuery(clause.filter) }),
                        },
                    },
                };
            }
            // Already-compiled map form (e.g. from compileToOpenSearch):
            // pass through untouched to avoid double-wrapping.
            return { knn: query.knn };
        }
        // Already-compiled leaf clauses (term, terms, range, prefix,
        // wildcard, exists, ...) pass through untouched. Only a truly
        // empty query defaults to match_all — never silently neutralize
        // a filter (that would drop tenant isolation).
        if (Object.keys(query).length === 0) {
            return { match_all: {} };
        }
        return query;
    }
    convertSearchResponse(response) {
        const hits = response.hits.hits.map((hit) => {
            const result = {
                _index: hit._index,
                _id: hit._id,
                _source: hit._source,
            };
            if (hit._score !== undefined)
                result._score = hit._score;
            if (hit.sort !== undefined)
                result.sort = hit.sort;
            return result;
        });
        const total = typeof response.hits.total === "number"
            ? response.hits.total
            : response.hits.total.value;
        const result = {
            hits,
            total: typeof response.hits.total === "number"
                ? response.hits.total
                : { value: response.hits.total.value, relation: response.hits.total.relation },
            took: response.took,
            timedOut: response.timed_out,
        };
        const aggregations = response
            .aggregations;
        if (aggregations !== undefined) {
            result.aggregations = aggregations;
        }
        return result;
    }
}
export function createOpenSearchAdapter(config) {
    return new OpenSearchAdapter(config);
}
/**
 * The client returns a transport wrapper
 * (`{ body, statusCode, headers, meta }`) — the API payload
 * lives in `.body`. Tolerates a bare body for forward compatibility.
 */
function unwrapBody(response) {
    if (typeof response === "object" &&
        response !== null &&
        "body" in response) {
        return response.body;
    }
    return response;
}
//# sourceMappingURL=OpenSearchAdapter.js.map