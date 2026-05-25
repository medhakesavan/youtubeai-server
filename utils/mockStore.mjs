// server/utils/mockStore.mjs
import logger from './logger.mjs';

/**
 * A simple in-memory mock store to allow development without a running MongoDB.
 */
class MockStore {
    constructor() {
        this.data = {
            users: [],
            channels: [],
            comments: []
        };
    }

    async find(collection, query = {}) {
        return this.data[collection].filter(item => {
            return Object.entries(query).every(([key, value]) => item[key] === value);
        });
    }

    async findOne(collection, query) {
        return this.data[collection].find(item => {
            return Object.entries(query).every(([key, value]) => item[key] === value);
        });
    }

    async save(collection, item) {
        if (!item._id) item._id = Math.random().toString(36).substr(2, 9);
        const index = this.data[collection].findIndex(i => i._id === item._id);
        if (index > -1) {
            this.data[collection][index] = { ...this.data[collection][index], ...item };
        } else {
            this.data[collection].push(item);
        }
        return item;
    }
}

export const mockStore = new MockStore();
