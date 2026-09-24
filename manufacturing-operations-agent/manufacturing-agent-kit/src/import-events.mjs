import { loadDevelopmentEvents, openEventStore, DEFAULT_DB } from './events.mjs';

const events = loadDevelopmentEvents();
const store = openEventStore();
try {
  const result = store.save(events);
  console.log(JSON.stringify({ ...result, database: DEFAULT_DB, source: 'validation',
    exampleEventId: events[0]?.eventId ?? null }, null, 2));
} finally { store.close(); }
