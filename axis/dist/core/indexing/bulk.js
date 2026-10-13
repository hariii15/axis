const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
/**
 * Bulk document writer over any `SearchAdapter` (Phase 8).
 *
 * Documents are written in batches with per-document retry and
 * per-document error collection — one bad document never aborts
 * the run.
 */
export class BulkIndexer {
    search;
    batchSize;
    concurrency;
    retryAttempts;
    retryDelayMs;
    constructor(search, options = {}) {
        this.search = search;
        this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
        this.retryAttempts = Math.max(1, options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS);
        this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    }
    async indexDocuments(index, documents, tenantField = "tenant_id") {
        let indexed = 0;
        let failed = 0;
        const errors = [];
        for (let i = 0; i < documents.length; i += this.batchSize) {
            const batch = documents.slice(i, i + this.batchSize);
            const results = await runWithConcurrency(batch, this.concurrency, (doc) => this.indexOne(index, doc, tenantField));
            for (const result of results) {
                if (result.ok) {
                    indexed += 1;
                }
                else {
                    failed += 1;
                    errors.push(result.error);
                }
            }
        }
        return { indexed, failed, errors };
    }
    async indexOne(index, doc, tenantField) {
        const body = { ...doc.fields };
        if (doc.tenantId !== undefined && body[tenantField] === undefined) {
            body[tenantField] = doc.tenantId;
        }
        if (doc.searchableText !== undefined) {
            body["searchable_text"] = doc.searchableText;
        }
        if (doc.embedding !== undefined) {
            body["embedding"] = doc.embedding;
        }
        let attempt = 0;
        let lastError;
        while (attempt < this.retryAttempts) {
            attempt += 1;
            try {
                await this.search.index({ index, id: doc.id, document: body });
                return { ok: true };
            }
            catch (error) {
                lastError = error;
                if (attempt < this.retryAttempts && this.retryDelayMs > 0) {
                    await sleep(this.retryDelayMs);
                }
            }
        }
        return {
            ok: false,
            error: {
                id: doc.id,
                error: lastError instanceof Error ? lastError.message : String(lastError),
                document: body,
            },
        };
    }
}
async function runWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const current = next;
            next += 1;
            if (current >= items.length)
                return;
            results[current] = await fn(items[current]);
        }
    });
    await Promise.all(workers);
    return results;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=bulk.js.map