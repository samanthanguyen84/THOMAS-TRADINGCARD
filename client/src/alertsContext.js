import { createContext } from 'react';

// Unseen restock-alert count, shown as a badge on the Restock Watch nav item.
// `refresh()` lets pages bump the badge right after mutations (mark-seen,
// manual checks) instead of waiting for the next poll.
export const AlertsContext = createContext({ count: 0, refresh: () => {} });
