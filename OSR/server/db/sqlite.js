// Optional local-only SQLite. Production uses the async Postgres adapter.
import { DatabaseSync } from 'node:sqlite';
export default class Database extends DatabaseSync {
  transaction(fn) {
    return async (...args) => {
      this.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
        throw error;
      }
    };
  }
}
